import {z} from 'zod';
import {AppError} from './core.mjs';
import {config,db,createResource,updateResource,authorize,auditLog} from './server';
import {operationResource,executeWorkflow} from './agent-operations';
import {fingerprint,workflowRows} from './workflow-contract';
import {boundedJSONStructure} from './private-json';
import type {AgentScope} from './agent-state';
const ref=z.string().min(1).max(160);
export async function subscribeEvent(scope:AgentScope,input:unknown){
 await authorize(scope.tenant,scope.userId||'','write');
 const p=z.object({workflowId:ref,workflowVersion:z.number().int().positive(),title:z.string().trim().min(1).max(160),maxEvents:z.number().int().min(1).max(500),expiresAt:z.number().int().positive()}).strict().parse(input),workflow=await operationResource(scope,p.workflowId,'workflow');
 if(p.expiresAt<=Date.now()+60000||p.expiresAt>Date.now()+30*86400000)throw new AppError('Choisissez une échéance entre une minute et trente jours.');
 if(workflow.status!=='active'||workflow.version!==p.workflowVersion)throw new AppError('Choisissez un workflow actif et sa version actuelle.',409,'workflow_inactive');
 return createResource(scope.tenant,'event_subscription',p.title,{ownerId:scope.userId,projectId:scope.projectId??null,conversationId:scope.conversationId,workflowId:workflow.id,workflowVersion:workflow.version,maxEvents:p.maxEvents,expiresAt:p.expiresAt,execution:'deterministic_private_tables'},'draft');
}
export async function commandSubscription(scope:AgentScope,input:unknown){
 const p=z.object({id:ref,version:z.number().int().positive(),action:z.enum(['activate','disable','signing_key']),confirmed:z.boolean().optional()}).strict().parse(input),r=await operationResource(scope,p.id,'event_subscription');
 await authorize(scope.tenant,scope.userId!,p.action==='activate'?'approve':'write');
 if(r.version!==p.version)throw new AppError('Cette souscription a changé.',409,'stale_version');
 if(p.action==='signing_key'){if(r.status!=='active')throw new AppError('Souscription inactive.',409);const signingKey=await subscriptionKey(r.id,r.version);await auditLog(scope.tenant,scope.userId!,'event.signing_key_retrieved',r.id,{version:r.version});return {id:r.id,version:r.version,signingKey};}
 if(p.action==='activate'){
  if(Number(r.data.expiresAt)<=Date.now())throw new AppError('Cette souscription a expiré.',409,'event_expired');
  try{await db().prepare('SELECT 1 FROM agent_event_deliveries LIMIT 0').all();}catch{throw new AppError('La réception des événements attend la préparation du stockage.',503,'event_storage_pending');}
  if(p.confirmed!==true)throw new AppError('Confirmez le traitement privé de chaque tableau reçu.',409,'approval_required');
  const workflow=await operationResource(scope,String(r.data.workflowId),'workflow');
  if(workflow.status!=='active'||workflow.version!==r.data.workflowVersion)throw new AppError('Le workflow a changé. Préparez une nouvelle souscription.',409,'workflow_inactive');
 }
 const result=await updateResource(scope.tenant,r.id,r.version,{status:p.action==='activate'?'active':'disabled'});
 await auditLog(scope.tenant,scope.userId!,'event.'+p.action,r.id,{version:result.version,workflowId:r.data.workflowId,workflowVersion:r.data.workflowVersion});return result;
}
async function subscriptionKey(id:string,version:number){
 const secret=config().AUTH_HASH_SECRET;if(!secret||secret.length<32)throw new AppError('Signature des événements indisponible.',503,'event_signing_unavailable');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('braand:event:'+id+':'+version))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function boundedBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>210000){await reader.cancel();throw new AppError('Événement trop volumineux.',413);}chunks.push(part.value);}const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}return new TextDecoder().decode(bytes);}finally{reader.releaseLock();}
}
export async function receiveAgentEvent(request:Request,id:string,now=Date.now()){
 const eventId=request.headers.get('x-braand-event-id')||'',timestamp=request.headers.get('x-braand-timestamp')||'',signature=request.headers.get('x-braand-signature')||'';
 if(!/^[A-Za-z0-9_.:-]{8,100}$/.test(eventId)||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000||!/^sha256=[a-f0-9]{64}$/.test(signature))throw new AppError('Signature d’événement invalide.',401,'event_signature_invalid');
 const row=await db().prepare("SELECT workspace_id,data,version,status FROM resources WHERE id=? AND kind='event_subscription'").bind(id).first<{workspace_id:string;data:string;version:number;status:string}>();
 if(!row||row.status!=='active')throw new AppError('Signature d’événement invalide.',401,'event_signature_invalid');
 const raw=await boundedBody(request),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(await subscriptionKey(id,row.version)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new Uint8Array(signature.slice(7).match(/../g)!.map(value=>parseInt(value,16)));
 if(!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+eventId+'.'+raw)))throw new AppError('Signature d’événement invalide.',401,'event_signature_invalid');
 let payload:unknown;try{payload=boundedJSONStructure(JSON.parse(raw));}catch{throw new AppError('Corps d’événement invalide.',400);}
 const {rows}=z.object({rows:workflowRows}).strict().parse(payload),data=JSON.parse(row.data) as Record<string,unknown>;
 // A signed event never supplies actor, workspace, project, instruction or tools.
 // Recheck the originally approved actor and conversation on every delivery.
 const scope:AgentScope={tenant:row.workspace_id,userId:String(data.ownerId),conversationId:String(data.conversationId),projectId:typeof data.projectId==='string'?data.projectId:null,runId:'event',coveredRowid:0};
 const current=await operationResource(scope,id,'event_subscription');if(current.version!==row.version||current.status!=='active')throw new AppError('Événement révoqué.',409);
 if(Number(data.expiresAt)<=now)throw new AppError('Cette souscription a expiré.',409,'event_expired');
 const payloadDigest=await fingerprint(rows);
 const claim=await db().prepare("INSERT OR IGNORE INTO agent_event_deliveries(subscription_id,event_id,payload_digest,status,created_at) SELECT ?,?,?,'running',? WHERE (SELECT COUNT(*) FROM agent_event_deliveries WHERE subscription_id=?)<? AND EXISTS(SELECT 1 FROM resources WHERE id=? AND version=? AND status='active')").bind(id,eventId,payloadDigest,now,id,Number(data.maxEvents),id,row.version).run();
 if(!claim.meta.changes){const previous=await db().prepare('SELECT status,resource_id,payload_digest FROM agent_event_deliveries WHERE subscription_id=? AND event_id=?').bind(id,eventId).first<{status:string;resource_id:string|null;payload_digest:string}>();if(previous&&previous.payload_digest!==payloadDigest)throw new AppError('Identifiant déjà reçu avec un autre contenu.',409,'idempotency_conflict');if(previous?.status==='completed')return {eventId,status:'completed',resultId:previous.resource_id,reused:true,providerCalls:0};if(previous)throw new AppError('Ce résultat doit être vérifié avant toute reprise.',409,'execution_uncertain');throw new AppError('Le plafond des événements est atteint ou la souscription a changé.',409,'event_limit');}
 try{
  const result=await executeWorkflow(scope,{id:data.workflowId,version:data.workflowVersion,requestId:await fingerprint([id,eventId]),rows});
  await db().prepare("UPDATE agent_event_deliveries SET status='completed',resource_id=? WHERE subscription_id=? AND event_id=? AND status='running'").bind(result.id,id,eventId).run();
  return {eventId,status:result.status,resultId:result.id,reused:'reused' in result&&result.reused===true,providerCalls:0};
 }catch(error){await db().prepare("UPDATE agent_event_deliveries SET status='uncertain' WHERE subscription_id=? AND event_id=? AND status='running'").bind(id,eventId).run();throw error;}
}
