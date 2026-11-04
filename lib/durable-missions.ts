import {z} from 'zod';
import {db,config,uid,getResource,createResource,authorize} from './server';
import {missionSchema} from './contracts';
import {AppError} from './core.mjs';
import {startRunBudget,finishRunBudget,type RunBudget} from './metering';
import {activeRights,type BillingIdentity} from './billing';
import {missionUsageIsKnown,missionCostIsSettled} from './mission-policy.mjs';
import {modelRateSchema} from './model-protocol';

type DurableMission={id:string;workspace_id:string;organization_id:string;actor_id:string;approved_version:number;mandate:string;status:string;cursor:number;budget_units:number;spent_units:number;reserved_units:number;expires_at:number;next_at:number;lease_token:string|null;lease_until:number};
type DurableStep={id:string;mission_id:string;ordinal:number;status:string;run_id:string;conversation_id:string;reserved_units:number;result:string|null;error:string|null};
export type MissionRunner=(tenant:string,conversationId:string,runId:string,emit:(type:string,data:unknown)=>Promise<void>,signal:AbortSignal,budget:RunBudget,workMode?:'accompanied'|'autonomous'|'approved_mission')=>Promise<void>;
async function browserMission(who:BillingIdentity,id:string){const row=await db().prepare('SELECT user_id FROM browser_sessions WHERE id=? AND workspace_id=?').bind(id,who.tenant).first<{user_id:string}>();if(row&&row.user_id!==who.user.userId)throw new AppError('Mission privée introuvable.',404);return row;}
async function rejectBrowserMission(who:BillingIdentity,id:string){if(await browserMission(who,id))throw new AppError('Gérez cette mission dans le panneau Navigateur privé.',409,'browser_use_private_panel');}
const q=(sql:string,...args:(string|number|null)[])=>db().prepare(sql).bind(...args);
const mandateSchema=z.object({version:z.number().int().positive(),approved:z.literal(true),expiresAt:z.number().int(),maxCredits:z.number().int().min(1).max(1000),stepCredits:z.number().int().min(1).max(1000)});
const planSchema=missionSchema.extend({maxCredits:z.number().int().min(1).max(1000),mode:z.literal('autonomous')});
async function audit(who:BillingIdentity,action:string,target:string){await q('INSERT INTO audit(id,workspace_id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?,?)',uid(),who.tenant,who.user.userId,action,target,'{}',Date.now()).run();}
export function durableReadiness(){return {enabled:config().AUTONOMY_ENABLED==='true'&&config().AUTONOMY_SCHEDULER_VERIFIED==='true'&&!!config().SCHEDULER_SECRET,scope:'analysis_drafts_and_approved_connected_reads',externalWrites:'separate_approval_required'};}
// Missions are paid in reserved credits; no subscription tier is required.
async function requireMissionPlan(organization:string){await activeRights(organization);}
type StepResult=Record<string,unknown>&{validation?:{status?:string;digest?:string}};
function stepResult(step:DurableStep):StepResult{try{const value:unknown=JSON.parse(step.result||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value as StepResult:{};}catch{return {};}}
const stepDecisionSchema=z.object({version:z.number().int().positive(),ordinal:z.number().int().nonnegative(),runId:z.string().min(1),digest:z.string().regex(/^[a-f0-9]{64}$/),approved:z.literal(true)}).strict();
// This is a review of persisted evidence, never a model-supplied success flag.
async function reviewStep(who:BillingIdentity,mission:DurableMission,step:DurableStep){
 const rows=await q('SELECT seq,type,data FROM events WHERE run_id=? ORDER BY seq',step.run_id).all<{seq:number;type:string;data:string}>();
 let text='';const resources=new Map<string,{id:string;kind:string;title:string;version:number;status:string}>(),approvalIds=new Set<string>();
 for(const event of rows.results){let data:Record<string,unknown>;try{const value:unknown=JSON.parse(event.data);if(!value||typeof value!=='object'||Array.isArray(value))continue;data=value as Record<string,unknown>;}catch{continue;}
  if(event.type==='text_delta'&&typeof data?.text==='string')text+=data.text;
  const value=event.type==='tool_result'?data?.result:null,output=value&&typeof value==='object'?value as Record<string,unknown>:null;
  if(output&&typeof output.id==='string'&&typeof output.kind==='string')try{
   const resource=await getResource(who.tenant,output.id);if(resource.kind!==output.kind||resource.status==='deleted')continue;
   resources.set(resource.id,{id:resource.id,kind:resource.kind,title:resource.title,version:resource.version,status:resource.status});
   if(['proposal','connector_action'].includes(resource.kind))approvalIds.add(resource.id);
  }catch{/* A missing or foreign resource is not evidence. */}
 }
 const snapshot={eventSeq:rows.results.at(-1)?.seq||0,eventCount:rows.results.length};
 const evidence={text:text.trim(),resources:[...resources.values()]},bytes=new TextEncoder().encode(JSON.stringify({runId:step.run_id,ordinal:step.ordinal,version:mission.approved_version,snapshot,evidence}));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
 const hold=await q('SELECT id,status,actual FROM credit_holds WHERE reference=? AND workspace_id=? AND organization_id=?','chat:'+step.run_id,who.tenant,who.organization).first<{id:string;status:string;actual:number}>();
 const usages=await q('SELECT status FROM provider_usage WHERE run_id=? AND workspace_id=?',step.run_id,who.tenant).all<{status:string}>();
 const pendingApprovals=evidence.resources.filter(resource=>approvalIds.has(resource.id)&&['awaiting_approval','pending','executing','needs_input','uncertain','generating'].includes(resource.status)).map(resource=>resource.id);
 return {...evidence,snapshot,digest,hasEvidence:!!evidence.text||evidence.resources.length>0,costSettled:missionCostIsSettled(hold?.status,usages.results.map(usage=>usage.status)),pendingApprovals,approvalIds:[...approvalIds],validation:stepResult(step).validation||null};
}
// The single UPDATE rechecks every mutable fact used by the user's snapshot.
// Re-reading before this write alone would leave a check/use race in D1.
function stepReviewPredicate(who:BillingIdentity,mission:DurableMission,step:DurableStep,review:Awaited<ReturnType<typeof reviewStep>>,runStatus:string){
 let sql="id=? AND status=? AND run_id=? AND COALESCE(result,'{}')=? AND EXISTS(SELECT 1 FROM durable_missions m JOIN resources r ON r.id=m.id WHERE m.id=? AND m.workspace_id=? AND m.organization_id=? AND m.approved_version=? AND r.version=? AND m.status IN ('waiting_user','suspended') AND r.status IN ('waiting_user','suspended')) AND EXISTS(SELECT 1 FROM runs WHERE id=? AND workspace_id=? AND status=?) AND (SELECT COALESCE(MAX(seq),0) FROM events WHERE run_id=?)=? AND (SELECT COUNT(*) FROM events WHERE run_id=?)=? AND EXISTS(SELECT 1 FROM credit_holds WHERE reference=? AND workspace_id=? AND organization_id=? AND status='settled') AND NOT EXISTS(SELECT 1 FROM provider_usage WHERE run_id=? AND workspace_id=? AND status NOT IN ('complete','rejected'))";
 const args:(string|number|null)[]=[step.id,step.status,step.run_id,step.result||'{}',mission.id,who.tenant,who.organization,mission.approved_version,mission.approved_version,step.run_id,who.tenant,runStatus,step.run_id,review.snapshot.eventSeq,step.run_id,review.snapshot.eventCount,'chat:'+step.run_id,who.tenant,who.organization,step.run_id,who.tenant];
 for(const resource of review.resources){sql+=' AND EXISTS(SELECT 1 FROM resources WHERE id=? AND workspace_id=? AND kind=? AND version=? AND status=? AND title=?)';args.push(resource.id,who.tenant,resource.kind,resource.version,resource.status,resource.title);}
 return {sql,args};
}
export async function missionState(who:BillingIdentity,id:string){
 if(await browserMission(who,id)){const browser=await (await import('./browser')).browserService.get(who,id);const hold=await q('SELECT h.status,h.actual,h.units FROM credit_holds h JOIN browser_sessions b ON b.hold_id=h.id WHERE b.id=?',id).first<{status:string;actual:number;units:number}>();return {id,status:browser.status,cursor:browser.actionsUsed,budget_units:Math.round(browser.maxCredits*100),spent_units:hold?.status==='settled'?hold.actual:0,reserved_units:hold&&hold.status!=='settled'?hold.units:0,expires_at:browser.expiresAt,steps:[],execution:'browser',browserSessionId:id};}
 await getResource(who.tenant,id);const mission=await q('SELECT * FROM durable_missions WHERE id=? AND workspace_id=?',id,who.tenant).first<DurableMission>();if(!mission)return null;
 const steps=await q('SELECT * FROM durable_steps WHERE mission_id=? ORDER BY ordinal',id).all<DurableStep>();
 const cost=await q("SELECT COALESCE(SUM(CASE WHEN h.status='settled' THEN h.actual ELSE 0 END),0) spent_units,COALESCE(SUM(CASE WHEN h.status!='settled' THEN h.units ELSE 0 END),0) reserved_units FROM durable_steps s JOIN credit_holds h ON h.reference='chat:'||s.run_id WHERE s.mission_id=?",id).first<{spent_units:number;reserved_units:number}>();
 return {...mission,...cost,mandate:JSON.parse(mission.mandate),lease_token:undefined,steps:await Promise.all(steps.results.map(async step=>({...step,review:await reviewStep(who,mission,step)})))};
}
async function unvalidatedStep(id:string){return q("SELECT id FROM durable_steps WHERE mission_id=? AND status='completed' AND COALESCE(json_extract(result,'$.validation.status'),'pending')!='accepted' LIMIT 1",id).first();}
async function refreshMissionCost(id:string){await q("UPDATE durable_missions SET spent_units=COALESCE((SELECT SUM(h.actual) FROM durable_steps s JOIN credit_holds h ON h.reference='chat:'||s.run_id WHERE s.mission_id=durable_missions.id AND h.status='settled'),0),reserved_units=COALESCE((SELECT SUM(h.units) FROM durable_steps s JOIN credit_holds h ON h.reference='chat:'||s.run_id WHERE s.mission_id=durable_missions.id AND h.status!='settled'),0) WHERE id=?",id).run();}

export async function reviewMissionStep(who:BillingIdentity,id:string,action:'confirm-step'|'reconcile-step',input:unknown){
 await rejectBrowserMission(who,id);
 await authorize(who.tenant,who.user.userId,'approve');const p=stepDecisionSchema.parse(input),resource=await getResource(who.tenant,id);
 const mission=await q('SELECT * FROM durable_missions WHERE id=? AND workspace_id=? AND organization_id=?',id,who.tenant,who.organization).first<DurableMission>();
 if(!mission)throw new AppError('Mission introuvable.',404);
 if(resource.version!==p.version||mission.approved_version!==p.version)throw new AppError('Le plan a changé. Cette validation est périmée.',409,'stale_mandate');
 const step=await q('SELECT * FROM durable_steps WHERE mission_id=? AND ordinal=? AND run_id=?',id,p.ordinal,p.runId).first<DurableStep>();
 if(!step)throw new AppError('Étape introuvable.',404);
 if(stepResult(step).validation?.status==='accepted'&&stepResult(step).validation?.digest===p.digest)return missionState(who,id);
 if(!['waiting_user','suspended'].includes(mission.status))throw new AppError('Attendez l’arrêt de la mission avant de vérifier cette étape.',409,'mission_not_stopped');
 const run=await q('SELECT status FROM runs WHERE id=? AND workspace_id=?',step.run_id,who.tenant).first<{status:string}>();
 if(!run||run.status==='streaming')throw new AppError('Cette étape est encore en cours.',409,'mission_not_stopped');
 let review=await reviewStep(who,mission,step);
 if(review.digest!==p.digest)throw new AppError('Le résultat a changé. Actualisez avant de le valider.',409,'stale_result');
 if(!review.hasEvidence)throw new AppError('Aucun résultat enregistré ne permet de valider cette étape. Vous pouvez annuler la mission.',409,'mission_result_missing');
 if(action==='reconcile-step'){
  if(step.status!=='uncertain')throw new AppError('Cette étape ne nécessite pas de rapprochement.',409);
  const hold=await q('SELECT id FROM credit_holds WHERE reference=? AND workspace_id=? AND organization_id=?','chat:'+step.run_id,who.tenant,who.organization).first<{id:string}>();
  const usages=await q('SELECT rate,status FROM provider_usage WHERE run_id=? AND workspace_id=?',step.run_id,who.tenant).all<{rate:string;status:string}>();
  if(!hold||!missionUsageIsKnown(usages.results.map(usage=>usage.status)))throw new AppError('Un coût reste inconnu. La réservation est conservée ; aucun appel ne sera relancé.',409,'mission_usage_pending');
  // Only local settled receipts are used. Never contact or resubmit to a provider here.
  await finishRunBudget({runId:step.run_id,holdId:hold.id,rate:usages.results.length?modelRateSchema.parse(JSON.parse(usages.results[0].rate)):undefined});
  review=await reviewStep(who,mission,step);if(review.digest!==p.digest)throw new AppError('Le résultat a changé. Actualisez avant de le rapprocher.',409,'stale_result');if(!review.costSettled)throw new AppError('Le coût doit être rapproché avant de continuer.',409,'mission_usage_pending');
  await authorize(who.tenant,who.user.userId,'approve');
  const guard=stepReviewPredicate(who,mission,step,review,run.status);
  const changed=await q("UPDATE durable_steps SET status='completed',error=NULL,result=?,finished_at=? WHERE "+guard.sql,JSON.stringify({...stepResult(step),runId:step.run_id,approvalIds:review.approvalIds,validation:{status:'pending'},reconciledBy:who.user.userId,reconciledAt:Date.now()}),Date.now(),...guard.args).run();
  if(!changed.meta.changes)throw new AppError('Le statut de cette étape a changé.',409);
  await q("UPDATE durable_missions SET cursor=MAX(cursor,?),lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND status IN ('waiting_user','suspended')",step.ordinal+1,Date.now(),id).run();
  await refreshMissionCost(id);await audit(who,'mission.step_reconciled',id);return missionState(who,id);
 }
 if(step.status!=='completed'||!review.costSettled)throw new AppError('Rapprochez le résultat et son coût avant de le valider.',409,'mission_needs_reconciliation');
 if(review.pendingApprovals.length)throw new AppError('Une proposition attend encore votre décision ou son rapprochement.',409,'mission_approval_pending');
 await authorize(who.tenant,who.user.userId,'approve');
 const guard=stepReviewPredicate(who,mission,step,review,run.status);
 const changed=await q('UPDATE durable_steps SET result=? WHERE '+guard.sql,JSON.stringify({...stepResult(step),validation:{status:'accepted',digest:p.digest,actor:who.user.userId,at:Date.now(),source:'explicit_user_review'}}),...guard.args).run();
 if(!changed.meta.changes)throw new AppError('Le résultat de cette étape a changé.',409,'stale_result');
 const total=planSchema.parse(JSON.parse(mission.mandate)).steps.length;
 const accepted=await q("SELECT COUNT(*) count FROM durable_steps WHERE mission_id=? AND status='completed' AND json_extract(result,'$.validation.status')='accepted'",id).first<{count:number}>();
 if(mission.cursor>=total&&accepted?.count===total){const completion=await db().batch([q("UPDATE durable_missions SET status='completed',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND status IN ('waiting_user','suspended') AND cursor>=? AND (SELECT COUNT(*) FROM durable_steps WHERE mission_id=? AND status='completed' AND json_extract(result,'$.validation.status')='accepted')=?",Date.now(),id,total,id,total),q("UPDATE resources SET status='completed',updated_at=? WHERE id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM durable_missions WHERE id=? AND status='completed')",Date.now(),id,who.tenant,id)]);if(completion[0].meta.changes)await missionNotice(mission,'completed');}
 await audit(who,'mission.step_validated',id);return missionState(who,id);
}
export async function activateMission(who:BillingIdentity,id:string,input:unknown){
 await rejectBrowserMission(who,id);
 await authorize(who.tenant,who.user.userId,'approve');await requireMissionPlan(who.organization);if(!durableReadiness().enabled)throw new AppError('Le planificateur autonome n’est pas encore validé.',503,'autonomy_not_ready');
 const p=mandateSchema.parse(input),resource=await getResource(who.tenant,id),plan=planSchema.parse(resource.data),now=Date.now();
 if(p.maxCredits!==plan.maxCredits||p.stepCredits*plan.steps.length>p.maxCredits)throw new AppError('Le plafond par étape doit respecter le budget total approuvé.',400);
 if(p.expiresAt<=now||p.expiresAt>now+7*86400000)throw new AppError('Le mandat doit expirer dans les sept jours.',400);
 const mandate=JSON.stringify({...plan,expiresAt:p.expiresAt,stepCredits:p.stepCredits,scope:['analysis','private_drafts','connected_reads'],externalWrites:'approval_required'});
 const existing=await q('SELECT * FROM durable_missions WHERE id=? AND workspace_id=?',id,who.tenant).first<DurableMission>();
 if(existing){if(existing.approved_version===p.version&&existing.actor_id===who.user.userId&&existing.mandate===mandate)return missionState(who,id);throw new AppError('Un autre mandat est déjà enregistré.',409);}
 if(resource.kind!=='mission'||resource.status!=='draft'||resource.version!==p.version)throw new AppError('Ce mandat ne correspond pas au brouillon actuel.',409,'stale_mandate');
 await db().batch([
 q("INSERT OR IGNORE INTO durable_missions(id,workspace_id,organization_id,actor_id,approved_version,mandate,status,budget_units,expires_at,next_at,created_at,updated_at) SELECT ?,?,?,?,?,?,'queued',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM resources WHERE id=? AND workspace_id=? AND version=? AND kind='mission' AND status='draft')",id,who.tenant,who.organization,who.user.userId,p.version,mandate,p.maxCredits*100,p.expiresAt,now,now,now,id,who.tenant,p.version),
 q("UPDATE resources SET status='queued',updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='draft' AND EXISTS(SELECT 1 FROM durable_missions d WHERE d.id=resources.id)",now,id,who.tenant,p.version)
 ]);
 const saved=await q('SELECT mandate FROM durable_missions WHERE id=? AND workspace_id=?',id,who.tenant).first<{mandate:string}>();if(saved?.mandate!==mandate)throw new AppError('Le mandat a changé.',409);
 await audit(who,'mission.activated',id);return missionState(who,id);
}
export async function controlMission(who:BillingIdentity,id:string,action:'suspend'|'cancel'|'resume'){
 await rejectBrowserMission(who,id);
 await authorize(who.tenant,who.user.userId,action==='resume'?'approve':'write');const mission=await q('SELECT * FROM durable_missions WHERE id=? AND workspace_id=?',id,who.tenant).first<DurableMission>();if(!mission)throw new AppError('Mission introuvable.',404);
 if(['completed','cancelled'].includes(mission.status))throw new AppError('Cette mission est terminée.',409);
 if(action==='resume'){
  await requireMissionPlan(who.organization);
  if(!durableReadiness().enabled||mission.expires_at<=Date.now())throw new AppError('Le mandat est expiré ou le planificateur indisponible.',409);
  const uncertain=await q("SELECT id FROM durable_steps WHERE mission_id=? AND status IN ('running','uncertain')",id).first();if(uncertain)throw new AppError('Une étape doit être rapprochée avant reprise. Aucun appel ne sera répété.',409,'mission_needs_reconciliation');
   if(await unvalidatedStep(id))throw new AppError('Vérifiez et validez le résultat de chaque étape avant de reprendre.',409,'mission_validation_required');
  const steps=await q("SELECT result FROM durable_steps WHERE mission_id=? AND status='completed'",id).all<{result:string}>();
  for(const step of steps.results){const result=JSON.parse(step.result||'{}');for(const proposalId of result.approvalIds||[]){const proposal=await getResource(who.tenant,proposalId);if(['awaiting_approval','pending','executing','needs_input','uncertain'].includes(proposal.status))throw new AppError('Une proposition attend encore votre décision ou son rapprochement.',409,'mission_approval_pending');}}
 }
 const status=action==='resume'?'queued':action==='cancel'?'cancelled':'suspended',now=Date.now();
  await db().batch([q('UPDATE durable_missions SET status=?,next_at=?,updated_at=? WHERE id=?',status,now,now,id),q('UPDATE resources SET status=?,updated_at=? WHERE id=? AND workspace_id=?',status,now,id,who.tenant),q("UPDATE runs SET status='cancelled',updated_at=? WHERE id IN (SELECT run_id FROM durable_steps WHERE mission_id=?) AND status='streaming'",now,id)]);
  if(action==='cancel')await q("UPDATE durable_steps SET status='failed',error='abandoned_by_user',result=json_set(COALESCE(result,'{}'),'$.abandonedBy',?,'$.abandonedAt',?) WHERE mission_id=? AND status='uncertain'",who.user.userId,now,id).run();
  // Cancellation does not make an unresolved provider charge disappear.
  await refreshMissionCost(id);
 await audit(who,'mission.'+action,id);return missionState(who,id);
}
async function missionNotice(m:DurableMission,kind:string){await q('INSERT OR IGNORE INTO billing_notifications(id,organization_id,kind,message,created_at) VALUES (?,?,?,?,?)','mission:'+m.id+':'+m.cursor+':'+kind,m.organization_id,'mission.'+kind,kind==='completed'?'Votre mission est terminée.':kind==='uncertain'?'Une étape de mission doit être rapprochée avant de continuer.':'Votre mission attend votre intervention.',Date.now()).run();}
async function stopMission(m:DurableMission,status:string,error:string){const current=await q('SELECT status FROM durable_missions WHERE id=?',m.id).first<{status:string}>();if(current&&['cancelled','suspended'].includes(current.status))return;const now=Date.now();await db().batch([q('UPDATE durable_missions SET status=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?',status,now,m.id),q('UPDATE resources SET status=?,updated_at=? WHERE id=?',status,now,m.id)]);await missionNotice(m,error);}
export async function runDurableTick(runner?:MissionRunner){
 if(!durableReadiness().enabled)throw new AppError('L’autonomie durable est désactivée.',503,'autonomy_not_ready');
 const now=Date.now();let completed=0,waiting=0;
 // An expired lease after an external call is NOT proof of failure. Never replay that step blindly.
 const stale=await q("SELECT * FROM durable_missions WHERE status='running' AND lease_until<=?",now).all<DurableMission>();
 for(const m of stale.results){await q("UPDATE durable_steps SET status='uncertain',error='worker_interrupted' WHERE mission_id=? AND status='running'",m.id).run();await q("UPDATE runs SET status='failed',error='worker_interrupted',updated_at=? WHERE id IN (SELECT run_id FROM durable_steps WHERE mission_id=? AND status='uncertain') AND status='streaming'",now,m.id).run();await stopMission(m,'waiting_user','uncertain');waiting++;}
 const rows=await q("SELECT * FROM durable_missions WHERE id NOT IN (SELECT id FROM browser_sessions) AND status='queued' AND next_at<=? AND lease_until<=? ORDER BY next_at,id LIMIT 3",now,now).all<DurableMission>();
 for(const m of rows.results){
  const token=uid(),lock=await q("UPDATE durable_missions SET status='running',lease_token=?,lease_until=?,updated_at=? WHERE id=? AND status='queued' AND lease_until<=?",token,now+240000,now,m.id,now).run();if(!lock.meta.changes)continue;
  try{
   await authorize(m.workspace_id,m.actor_id,'write');await requireMissionPlan(m.organization_id);const resource=await getResource(m.workspace_id,m.id),mandate=planSchema.extend({expiresAt:z.number(),stepCredits:z.number().int().positive()}).parse(JSON.parse(m.mandate));
   if(['suspended','cancelled'].includes(resource.status)){await stopMission(m,resource.status,'intervention');continue;}
   if(resource.version!==m.approved_version||m.expires_at<=Date.now()){await stopMission(m,'waiting_user','mandate_expired');waiting++;continue;}
    if(await unvalidatedStep(m.id)){await stopMission(m,'waiting_user','validation');waiting++;continue;}
    if(m.cursor>=mandate.steps.length){const accepted=await q("SELECT COUNT(*) count FROM durable_steps WHERE mission_id=? AND status='completed' AND json_extract(result,'$.validation.status')='accepted'",m.id).first<{count:number}>();if(accepted?.count!==mandate.steps.length){await stopMission(m,'waiting_user','validation');waiting++;continue;}await stopMission(m,'completed','completed');completed++;continue;}
   const units=mandate.stepCredits*100;if(m.spent_units+m.reserved_units+units>m.budget_units){await stopMission(m,'waiting_user','budget_exhausted');waiting++;continue;}
   const prior=await q('SELECT * FROM durable_steps WHERE mission_id=? AND ordinal=?',m.id,m.cursor).first<DurableStep>();if(prior){await stopMission(m,'waiting_user','uncertain');waiting++;continue;}
   const stepId=m.id+':'+m.cursor,runId='durable:'+stepId;const conversation=m.cursor===0?await createResource(m.workspace_id,'conversation','Mission : '+resource.title,{},'saved'):await getResource(m.workspace_id,(await q('SELECT conversation_id FROM durable_steps WHERE mission_id=? ORDER BY ordinal LIMIT 1',m.id).first<{conversation_id:string}>())!.conversation_id);
   const who:BillingIdentity={tenant:m.workspace_id,organization:m.organization_id,role:(await authorize(m.workspace_id,m.actor_id,'write')).role,user:{userId:m.actor_id,email:'',displayName:''}};
   let budget:RunBudget|undefined;const abort=new AbortController();let needsApproval=false,lastHeartbeat=0,delivered=false;const approvalIds:string[]=[];
   const mandateTimer=setTimeout(()=>abort.abort(),Math.max(0,m.expires_at-Date.now()));
   try{
    const existingHold=await q('SELECT status FROM credit_holds WHERE reference=?','chat:'+runId).first<{status:string}>();if(existingHold?.status==='settled')throw new AppError('La réservation de cette étape doit être rapprochée.',409,'mission_needs_reconciliation');
    budget=await startRunBudget(who,runId,mandate.stepCredits);
    await db().batch([q("INSERT INTO durable_steps(id,mission_id,ordinal,status,run_id,conversation_id,reserved_units,started_at) VALUES (?,?,?,'running',?,?,?,?)",stepId,m.id,m.cursor,runId,conversation.id,units,Date.now()),q('UPDATE durable_missions SET reserved_units=? WHERE id=? AND lease_token=?',units,m.id,token),q("INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,'streaming',?,?)",runId,m.workspace_id,conversation.id,Date.now(),Date.now()),q("UPDATE resources SET status='running',updated_at=? WHERE id=?",Date.now(),m.id),q("INSERT INTO messages(id,workspace_id,conversation_id,role,content,created_at) VALUES (?,?,?,'user',?,?)",uid(),m.workspace_id,conversation.id,JSON.stringify([{type:'text',text:'Mandat autonome approuvé : '+JSON.stringify(mandate)+'\nÉtape '+(m.cursor+1)+' : '+mandate.steps[m.cursor]+'\nExécute seulement cette étape. Les publications, modifications externes et dépenses publicitaires exigent toujours une approbation distincte. Arrête et explique si une condition d’arrêt s’applique.'}]),Date.now())]);
    const assertMandate=async()=>{
     if(abort.signal.aborted)throw new AppError('Le mandat de la mission est expiré ou interrompu.',409,'mandate_expired');
     const current=await q('SELECT status,expires_at FROM durable_missions WHERE id=? AND lease_token=?',m.id,token).first<{status:string;expires_at:number}>(),latest=await getResource(m.workspace_id,m.id);
     if(current?.status!=='running'||['cancelled','suspended'].includes(latest.status)){abort.abort();throw new AppError('Mission suspendue.',499,'cancelled');}
     if(!current||current.expires_at<=Date.now()||latest.version!==m.approved_version){abort.abort();throw new AppError('Le mandat a expiré ou le plan a changé. Aucune nouvelle étape ne sera exécutée.',409,'mandate_expired');}
     await authorize(m.workspace_id,m.actor_id,'write');await requireMissionPlan(m.organization_id);
    };
    budget.beforeTool=assertMandate;budget.beforeModel=assertMandate;
    const emit=async(type:string,data:unknown)=>{
     if(Date.now()-lastHeartbeat>1000||type==='tool_start'){
      await assertMandate();lastHeartbeat=Date.now();await db().batch([q('UPDATE durable_missions SET lease_until=? WHERE id=? AND lease_token=?',Date.now()+240000,m.id,token),q('UPDATE runs SET updated_at=? WHERE id=?',Date.now(),runId)]);
     }
     const result=typeof data==='object'&&data!==null&&'result' in data?(data as {result:Record<string,unknown>}).result:null;if(result&&(result.status==='awaiting_approval'||result.kind==='connector_action'&&result.status==='pending')){needsApproval=true;if(typeof result.id==='string')approvalIds.push(result.id);}
     if(type==='text_delta'&&data&&typeof data==='object'&&'text' in data&&typeof data.text==='string'&&data.text.trim()||result&&typeof result.id==='string'&&typeof result.kind==='string')delivered=true;
     await q('INSERT INTO events(run_id,type,data,created_at) VALUES (?,?,?,?)',runId,type,JSON.stringify(data),Date.now()).run();
    };
    const execute=runner||(await import('./agent')).runAgent;await execute(m.workspace_id,conversation.id,runId,emit,AbortSignal.any([abort.signal,AbortSignal.timeout(180000)]),budget,'approved_mission');await assertMandate();
    if(!delivered)throw new AppError('Aucun résultat vérifiable n’a été enregistré pour cette étape.',502,'mission_result_missing');
    await q("UPDATE runs SET status='completed',updated_at=? WHERE id=? AND status='streaming'",Date.now(),runId).run();await finishRunBudget(budget);
    const hold=await q('SELECT status,actual FROM credit_holds WHERE id=?',budget.holdId).first<{status:string;actual:number}>();
    if(hold?.status!=='settled'){await q("UPDATE durable_steps SET status='uncertain',error='usage_pending' WHERE id=?",stepId).run();await stopMission(m,'waiting_user','uncertain');waiting++;continue;}
    const finalState=await q('SELECT status FROM durable_missions WHERE id=?',m.id).first<{status:string}>();
    const status=finalState&&['suspended','cancelled'].includes(finalState.status)?finalState.status:'waiting_user',at=Date.now();
    await db().batch([q("UPDATE durable_steps SET status='completed',result=?,finished_at=? WHERE id=?",JSON.stringify({runId,awaitingApproval:needsApproval,approvalIds,validation:{status:'pending'}}),at,stepId),q('UPDATE durable_missions SET cursor=cursor+1,spent_units=spent_units+?,reserved_units=0,status=?,next_at=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?',hold.actual,status,at,at,m.id,token),q('UPDATE resources SET status=?,updated_at=? WHERE id=?',status,at,m.id)]);
    if(status==='waiting_user'){waiting++;await missionNotice(m,needsApproval?'approval':'validation');}
   }catch(error){
    abort.abort();await q("UPDATE runs SET status='failed',error=?,updated_at=? WHERE id=? AND status='streaming'",error instanceof AppError?error.code:'step_failed',Date.now(),runId).run();
    if(budget)await finishRunBudget(budget).catch(()=>undefined);
    await q("UPDATE durable_steps SET status='uncertain',error=?,finished_at=? WHERE id=?",error instanceof AppError?error.code:'step_failed',Date.now(),stepId).run();
    await stopMission(m,'waiting_user','uncertain');waiting++;
   }finally{clearTimeout(mandateTimer);}
   }catch(error){await stopMission(m,'waiting_user',error instanceof AppError?error.code:'intervention');waiting++;}
 }
 return {checked:rows.results.length,interrupted:stale.results.length,completed,waiting};
}
