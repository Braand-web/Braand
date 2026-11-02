import {privateJSON} from '@/lib/private-json';
import {env} from "cloudflare:workers";
import {z} from "zod";
import {fileIdentity,getResource,failure,uid,db,config} from "@/lib/server";
import {AppError,safeFilename} from "@/lib/core.mjs";
import {FILE_POLICY,declaredTypeMatches,detectFileType,imageWithinPixelLimit,safeResourceDto} from "@/lib/file-policy.mjs";
import {fileUploadPartCount,fileUploadPartSize,isSha256,publicUploadSession,uploadSessionExpired} from "@/lib/file-upload.mjs";

type UploadSession={
 id:string;workspace_id:string;owner_id:string;file_id:string;multipart_upload_id:string;storage_key:string;
 display_name:string;storage_name:string;declared_size:number;declared_mime:string;sha256:string;
 part_size:number;part_count:number;status:string;created_at:number;updated_at:number;expires_at:number;
};
type UploadPart={upload_id:string;part_number:number;etag:string;sha256:string;size_bytes:number;updated_at:number};
const notFound=()=>new AppError("Envoi introuvable ou expiré.",404,"upload_not_found");
const enabled=()=>config().FILE_PREVIEW_V1==="true";
const displayName=(name:string)=>name.normalize("NFC").replace(/[\u0000-\u001f\u007f]/gu,"").slice(0,FILE_POLICY.maxDisplayNameChars)||"Fichier";
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
const digest=async(bytes:Uint8Array)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes.buffer as ArrayBuffer)));
const sessionSelect="SELECT * FROM file_upload_sessions WHERE id=? AND workspace_id=? AND owner_id=?";

async function findSession(id:string,workspaceId:string,userId:string){
 return db().prepare(sessionSelect).bind(id,workspaceId,userId).first<UploadSession>();
}
async function partsFor(id:string){
 const parts=await db().prepare("SELECT * FROM file_upload_parts WHERE upload_id=? ORDER BY part_number").bind(id).all<UploadPart>();
 return parts.results;
}
async function sessionDto(session:UploadSession){return publicUploadSession(session,await partsFor(session.id));}
async function takeUploadRate(userId:string,now:number){
 const windowStart=Math.floor(now/FILE_POLICY.uploadRateWindowMs)*FILE_POLICY.uploadRateWindowMs;
 await db().prepare("DELETE FROM file_upload_limits WHERE user_id=? AND window_start<?").bind(userId,windowStart-FILE_POLICY.uploadRateWindowMs).run();
 const result=await db().prepare("INSERT INTO file_upload_limits (user_id,window_start,count) VALUES (?,?,1) ON CONFLICT(user_id,window_start) DO UPDATE SET count=count+1 WHERE count<?").bind(userId,windowStart,FILE_POLICY.maxUploadsPerUserPerWindow).run();
 if(!result.meta.changes)throw new AppError("Trop de fichiers envoyés en peu de temps. Réessayez dans une minute.",429,"file_rate_limited");
}
async function takePartRate(userId:string,bytes:number,now:number){
 const windowStart=Math.floor(now/FILE_POLICY.uploadRateWindowMs)*FILE_POLICY.uploadRateWindowMs;
 await db().prepare("DELETE FROM file_upload_part_limits WHERE user_id=? AND window_start<?").bind(userId,windowStart-FILE_POLICY.uploadLimitRetentionMs).run();
 const result=await db().prepare("INSERT INTO file_upload_part_limits (user_id,window_start,count,bytes) VALUES (?,?,1,?) ON CONFLICT(user_id,window_start) DO UPDATE SET count=count+1,bytes=bytes+excluded.bytes WHERE count<? AND bytes+excluded.bytes<=?")
  .bind(userId,windowStart,bytes,FILE_POLICY.maxPartRequestsPerUserPerWindow,FILE_POLICY.maxUploadBytesPerUserPerWindow).run();
 if(!result.meta.changes)throw new AppError("Limite d’envoi atteinte pour le moment. Attendez une minute avant de reprendre.",429,"file_rate_limited");
}

