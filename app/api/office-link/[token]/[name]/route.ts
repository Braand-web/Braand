import {env} from 'cloudflare:workers';
import {authorize,db,failure,uid} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {contentSecurityHeaders,verifyFileToken} from '@/lib/file-policy.mjs';
import {OFFICE_LINK_MIMES,officeSigningSecret} from '../../route';

type Context={params:Promise<{token:string;name:string}>};
const notFound=()=>new AppError('Lien expiré ou fichier introuvable.',404,'file_not_found');

function claimsOf(token:string){
 try{const payload=token.split('.')[0]||'',json=atob(payload.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-payload.length%4)%4));const claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(json,c=>c.charCodeAt(0))));return typeof claims?.fileId==='string'&&typeof claims?.userId==='string'&&typeof claims?.workspaceId==='string'?claims as {fileId:string;userId:string;workspaceId:string}:null;}catch{return null;}
}

async function serve(context:Context,head:boolean){try{
 const {token}=await context.params,claims=claimsOf(decodeURIComponent(token));if(!claims)throw notFound();
 // The signature covers every claim; checking against the decoded claims proves none was altered.
 if(!await verifyFileToken(officeSigningSecret(),decodeURIComponent(token),{...claims,scope:'office'}))throw notFound();
 try{await authorize(claims.workspaceId,claims.userId,'read');}catch{throw notFound();}
 const file=await db().prepare("SELECT w.organization_id,f.* FROM files f JOIN workspaces w ON w.id=f.workspace_id WHERE f.id=? AND f.workspace_id=? AND f.status='ready'").bind(claims.fileId,claims.workspaceId).first<{organization_id:string;storage_key:string|null;detected_mime:string;display_name:string}>();
 if(!file?.storage_key||!OFFICE_LINK_MIMES[file.detected_mime])throw notFound();
 const object=await (env as unknown as {BUCKET?:R2Bucket}).BUCKET?.get(file.storage_key);if(!object)throw notFound();
 const headers:Record<string,string>={...contentSecurityHeaders(file.detected_mime,'attachment',file.display_name),'Content-Type':file.detected_mime,'Content-Length':String(object.size),'Referrer-Policy':'no-referrer'};
 if(head)return new Response(null,{headers});
 await db().prepare('INSERT INTO billing_meter VALUES (?,?,?,?,?)').bind(uid(),file.organization_id,'transfer',object.size,Date.now()).run();
 return new Response(object.body,{headers});
 }catch(error){return failure(error);}}

export async function GET(_request:Request,context:Context){return serve(context,false);}
// Office apps probe the link with HEAD and OPTIONS before downloading.
export async function HEAD(_request:Request,context:Context){return serve(context,true);}
export async function OPTIONS(){return new Response(null,{status:204,headers:{Allow:'GET, HEAD, OPTIONS'}});}
