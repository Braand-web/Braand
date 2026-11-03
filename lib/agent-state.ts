import {z} from 'zod';
import {db,getResource,uid} from './server';
import {AppError,safeWebURL} from './core.mjs';
import {pageSchema} from './contracts';
import {deliverableInput} from './agent-deliverables';
export type AgentScope={tenant:string;conversationId:string;runId:string;coveredRowid:number;projectId?:string|null;userId?:string;referenceProjectIds?:string[]};
const ref=z.string().min(1).max(160);
const criterion=z.string().min(1).max(500);
export const checkpointSchema=z.object({version:z.number().int().nonnegative(),summary:z.string().min(1).max(6000),decisions:z.array(criterion).max(20),pending:z.array(criterion).max(20),resourceIds:z.array(ref).max(30),language:z.string().min(1).max(80)}).strict();
export const planSchema=z.object({id:ref.optional(),version:z.number().int().nonnegative(),objective:z.string().min(1).max(2000),steps:z.array(z.object({id:ref,title:criterion,dependsOn:z.array(ref).max(20),criteria:z.array(criterion).min(1).max(10),state:z.enum(['pending','in_progress','blocked','verified']),resourceIds:z.array(ref).max(12)}).strict()).min(1).max(20)}).strict();
const q=(sql:string,...args:(string|number)[])=>db().prepare(sql).bind(...args);
async function assertScope(s:AgentScope){const run=await q("SELECT id FROM runs WHERE id=? AND workspace_id=? AND conversation_id=? AND status='streaming'",s.runId,s.tenant,s.conversationId).first();if(!run)throw new AppError('Exécution inactive ou hors périmètre.',409,'run_inactive');}
async function ownReferences(s:AgentScope,ids:string[]){for(const id of new Set(ids)){const r=await getResource(s.tenant,id);if(r.status==='deleted')throw new AppError('Référence retirée.',409);}}
export async function saveCheckpoint(s:AgentScope,input:unknown){
 const {version,...state}=checkpointSchema.parse(input);await assertScope(s);await ownReferences(s,state.resourceIds);
 const current=await q('SELECT version,covered_rowid FROM agent_checkpoints WHERE workspace_id=? AND conversation_id=?',s.tenant,s.conversationId).first<{version:number;covered_rowid:number}>();
 if(current&&current.covered_rowid>s.coveredRowid)throw new AppError('Le contexte a avancé.',409,'stale_checkpoint');
 const result=current?await q('UPDATE agent_checkpoints SET state=?,covered_rowid=?,version=version+1,updated_at=? WHERE workspace_id=? AND conversation_id=? AND version=?',JSON.stringify(state),s.coveredRowid,Date.now(),s.tenant,s.conversationId,version).run():version===0?await q('INSERT OR IGNORE INTO agent_checkpoints(workspace_id,conversation_id,state,covered_rowid,updated_at) VALUES (?,?,?,?,?)',s.tenant,s.conversationId,JSON.stringify(state),s.coveredRowid,Date.now()).run():null;
 if(!result?.meta.changes)throw new AppError('Checkpoint périmé.',409,'stale_checkpoint');return {status:'checkpoint_saved',version:version+1,coveredRowid:s.coveredRowid};
}
export async function savePlan(s:AgentScope,input:unknown){
 const p=planSchema.parse(input);await assertScope(s);const byId=new Map(p.steps.map(step=>[step.id,step]));if(byId.size!==p.steps.length)throw new AppError('Identifiants d’étapes dupliqués.');
 const visiting=new Set<string>(),done=new Set<string>();
 const visit=(id:string)=>{if(visiting.has(id))throw new AppError('Dépendance cyclique.');if(done.has(id))return;const step=byId.get(id);if(!step)throw new AppError('Dépendance absente.');visiting.add(id);step.dependsOn.forEach(visit);visiting.delete(id);done.add(id);};p.steps.forEach(step=>visit(step.id));
 await ownReferences(s,p.steps.flatMap(step=>step.resourceIds));
 for(const step of p.steps){if(['in_progress','verified'].includes(step.state)&&step.dependsOn.some(id=>byId.get(id)?.state!=='verified'))throw new AppError('Une dépendance reste non vérifiée.',409,'dependency_pending');if(step.state==='verified'){if(!step.resourceIds.length)throw new AppError('Une étape vérifiée exige un livrable.',409);for(const id of step.resourceIds){const r=await getResource(s.tenant,id),v=await q("SELECT result FROM agent_verifications WHERE workspace_id=? AND resource_id=? AND resource_version=? ORDER BY created_at DESC,rowid DESC LIMIT 1",s.tenant,id,r.version).first<{result:string}>();if(!v||JSON.parse(v.result).status!=='structurally_verified')throw new AppError('Une vérification indépendante actuelle est requise.',409,'verification_required');}}}
 const id=p.id||uid();let result;
 if(p.id)result=await q('UPDATE agent_plans SET objective=?,steps=?,run_id=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND conversation_id=? AND version=?',p.objective,JSON.stringify(p.steps),s.runId,Date.now(),id,s.tenant,s.conversationId,p.version).run();
 else{if(p.version!==0)throw new AppError('Un nouveau plan commence à la version zéro.');result=await q('INSERT INTO agent_plans(id,workspace_id,conversation_id,run_id,objective,steps,updated_at) VALUES (?,?,?,?,?,?,?)',id,s.tenant,s.conversationId,s.runId,p.objective,JSON.stringify(p.steps),Date.now()).run();}
 if(!result.meta.changes)throw new AppError('Plan périmé ou hors périmètre.',409,'stale_plan');return {id,kind:'work_plan_checkpoint',version:p.version+1,steps:p.steps,status:p.steps.every(step=>step.state==='verified')?'structurally_verified':'in_progress',semanticReview:'not_confirmed'};
}
export const verificationSchema=z.object({id:ref,version:z.number().int().positive(),criteria:z.array(criterion).min(1).max(10),requiredSources:z.boolean(),requiredResourceIds:z.array(ref).max(20)}).strict();
export async function verifyDeliverable(s:AgentScope,input:unknown){
 const p=verificationSchema.parse(input);await assertScope(s);const r=await getResource(s.tenant,p.id);const checks:{name:string;passed:boolean;detail:string}[]=[];
 checks.push({name:'version',passed:r.version===p.version,detail:'Version persistée '+r.version},{name:'status',passed:!['deleted','failed','uncertain','awaiting_approval','pending','executing','generating'].includes(r.status),detail:r.status});
 checks.push({name:'artifact_kind',passed:['page','media','deliverable'].includes(r.kind),detail:r.kind});
 let contentPresent=false;try{
 if(r.kind==='page')contentPresent=pageSchema.safeParse(r.data.current).success;
 else if(r.kind==='deliverable')contentPresent=deliverableInput.safeParse(Object.fromEntries(['title','content','summary','category','sources'].map(key=>[key,r.data[key]]))).success;
 else if(r.kind==='media'&&r.status==='ready'){const output=r.data.output as {images?:{url?:string}[];video?:{url?:string};audio?:{url?:string}};const urls=[...(output?.images||[]).map(image=>image.url),output?.video?.url,output?.audio?.url].filter((value):value is string=>typeof value==='string');contentPresent=urls.some(url=>{try{safeWebURL(url);return true;}catch{return false;}});}
 }catch{/* Invalid data cannot prove a deliverable. */}
 checks.push({name:'content',passed:contentPresent,detail:r.kind});
 const sources=r.data.sources;checks.push({name:'sources',passed:!p.requiredSources||Array.isArray(sources)&&sources.length>0&&sources.every(value=>typeof value==='string'&&value.trim()),detail:'Présence de références seulement ; leur exactitude requiert un contrôle métier.'});
 for(const id of p.requiredResourceIds){let passed=false;try{const linked=await getResource(s.tenant,id);passed=!['deleted','failed','uncertain','awaiting_approval','pending'].includes(linked.status);}catch{/* Foreign and absent references remain indistinguishable. */}checks.push({name:'dependency',passed,detail:id});}
 const status=checks.every(check=>check.passed)?'structurally_verified':'partial';
 const result={status,resourceId:r.id,version:r.version,resourceStatus:r.status,checks,criteria:p.criteria,semanticReview:'required',executionConfirmed:false,notice:'Contrôle déterministe de la ressource enregistrée ; ne prouve ni sa qualité métier, ni une publication, un paiement ou une exécution externe.'};
 await q('INSERT INTO agent_verifications(id,workspace_id,run_id,resource_id,resource_version,result,created_at) VALUES (?,?,?,?,?,?,?)',uid(),s.tenant,s.runId,r.id,r.version,JSON.stringify(result),Date.now()).run();return result;
}