async function startUpload(request:Request){
 const {tenant,user}=await fileIdentity(request);
 if(!env.BUCKET)throw new AppError("Stockage des fichiers indisponible.",503,"storage_unavailable");
 const input=z.object({name:z.string().min(1).max(FILE_POLICY.maxDisplayNameChars*2),size:z.number().int().positive().max(FILE_POLICY.maxFileBytes),mime:z.string().max(128).optional().default(""),sha256:z.string().regex(/^[a-f0-9]{64}$/iu)}).strict().parse(await privateJSON(request,1048576));
 const now=Date.now(),name=displayName(input.name),declaredMime=input.mime.trim().toLowerCase();
 const duplicate=await db().prepare("SELECT id FROM files WHERE workspace_id=? AND sha256=? AND status='ready'").bind(tenant,input.sha256.toLowerCase()).first<{id:string}>();
 if(duplicate){const resource=await getResource(tenant,duplicate.id);return Response.json({deduplicated:true,resource:safeResourceDto(resource)},{status:200});}
 const [fileCountRow,pendingCountRow,pendingBytesRow]=await Promise.all([
  db().prepare("SELECT COUNT(*) AS total FROM resources WHERE workspace_id=? AND kind='file' AND status!='deleted'").bind(tenant).first<{total:number}>(),
  db().prepare("SELECT COUNT(*) AS total FROM file_upload_sessions WHERE workspace_id=? AND owner_id=? AND status IN ('uploading','validating') AND expires_at>?").bind(tenant,user.userId,now).first<{total:number}>(),
  db().prepare("SELECT COALESCE(SUM(declared_size),0) AS total FROM file_upload_sessions WHERE workspace_id=? AND status IN ('uploading','validating') AND expires_at>?").bind(tenant,now).first<{total:number}>(),
 ]);
 if(Number(fileCountRow?.total||0)>=FILE_POLICY.legacyMaxFilesPerWorkspace)throw new AppError("La limite de fichiers de cet espace est atteinte.",429,"file_quota_exceeded");
 if(Number(pendingCountRow?.total||0)>=FILE_POLICY.maxPendingUploadsPerUser)throw new AppError("Trop d’envois sont déjà en attente. Terminez-les ou annulez-en un avant de continuer.",429,"too_many_pending_uploads");
 if(input.size>FILE_POLICY.maxPendingUploadBytesPerWorkspace-Number(pendingBytesRow?.total||0))throw new AppError("Les envois en attente ont atteint la capacité temporaire de cet espace. Reprenez ou annulez un envoi avant d’en ajouter un autre.",429,"upload_quota_exceeded");
 await takeUploadRate(user.userId,now);
 const id=uid(),fileId=uid(),storageName=safeFilename(name),storageKey=tenant+"/"+uid()+"/"+storageName;
 const partCount=fileUploadPartCount(input.size),expiresAt=now+FILE_POLICY.incompleteUploadTtlMs;
 let multipart;
 try{multipart=await env.BUCKET.createMultipartUpload(storageKey,{httpMetadata:{contentType:"application/octet-stream"}});}
 catch{throw new AppError("Impossible de préparer le stockage. Réessayez.",503,"upload_storage_unavailable");}
 try{
  await db().batch([
   db().prepare("INSERT INTO files (id,workspace_id,owner_id,display_name,storage_name,size_bytes,detected_mime,sha256,status,storage_key,created_at,updated_at) VALUES (?,?,?,?,?,?,? ,NULL,'uploading',?,?,?)").bind(fileId,tenant,user.userId,name,storageName,input.size,"application/octet-stream",storageKey,now,now),
   db().prepare("INSERT INTO file_upload_sessions (id,workspace_id,owner_id,file_id,multipart_upload_id,storage_key,display_name,storage_name,declared_size,declared_mime,sha256,part_size,part_count,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?)").bind(id,tenant,user.userId,fileId,multipart.uploadId,storageKey,name,storageName,input.size,declaredMime,input.sha256.toLowerCase(),FILE_POLICY.chunkBytes,partCount,now,now,expiresAt),
  ]);
 }catch(error){try{await multipart.abort();}catch{}throw error;}
 return Response.json({upload:publicUploadSession({id,workspace_id:tenant,owner_id:user.userId,file_id:fileId,multipart_upload_id:"",storage_key:"",display_name:name,storage_name:storageName,declared_size:input.size,declared_mime:declaredMime,sha256:input.sha256.toLowerCase(),part_size:FILE_POLICY.chunkBytes,part_count:partCount,status:"uploading",created_at:now,updated_at:now,expires_at:expiresAt})},{status:201});
}

