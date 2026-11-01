import {z} from 'zod';
import {AppError} from './core.mjs';
import {db,getResource,updateResource} from './server';
import {containsCredential} from './agent-profile';
import type {AgentScope} from './agent-state';

// Learning is sourced workspace memory, never policy/code/model modification.
const learningSchema=z.object({quote:z.string().trim().min(4).max(1200),kind:z.enum(['preference','correction','method']),replaces:z.object({id:z.string().min(1).max(160),version:z.number().int().positive()}).strict().optional()}).strict();
function userText(content:string){
 let value:unknown;try{value=JSON.parse(content);}catch{return null;}
 if(typeof value==='string')return value;
 if(!Array.isArray(value)||value.some(block=>block?.type==='tool_result'))return null;
 return value.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n');
}
export async function recordUserLearning(scope:AgentScope,input:unknown){
 const p=learningSchema.parse(input);
 if(containsCredential(p.quote))throw new AppError('Un secret ne peut pas devenir un apprentissage.',400,'learning_secret_rejected');
 const run=await db().prepare('SELECT status,conversation_id FROM runs WHERE id=? AND workspace_id=?').bind(scope.runId,scope.tenant).first<{status:string;conversation_id:string}>();
 if(run?.status!=='streaming'||run.conversation_id!==scope.conversationId)throw new AppError('Contexte d’apprentissage inactif.',409,'learning_scope_invalid');
 const rows=await db().prepare("SELECT rowid seq,content FROM messages WHERE workspace_id=? AND conversation_id=? AND role='user' AND rowid<=? ORDER BY rowid DESC LIMIT 20").bind(scope.tenant,scope.conversationId,scope.coveredRowid).all<{seq:number;content:string}>();
 const latest=rows.results.map(row=>({...row,text:userText(row.content)})).find(row=>row.text!==null);
 if(!latest?.text?.includes(p.quote))throw new AppError('La citation doit provenir du dernier message utilisateur réel de cette conversation.',400,'learning_source_unverified');
 const now=Date.now(),data={content:p.quote,source:`Conversation ${scope.conversationId}, message ${latest.seq} : citation utilisateur exacte.`,memoryType:p.kind==='preference'?'preference':'decision',validatedAt:now,learning:{kind:p.kind,sourceConversationId:scope.conversationId,sourceRowid:latest.seq,runId:scope.runId,evidence:'exact_user_quote',recordedAt:now}},title=(p.kind==='preference'?'Préférence : ':p.kind==='correction'?'Correction : ':'Méthode : ')+p.quote.slice(0,120);
 if(p.replaces){
  const previous=await getResource(scope.tenant,p.replaces.id);
  if(previous.kind!=='knowledge'||previous.status!=='saved')throw new AppError('Souvenir à corriger introuvable.',404);
  return updateResource(scope.tenant,previous.id,p.replaces.version,{title,data,status:'saved'});
 }
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope.tenant,scope.conversationId,latest.seq,p.kind,p.quote]))),id='learning-'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 const previous=await db().prepare('SELECT id,status FROM resources WHERE id=? AND workspace_id=?').bind(id,scope.tenant).first<{id:string;status:string}>();
 if(previous?.status==='deleted')throw new AppError('Cet apprentissage a été retiré ; il ne sera pas restauré automatiquement.',409,'learning_withdrawn');
 await db().prepare("INSERT OR IGNORE INTO resources (id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,'knowledge',?,?,'saved',?,?)").bind(id,scope.tenant,title,JSON.stringify(data),now,now).run();
 const saved=await getResource(scope.tenant,id);
 if(saved.status!=='saved')throw new AppError('Cet apprentissage n’est plus actif.',409,'learning_withdrawn');
 return saved;
}
