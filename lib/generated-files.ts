import {authorize,config,db,getResource,getClientResource,uid,auditLog} from './server';
import {AppError,safeFilename} from './core.mjs';
import {FILE_POLICY} from './file-policy.mjs';
import type {BillingIdentity} from './billing';
import type {Resource} from './contracts';
import {inspectGeneratedFile,FileCheckError} from './file-checks.mjs';

// One private persistence path for native report, data and source exports.
// No generated file is served as executable application content.
// Rendered media (video, images, audio, subtitles) from the code sandbox use a
// larger, explicit limit and their own allowlist.
export const MEDIA_EXPORT=Object.freeze({maxBytes:100*1024*1024,mimes:['video/mp4','video/webm','video/quicktime','image/gif','image/png','image/jpeg','image/webp','audio/mpeg','audio/wav','audio/mp4','text/vtt']});
export async function saveGeneratedFile(who:BillingIdentity,input:{source:Resource;name:string;mime:string;format:string;bytes:Uint8Array;audit?:string;media?:boolean;expect?:{width?:number;height?:number}}){
 await authorize(who.tenant,who.user.userId,'write');
 const current=await getResource(who.tenant,input.source.id);
 if(current.workspace_id!==who.tenant||current.status==='deleted'||current.version!==input.source.version)throw new AppError('La source a changé. Actualisez avant de l’exporter.',409,'stale_version');
 const bucket=config().BUCKET;if(!bucket)throw new AppError('Stockage des fichiers indisponible.',503);
 const maxBytes=input.media?MEDIA_EXPORT.maxBytes:2*1024*1024;
 if(!input.bytes.length||input.bytes.length>maxBytes)throw new AppError(input.media?'Ce rendu dépasse 100 Mio.':'Ce fichier généré dépasse 2 Mio.',413,'generated_file_limit');
 // Reopen the produced file before saving it: a broken file is never delivered.
 let check:{passed:true;summary:string;details:Record<string,number>};
 try{check=await inspectGeneratedFile(input.format,input.bytes,input.expect);}catch(error){if(error instanceof FileCheckError)throw new AppError(error.message,422,'file_check_failed');throw new AppError('Le fichier produit n’a pas pu être relu. Régénère-le.',422,'file_check_failed');}
 const name=safeFilename(input.name),mime=input.mime;
 if(!(input.media&&MEDIA_EXPORT.mimes.includes(mime))&&!['text/plain','application/zip','application/json','application/pdf',...Object.values({docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})].includes(mime))throw new AppError('Type de fichier généré non autorisé.',400);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input.bytes.slice().buffer as ArrayBuffer)),n=>n.toString(16).padStart(2,'0')).join('');
 const duplicate=()=>db().prepare("SELECT id FROM files WHERE workspace_id=? AND sha256=? AND status='ready'").bind(who.tenant,hash).first<{id:string}>();
 const existing=await duplicate();if(existing)return {...await getClientResource(who.tenant,existing.id),check:check.summary};
 const count=await db().prepare("SELECT COUNT(*) total FROM files WHERE workspace_id=? AND status!='deleted'").bind(who.tenant).first<{total:number}>();
 if((count?.total||0)>=FILE_POLICY.legacyMaxFilesPerWorkspace)throw new AppError('La limite de fichiers de cet espace est atteinte.',429,'file_quota_exceeded');
 const id=uid(),key=who.tenant+'/'+id+'/'+name,now=Date.now();
 await bucket.put(key,input.bytes,{httpMetadata:{contentType:mime}});
 try{const written=await db().batch([
  db().prepare("UPDATE files SET sha256=NULL WHERE workspace_id=? AND sha256=? AND status='deleted'").bind(who.tenant,hash),
  db().prepare("INSERT INTO files(id,workspace_id,owner_id,display_name,storage_name,size_bytes,detected_mime,sha256,status,storage_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'ready',?,?,? WHERE (SELECT COUNT(*) FROM files WHERE workspace_id=? AND status!='deleted')<?").bind(id,who.tenant,who.user.userId,name,name,input.bytes.length,mime,hash,key,now,now,who.tenant,FILE_POLICY.legacyMaxFilesPerWorkspace),
  db().prepare("INSERT INTO resources(id,workspace_id,kind,title,data,status,created_at,updated_at) SELECT ?,?,'file',?,?,'ready',?,? WHERE EXISTS(SELECT 1 FROM files WHERE id=? AND workspace_id=?)").bind(id,who.tenant,name,JSON.stringify({mime,size:input.bytes.length,sha256:hash,format:input.format,sourceId:current.id,sourceVersion:current.version}),now,now,id,who.tenant),
  db().prepare('INSERT INTO billing_meter SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM files WHERE id=? AND workspace_id=?)').bind(uid(),who.organization,'storage',input.bytes.length,now,id,who.tenant),
  db().prepare("INSERT INTO file_upload_audit(id,workspace_id,actor_id,file_id,action,created_at) SELECT ?,?,?,?,'generated',? WHERE EXISTS(SELECT 1 FROM files WHERE id=? AND workspace_id=?)").bind(uid(),who.tenant,who.user.userId,id,now,id,who.tenant)
 ]);if(!written[1]?.meta.changes)throw new AppError('La limite de fichiers de cet espace est atteinte.',429,'file_quota_exceeded');}catch(error){await bucket.delete(key);const raced=await duplicate();if(raced)return {...await getClientResource(who.tenant,raced.id),check:check.summary};throw error;}
 await auditLog(who.tenant,who.user.userId,input.audit||'artifact.exported',id,{sourceId:current.id,version:current.version,format:input.format,check:check.details});
 return {...await getClientResource(who.tenant,id),check:check.summary};
}