async function uploadPart(request:Request){
 const {tenant,user}=await fileIdentity(request),url=new URL(request.url),uploadId=url.searchParams.get("uploadId")||"",partNumber=Number(url.searchParams.get("partNumber"));
 if(!env.BUCKET||!uploadId)throw notFound();
 const session=await findSession(uploadId,tenant,user.userId);if(!session||uploadSessionExpired(session))throw notFound();
 if(session.status!=="uploading")throw new AppError("Cet envoi ne reçoit plus de blocs.",409,"upload_not_receiving");
 const expectedSize=fileUploadPartSize(session.declared_size,partNumber);if(!expectedSize)throw new AppError("Numéro de bloc invalide.",400,"invalid_upload_part");
 await takePartRate(user.userId,expectedSize,Date.now());
 const suppliedLength=request.headers.get("content-length");if(suppliedLength!==null&&(!/^\d+$/u.test(suppliedLength)||Number(suppliedLength)!==expectedSize))throw new AppError("La taille du bloc ne correspond pas à la taille attendue.",400,"upload_checksum_mismatch");
 const expectedHash=request.headers.get("x-chunk-sha256")?.toLowerCase()||"";if(!isSha256(expectedHash))throw new AppError("Empreinte du bloc invalide.",400,"upload_checksum_mismatch");
 if(!request.body)throw new AppError("Le bloc reçu est vide.",400,"upload_checksum_mismatch");
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>expectedSize){await reader.cancel();throw new AppError("Le bloc reçu dépasse la taille attendue.",413,"upload_checksum_mismatch");}chunks.push(value);}}
 finally{reader.releaseLock();}
 if(total!==expectedSize)throw new AppError("La taille du bloc reçu ne correspond pas à celle annoncée.",400,"upload_checksum_mismatch");
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 if(await digest(bytes)!==expectedHash)throw new AppError("L’empreinte SHA-256 du bloc ne correspond pas.",400,"upload_checksum_mismatch");
 const multipart=env.BUCKET.resumeMultipartUpload(session.storage_key,session.multipart_upload_id);
 let uploaded;
 try{uploaded=await multipart.uploadPart(partNumber,bytes);}
 catch{throw new AppError("Le stockage n’a pas accepté ce bloc. Vous pouvez réessayer.",503,"upload_part_failed");}
 const now=Date.now();
 await db().prepare("INSERT INTO file_upload_parts (upload_id,part_number,etag,sha256,size_bytes,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(upload_id,part_number) DO UPDATE SET etag=excluded.etag,sha256=excluded.sha256,size_bytes=excluded.size_bytes,updated_at=excluded.updated_at").bind(uploadId,partNumber,uploaded.etag,expectedHash,total,now).run();
 await db().prepare("UPDATE file_upload_sessions SET updated_at=? WHERE id=? AND workspace_id=? AND owner_id=? AND status='uploading'").bind(now,uploadId,tenant,user.userId).run();
 return Response.json({partNumber,size:total,sha256:expectedHash});
}

async function listUploads(request:Request){
 const {tenant,user}=await fileIdentity(request),now=Date.now();
 const result=await db().prepare("SELECT * FROM file_upload_sessions WHERE workspace_id=? AND owner_id=? AND status IN ('uploading','validating') AND expires_at>? ORDER BY created_at DESC LIMIT ?").bind(tenant,user.userId,now,FILE_POLICY.maxPendingUploadsPerUser).all<UploadSession>();
 return Response.json({uploads:await Promise.all(result.results.map(sessionDto))},{headers:{"Cache-Control":"private, no-store"}});
}

async function uploadStatus(request:Request){
 const {tenant,user}=await fileIdentity(request),uploadId=new URL(request.url).searchParams.get("uploadId")||"";
 const session=await findSession(uploadId,tenant,user.userId);if(!session||uploadSessionExpired(session))throw notFound();
 return Response.json({upload:await sessionDto(session)},{headers:{"Cache-Control":"private, no-store"}});
}

