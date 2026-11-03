import {db,getClientResource,getResource} from './server';
import {AppError} from './core.mjs';
import {richInputSchema,type RichObject,type RichResponse} from './rich-response';
import {assertProjectResource,conversationProject} from './project-context';

export async function prepareRichResponse(tenant:string,conversationId:string,messageId:string,callId:string,input:unknown):Promise<RichResponse>{
 const parsed=richInputSchema.parse(input),projectId=await conversationProject(tenant,conversationId),objects:RichObject[]=[];
 for(const block of parsed.blocks){
  if(block.type!=='objects'&&block.type!=='files')continue;
  for(const ref of block.refs){
   await assertProjectResource(tenant,ref.id,projectId);
   const r=await getClientResource(tenant,ref.id);
   if(r.version!==ref.version||r.kind!==ref.kind)throw new AppError('Cet élément a changé. Relisez sa version actuelle.',409,'stale_version');
   const details:Record<string,string|number|null>={};
   for(const key of ['platform','accountId','projectId','currency','dailyBudget','totalBudget','spend','period','results','metric','scheduledAt','timezone','nextRunAt','lastResult','summary']){const v=r.data[key];details[key]=typeof v==='string'?v.slice(0,1000):typeof v==='number'&&Number.isFinite(v)?v:null;}
   const object:RichObject={id:r.id,kind:r.kind,title:r.title,version:r.version,status:r.status,details};
   if(r.kind==='file'){const file=await import('./server').then(m=>m.getFile(tenant,r.id));object.file=file.public as RichObject['file'];}
   if(!objects.some(item=>item.id===r.id))objects.push(object);
  }
 }
 return {version:1,id:callId,messageId,conversationId,workspaceId:tenant,projectId,retrievedAt:Date.now(),blocks:parsed.blocks,objects};
}
export async function persistRichResponse(response:RichResponse){
 const row=await db().prepare("SELECT content FROM messages WHERE id=? AND workspace_id=? AND conversation_id=? AND role='assistant'").bind(response.messageId,response.workspaceId,response.conversationId).first<{content:string}>();
 if(!row)throw new AppError('Message introuvable.',404);
 const blocks=JSON.parse(row.content) as {type:string;response?:RichResponse}[];
 if(blocks.some(b=>b.type==='ui_response'&&b.response?.id===response.id))return;
 if(blocks.filter(b=>b.type==='ui_response').length>=3)throw new AppError('Limite de présentations atteinte.',400);
 blocks.push({type:'ui_response',response});
 const updated=await db().prepare('UPDATE messages SET content=? WHERE id=? AND workspace_id=? AND content=?').bind(JSON.stringify(blocks),response.messageId,response.workspaceId,row.content).run();
 if(updated.meta.changes!==1)throw new AppError('La réponse a changé. Réessayez après relecture.',409);
}
export async function readRichResponse(tenant:string,messageId:string,responseId:string){
 const row=await db().prepare("SELECT conversation_id,content FROM messages WHERE id=? AND workspace_id=? AND role='assistant'").bind(messageId,tenant).first<{conversation_id:string;content:string}>();
 if(!row)throw new AppError('Réponse introuvable.',404);
 const conversation=await getResource(tenant,row.conversation_id);if(conversation.status==='deleted')throw new AppError('Discussion indisponible.',404);
 const block=(JSON.parse(row.content) as {type:string;response?:RichResponse}[]).find(b=>b.type==='ui_response'&&b.response?.id===responseId);
 if(!block?.response)throw new AppError('Présentation introuvable.',404);
 const projectId=await conversationProject(tenant,row.conversation_id);if(projectId!==block.response.projectId)throw new AppError('Le contexte a changé.',409);
 return block.response;
}
