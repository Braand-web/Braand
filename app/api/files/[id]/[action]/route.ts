import {privateJSON} from '@/lib/private-json';
import {env} from "cloudflare:workers";
import {z} from "zod";
import {fileIdentity,db,failure,config,uid} from "@/lib/server";
import {AppError} from "@/lib/core.mjs";
import {FILE_POLICY,contentSecurityHeaders,issueFileToken,verifyFileToken} from "@/lib/file-policy.mjs";
import type {FileRecord} from "@/lib/contracts";

type Context={params:Promise<{id:string;action:string}>};
const enabled=()=>config().FILE_PREVIEW_V1==="true";
const notFound=()=>new AppError("Fichier introuvable.",404,"file_not_found");
function signingSecret(){const cfg=config(),secret=cfg.FILE_URL_SIGNING_SECRET||cfg.TOKEN_ENCRYPTION_KEY;if(!secret||secret.length<32)throw new AppError("Les liens temporaires de fichiers ne sont pas configurés.",503,"file_signing_unavailable");return secret;}

export async function POST(request:Request,context:Context){try{
 if(!enabled())throw notFound();
 const {tenant,user}=await fileIdentity(request),{id,action}=await context.params;if(action!=="url")throw notFound();
 const {scope}=z.object({scope:z.enum(["content","download","thumbnail"])}).strict().parse(await privateJSON(request,1048576));
 const file=await db().prepare("SELECT id,status FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(id,tenant).first<{id:string;status:string}>();if(!file)throw notFound();
 const now=Date.now(),token=await issueFileToken(signingSecret(),{fileId:id,userId:user.userId,workspaceId:tenant,scope},now);
 const url=new URL(`/api/files/${encodeURIComponent(id)}/${scope}?token=${encodeURIComponent(token)}`,request.url).toString();
 await db().prepare("INSERT INTO file_upload_audit (id,workspace_id,actor_id,file_id,action,created_at) VALUES (?,?,?,?,'url_signed',?)").bind(uid(),tenant,user.userId,id,now).run();
 return Response.json({url,expiresAt:now+FILE_POLICY.signedUrlTtlMs});
 }catch(error){return failure(error);}}

function parseRange(value:string,size:number){
 const match=/^bytes=(\d*)-(\d*)$/u.exec(value);
 if(!match||(!match[1]&&!match[2]))return null;
 let start:number,end:number;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=size)return null;
 return {start,end:Math.min(end,size-1)};
}

export async function GET(request:Request,context:Context){try{
 if(!enabled())throw notFound();
 const {tenant,user,organization}=await fileIdentity(request),{id,action}=await context.params;
 if(action==="metadata"){
  const file=await db().prepare("SELECT id,status,display_name,size_bytes,detected_mime,created_at FROM files WHERE id=? AND workspace_id=?").bind(id,tenant).first<{id:string;status:string;display_name:string;size_bytes:number;detected_mime:string;created_at:number}>();
  if(!file)throw notFound();
  const unavailable=file.status==="deleted"||file.status==="rejected";
  return Response.json({id:file.id,name:unavailable?file.status==="deleted"?"Fichier supprimé":"Fichier indisponible":file.display_name,size:Number(file.size_bytes||0),mime:file.detected_mime||"application/octet-stream",status:file.status,createdAt:Number(file.created_at||0)},{headers:{"Cache-Control":"private, no-store"}});
 }
 if(!["content","download","thumbnail"].includes(action))throw notFound();
 const token=new URL(request.url).searchParams.get("token");
 const scope=action as "content"|"download"|"thumbnail";
 const [file,valid]=await Promise.all([
  db().prepare("SELECT * FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(id,tenant).first<FileRecord>(),
  verifyFileToken(signingSecret(),token,{fileId:id,userId:user.userId,workspaceId:tenant,scope}),
 ]);
 if(!valid||!file)throw notFound();
 const key=scope==="thumbnail"?file.thumbnail_key:file.storage_key;if(!key)throw notFound();
 const object=await env.BUCKET?.get(key);if(!object)throw notFound();
 await db().prepare("INSERT INTO billing_meter VALUES (?,?,?,?,?)").bind(uid(),organization,"transfer",object.size,Date.now()).run();
 const mime=scope==="thumbnail"?"image/jpeg":String(file.detected_mime||"application/octet-stream");
 const headers:Record<string,string>={...contentSecurityHeaders(mime,scope==="download"?"attachment":"inline",file.display_name)};
 headers["Accept-Ranges"]="bytes";headers["Content-Length"]=String(object.size);
 const rangeHeader=request.headers.get("range"),isMedia=mime.startsWith("audio/")||mime.startsWith("video/");
 if(rangeHeader&&isMedia){
  const range=parseRange(rangeHeader,object.size);
  if(!range){const invalidHeaders:Record<string,string>={...contentSecurityHeaders(mime,"attachment",file.display_name),"Content-Range":`bytes */${object.size}`,"Accept-Ranges":"bytes"};return new Response(null,{status:416,headers:invalidHeaders});}
  const bytes=new Uint8Array(await object.arrayBuffer()),body=bytes.slice(range.start,range.end+1);
  headers["Content-Length"]=String(body.byteLength);headers["Content-Range"]=`bytes ${range.start}-${range.end}/${object.size}`;
  return new Response(body,{status:206,headers});
 }
 return new Response(object.body,{headers});
 }catch(error){return failure(error);}}