async function abortUpload(request:Request){
 const {tenant,user}=await fileIdentity(request),uploadId=new URL(request.url).searchParams.get("uploadId")||"";
 if(!env.BUCKET||!uploadId)throw notFound();
 const session=await findSession(uploadId,tenant,user.userId);if(!session)throw notFound();
 if(session.status==="completed")throw new AppError("Le fichier est déjà enregistré.",409,"upload_already_completed");
 if(session.status==="aborted")return Response.json({aborted:true});
 if(session.status!=="uploading")throw new AppError("La validation a déjà commencé. Attendez son résultat avant de réessayer.",409,"upload_validation_in_progress");
 const lock=await db().prepare("UPDATE file_upload_sessions SET status='aborted',updated_at=? WHERE id=? AND workspace_id=? AND owner_id=? AND status='uploading'").bind(Date.now(),uploadId,tenant,user.userId).run();
 if(!lock.meta.changes)throw new AppError("La validation a déjà commencé. Attendez son résultat avant de réessayer.",409,"upload_validation_in_progress");
 try{await env.BUCKET.resumeMultipartUpload(session.storage_key,session.multipart_upload_id).abort();}catch{}
 const now=Date.now();
 await db().batch([
  db().prepare("INSERT INTO file_upload_audit (id,workspace_id,actor_id,file_id,action,created_at) VALUES (?,?,?,?,'upload_cancelled',?)").bind(uid(),tenant,user.userId,session.file_id,now),
  db().prepare("DELETE FROM file_upload_sessions WHERE id=? AND workspace_id=? AND owner_id=? AND status='aborted'").bind(uploadId,tenant,user.userId),
  db().prepare("DELETE FROM files WHERE id=? AND workspace_id=? AND status='uploading'").bind(session.file_id,tenant),
 ]);
 try{await env.BUCKET.delete(session.storage_key);}catch{}
 return Response.json({aborted:true});
}

async function rejectCompletedUpload(session:UploadSession,code:string,message:string,status:number){
 try{await env.BUCKET?.delete(session.storage_key);}catch{}
 const now=Date.now();
 await db().batch([
  db().prepare("UPDATE file_upload_sessions SET status='failed',updated_at=? WHERE id=? AND status!='completed'").bind(now,session.id),
  db().prepare("UPDATE files SET status='rejected',storage_key=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status!='ready'").bind(now,session.file_id,session.workspace_id),
  db().prepare("DELETE FROM file_upload_parts WHERE upload_id=?").bind(session.id),
 ]);
 throw new AppError(message,status,code);
}

