import {z} from 'zod';
import {identity,failure,getClientResource,auditLog,db,authorize} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {readRichResponse,prepareRichResponse} from '@/lib/rich-response-server';
import {assertProjectResource} from '@/lib/project-context';
import {AppError} from '@/lib/core.mjs';

export async function POST(request:Request){try{
 const who=await identity(request,'read');
 const p=z.object({messageId:z.string().max(160),responseId:z.string().max(160),blockId:z.string().max(160),action:z.enum(['open','refresh','respond']),objectId:z.string().max(160).optional(),values:z.record(z.string().max(2000)).optional()}).strict().parse(await privateJSON(request,24000));
 const response=await readRichResponse(who.tenant,p.messageId,p.responseId),block=response.blocks.find(b=>b.id===p.blockId);
 if(!block)throw new AppError('Composant introuvable.',404);
 if(p.action==='refresh'){
  const fresh=await prepareRichResponse(who.tenant,response.conversationId,response.messageId,response.id,{version:1,blocks:await Promise.all(response.blocks.map(async b=>b.type==='objects'||b.type==='files'?{...b,refs:await Promise.all(b.refs.map(async ref=>{const r=await assertProjectResource(who.tenant,ref.id,response.projectId);return {id:r.id,kind:r.kind,version:r.version};}))}:b))});
  return Response.json({response:fresh,historicalSnapshotUnchanged:true},{headers:{'Cache-Control':'private, no-store'}});
 }
 if(p.action==='open'){
  if((block.type!=='objects'&&block.type!=='files')||!block.refs.some(r=>r.id===p.objectId))throw new AppError('Action hors périmètre.',403);
  await assertProjectResource(who.tenant,p.objectId!,response.projectId);
  return Response.json({resource:await getClientResource(who.tenant,p.objectId!)},{headers:{'Cache-Control':'private, no-store'}});
 }
 if(block.type!=='form'&&block.type!=='choices')throw new AppError('Ce composant ne reçoit pas de réponse.',400);
 await authorize(who.tenant,who.user.userId,'write');
 const values=p.values||{};
 if(block.type==='choices'){if(Object.keys(values).some(k=>k!=='option')||!block.options.some(o=>o.id===values.option))throw new AppError('Choix invalide.',400);}
 else{
  if(Object.keys(values).some(k=>!block.fields.some(f=>f.id===k)))throw new AppError('Champ inconnu.',400);
  for(const f of block.fields){const v=values[f.id]||'';if(f.required&&!v.trim()||v&&f.type==='number'&&!Number.isFinite(Number(v))||v&&f.type==='select'&&!f.options?.includes(v))throw new AppError('Vérifiez le champ « '+f.label+' ».',400);}
 }
 // A submission records answers only. It never grants authority to execute a business action.
 const key=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([who.tenant,who.user.userId,p.messageId,p.responseId,p.blockId])));
 const id='response-'+Array.from(new Uint8Array(key),b=>b.toString(16).padStart(2,'0')).join('');
 const existing=await db().prepare("SELECT data FROM resources WHERE id=? AND workspace_id=? AND kind='response_interaction'").bind(id,who.tenant).first<{data:string}>();
 let saved=existing?JSON.parse(existing.data):{messageId:p.messageId,responseId:p.responseId,blockId:p.blockId,projectId:response.projectId,values};
 if(!existing){const now=Date.now();await db().prepare("INSERT OR IGNORE INTO resources(id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,'response_interaction','Réponse au formulaire',?,'saved',?,?)").bind(id,who.tenant,JSON.stringify(saved),now,now).run();await auditLog(who.tenant,who.user.userId,'response.submitted',id,{messageId:p.messageId,blockId:p.blockId});}
 const persisted=await db().prepare("SELECT data FROM resources WHERE id=? AND workspace_id=? AND kind='response_interaction'").bind(id,who.tenant).first<{data:string}>();
 if(!persisted)throw new AppError('Réponse non enregistrée.',500);
 saved=JSON.parse(persisted.data);
 return Response.json({status:'saved',id,values:saved.values,conversationId:response.conversationId,prompt:'Voici ma réponse au composant '+p.blockId+' du message '+p.messageId+' : '+JSON.stringify(saved.values)+'. Poursuis cette demande; ceci ne constitue pas une autorisation de publication ou de dépense.'},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return failure(error);}}

export async function GET(request:Request){try{
 const who=await identity(request,'read'),url=new URL(request.url);
 const messageId=url.searchParams.get('messageId')||'',responseId=url.searchParams.get('responseId')||'',blockId=url.searchParams.get('blockId')||'';
 if([messageId,responseId,blockId].some(v=>!v||v.length>160))throw new AppError('Référence invalide.',400);
 const response=await readRichResponse(who.tenant,messageId,responseId);
 if(!response.blocks.some(b=>b.id===blockId&&(b.type==='form'||b.type==='choices')))throw new AppError('Composant introuvable.',404);
 const key=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([who.tenant,who.user.userId,messageId,responseId,blockId])));
 const id='response-'+Array.from(new Uint8Array(key),b=>b.toString(16).padStart(2,'0')).join('');
 const row=await db().prepare("SELECT data FROM resources WHERE id=? AND workspace_id=? AND kind='response_interaction'").bind(id,who.tenant).first<{data:string}>();
 return Response.json({saved:!!row,values:row?JSON.parse(row.data).values:{}},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return failure(error);}}
