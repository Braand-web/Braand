// Short-lived link that Excel or Word can open directly (ms-excel:/ms-word:
// protocol). Office apps fetch the file themselves, without the browser
// cookie, so the link carries a signed token: one file, five minutes, Office
// formats only, and the user must still have access when it is used.
import {privateJSON} from '@/lib/private-json';
import {z} from 'zod';
import {db,failure,fileIdentity,config,uid} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {FILE_POLICY,issueFileToken} from '@/lib/file-policy.mjs';

export const OFFICE_LINK_MIMES:Record<string,{app:string;scheme:string;ext:string}>={
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{app:'Excel',scheme:'ms-excel',ext:'xlsx'},
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':{app:'Word',scheme:'ms-word',ext:'docx'},
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':{app:'PowerPoint',scheme:'ms-powerpoint',ext:'pptx'},
};
export function officeSigningSecret(){const cfg=config(),secret=cfg.FILE_URL_SIGNING_SECRET||cfg.TOKEN_ENCRYPTION_KEY;if(!secret||secret.length<32)throw new AppError('Ouverture directe indisponible : téléchargez le fichier.',503,'office_link_unavailable');return secret;}

export async function POST(request:Request){try{
 const {tenant,user}=await fileIdentity(request);
 const {id}=z.object({id:z.string().min(1).max(160)}).strict().parse(await privateJSON(request,4096));
 const file=await db().prepare("SELECT id,display_name,detected_mime FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(id,tenant).first<{id:string;display_name:string;detected_mime:string}>();
 const kind=file?OFFICE_LINK_MIMES[file.detected_mime]:undefined;
 if(!file||!kind)throw new AppError('Seuls les fichiers Word, Excel et PowerPoint s’ouvrent directement.',404,'file_not_found');
 const now=Date.now(),token=await issueFileToken(officeSigningSecret(),{fileId:id,userId:user.userId,workspaceId:tenant,scope:'office'},now);
 const name=(file.display_name.replace(/\.[a-z0-9]+$/i,'').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,80)||'document')+'.'+kind.ext;
 const url=new URL(`/api/office-link/${encodeURIComponent(token)}/${encodeURIComponent(name)}`,request.url).toString();
 await db().prepare("INSERT INTO file_upload_audit (id,workspace_id,actor_id,file_id,action,created_at) VALUES (?,?,?,?,'url_signed',?)").bind(uid(),tenant,user.userId,id,now).run();
 return Response.json({url,officeUrl:`${kind.scheme}:ofe|u|${url}`,app:kind.app,expiresAt:now+FILE_POLICY.signedUrlTtlMs});
 }catch(error){return failure(error);}}