async function completeUpload(request:Request){
 const {tenant,user,organization}=await fileIdentity(request);if(!env.BUCKET)throw new AppError("Stockage des fichiers indisponible.",503,"storage_unavailable");
 const input=z.object({action:z.literal("complete"),uploadId:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/iu)}).strict().parse(await privateJSON(request,1048576));
 let session=await findSession(input.uploadId,tenant,user.userId);if(!session)throw notFound();
 if(session.status==="completed"){const resource=await getResource(tenant,session.file_id);return Response.json({resource:safeResourceDto(resource),completed:true});}
 if(session.status==="failed"||session.status==="aborted"||uploadSessionExpired(session))throw notFound();
 if(input.sha256.toLowerCase()!==session.sha256)throw new AppError("Le fichier sélectionné ne correspond pas à cet envoi. Reprenez le fichier d’origine.",409,"upload_file_mismatch");
 const now=Date.now();
 if(session.status==="validating"&&session.updated_at>now-FILE_POLICY.uploadFinalizeLeaseMs)throw new AppError("La validation de ce fichier est déjà en cours. Patientez quelques instants.",409,"upload_validation_in_progress");
 const lock=await db().prepare("UPDATE file_upload_sessions SET status='validating',updated_at=? WHERE id=? AND workspace_id=? AND owner_id=? AND (status='uploading' OR (status='validating' AND updated_at<=?))").bind(now,session.id,tenant,user.userId,now-FILE_POLICY.uploadFinalizeLeaseMs).run();
 if(!lock.meta.changes){session=await findSession(input.uploadId,tenant,user.userId);if(session?.status==="completed"){const resource=await getResource(tenant,session.file_id);return Response.json({resource:safeResourceDto(resource),completed:true});}throw new AppError("La validation de ce fichier est déjà en cours.",409,"upload_validation_in_progress");}
 session=(await findSession(input.uploadId,tenant,user.userId))!;
 try{
  const parts=await partsFor(session.id);
  if(parts.length!==session.part_count||parts.some((part,index)=>Number(part.part_number)!==index+1||Number(part.size_bytes)!==fileUploadPartSize(session.declared_size,index+1)))throw new AppError("Certains blocs sont manquants. Reprenez l’envoi avant validation.",409,"upload_parts_incomplete");
  let object=await env.BUCKET.get(session.storage_key);
  if(!object){
   const completed=await env.BUCKET.resumeMultipartUpload(session.storage_key,session.multipart_upload_id).complete(parts.map(part=>({partNumber:Number(part.part_number),etag:part.etag})));
   object=await env.BUCKET.get(session.storage_key);
   if(!object||Number(object.size)!==Number(completed.size))throw new AppError("Le fichier final n’est pas disponible dans le stockage.",503,"upload_finalize_unavailable");
  }
  if(Number(object.size)!==Number(session.declared_size))return rejectCompletedUpload(session,"upload_checksum_mismatch","La taille finale du fichier ne correspond pas à la taille annoncée.",400);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.byteLength!==Number(session.declared_size)||await digest(bytes)!==session.sha256)return rejectCompletedUpload(session,"upload_checksum_mismatch","L’empreinte SHA-256 du fichier ne correspond pas.",400);
  const detected=detectFileType(bytes),allowedTypes=FILE_POLICY.uploadTypes;
  if(!detected||!allowedTypes.has(detected))return rejectCompletedUpload(session,"file_type_unsupported","Ce format de fichier n’est pas pris en charge.",415);
  if(session.declared_mime&&session.declared_mime!=="application/octet-stream"&&!declaredTypeMatches(session.declared_mime,detected))return rejectCompletedUpload(session,"file_type_mismatch","Le type déclaré ne correspond pas au contenu du fichier.",415);
  if(detected.startsWith("image/")&&!imageWithinPixelLimit(bytes,detected))return rejectCompletedUpload(session,"file_rejected_security",`Image invalide ou trop grande : limite de ${FILE_POLICY.maxImageSizeLabel}.`,415);
  const duplicate=await db().prepare("SELECT id FROM files WHERE workspace_id=? AND sha256=? AND status='ready' AND id!=?").bind(tenant,session.sha256,session.file_id).first<{id:string}>();
  if(duplicate){
   await env.BUCKET.delete(session.storage_key);
   await db().batch([db().prepare("DELETE FROM file_upload_sessions WHERE id=? AND workspace_id=?").bind(session.id,tenant),db().prepare("DELETE FROM files WHERE id=? AND workspace_id=? AND status='uploading'").bind(session.file_id,tenant)]);
   return Response.json({deduplicated:true,resource:safeResourceDto(await getResource(tenant,duplicate.id))});
  }
  const text=detected==="text/plain"?new TextDecoder().decode(bytes.subarray(0,FILE_POLICY.legacyTextPreviewChars)):undefined;
  const resourceData={key:session.storage_key,mime:detected,size:bytes.byteLength,sha256:session.sha256,...(text===undefined?{}:{text})};
  const meterId=uid(),finishedAt=Date.now();
  await db().batch([
   db().prepare("INSERT INTO resources (id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,'file',?,?, 'ready',?,?)").bind(session.file_id,tenant,session.display_name,JSON.stringify(resourceData),finishedAt,finishedAt),
   db().prepare("UPDATE files SET size_bytes=?,detected_mime=?,sha256=?,status='ready',updated_at=? WHERE id=? AND workspace_id=? AND status='uploading'").bind(bytes.byteLength,detected,session.sha256,finishedAt,session.file_id,tenant),
   db().prepare("INSERT INTO billing_meter VALUES (?,?,?,?,?)").bind(meterId,organization,"storage",bytes.byteLength,finishedAt),
   db().prepare("INSERT INTO file_upload_audit (id,workspace_id,actor_id,file_id,action,created_at) VALUES (?,?,?,?,'uploaded',?)").bind(uid(),tenant,user.userId,session.file_id,finishedAt),
   db().prepare("UPDATE file_upload_sessions SET status='completed',updated_at=? WHERE id=? AND status='validating'").bind(finishedAt,session.id),
   db().prepare("DELETE FROM file_upload_parts WHERE upload_id=?").bind(session.id),
  ]);
  return Response.json({resource:safeResourceDto(await getResource(tenant,session.file_id)),completed:true},{status:201});
 }catch(error){
  if(error instanceof AppError&&["upload_checksum_mismatch","file_type_unsupported","file_type_mismatch","file_rejected_security"].includes(error.code))throw error;
  await db().prepare("UPDATE file_upload_sessions SET status='uploading',updated_at=? WHERE id=? AND status='validating'").bind(Date.now(),session.id).run();
  throw error;
 }
}

export async function POST(request:Request){try{
 if(!enabled())throw notFound();
 const body=await request.clone().json() as {action?:string};
 if(body.action==="complete")return await completeUpload(request);
 return await startUpload(request);
 }catch(error){return failure(error);}}

export async function GET(request:Request){try{
 if(!enabled())throw notFound();
 const uploadId=new URL(request.url).searchParams.get("uploadId");
 return uploadId?await uploadStatus(request):await listUploads(request);
 }catch(error){return failure(error);}}

export async function PUT(request:Request){try{if(!enabled())throw notFound();return await uploadPart(request);}catch(error){return failure(error);}}
export async function DELETE(request:Request){try{if(!enabled())throw notFound();return await abortUpload(request);}catch(error){return failure(error);}}
