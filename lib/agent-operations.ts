import {operationSnapshot,operationHiddenFrom} from './agent-operation-visibility';
import {z} from 'zod';
import {AppError} from './core.mjs';
import {db,authorize,getResource,createResource,updateResource,auditLog} from './server';
import {conversationProject,assertProjectResource} from './project-context';
import {containsCredential} from './agent-profile';
import {skillHiddenFrom} from './skill-visibility.mjs';
import {workflowDefinition,workflowRows,evaluateWorkflow,canonical,fingerprint} from './workflow-contract';
import type {AgentScope} from './agent-state';
import type {BillingIdentity} from './billing';
import type {Resource} from './contracts';

const ref=z.string().min(1).max(160),version=z.number().int().positive();
export const agentProfileInput=z.object({id:ref.optional(),version:version.optional(),name:z.string().trim().min(1).max(60),role:z.enum(['coding','creative','campaigns','analysis','extraction','review']),objective:z.string().trim().min(4).max(1600),rules:z.array(z.string().max(400)).max(10),exclusions:z.array(z.string().max(400)).max(10),references:z.array(ref).max(8)}).strict();
async function actor(scope:AgentScope,action='read'){
 if(!scope.userId)throw new AppError('Utilisateur requis.',401);
 await authorize(scope.tenant,scope.userId,action);
 if(await db().prepare('SELECT 1 x FROM account_blocks WHERE user_id=?').bind(scope.userId).first().catch(error=>{if(error instanceof Error&&/no such table.*account_blocks/i.test(error.message))return null;throw error;}))throw new AppError('Compte suspendu.',403,'account_blocked');
 if(scope.projectId!==undefined&&scope.projectId!==await conversationProject(scope.tenant,scope.conversationId))throw new AppError('Le projet de la discussion a changé.',409,'project_scope_mismatch');
 return scope.userId;
}
export async function operationResource(scope:AgentScope,id:string,kind:string){
 const userId=await actor(scope),r=await assertProjectResource(scope.tenant,id,scope.projectId??null);
 if(r.kind!==kind||r.data.ownerId!==userId)throw new AppError('Élément inaccessible.',404);
 return r;
}
export async function operationReference(scope:AgentScope,id:string){
 const userId=await actor(scope),r=await assertProjectResource(scope.tenant,id,scope.projectId??null);
 if(operationHiddenFrom(r,userId)||(r.kind==='knowledge'&&typeof r.data.userId==='string'&&r.data.userId!==userId)||(r.kind==='skill'&&skillHiddenFrom(r.data,userId)))throw new AppError('Référence inaccessible.',404);
 return r;
}
export async function saveAgentProfile(scope:AgentScope,raw:unknown){
 const userId=await actor(scope,'write'),p=agentProfileInput.parse(raw);
 if(containsCredential(JSON.stringify(p)))throw new AppError('Un profil ne peut pas contenir de secret.',400,'profile_secret_rejected');
 if(Boolean(p.id)!==Boolean(p.version))throw new AppError('Identifiant et version requis ensemble.');
 for(const id of p.references)await operationReference(scope,id);
 const {id,version:expected,...fields}=p,data={...fields,projectId:scope.projectId??null,ownerId:userId,permissions:'runtime_only'};
 if(id){const current=await operationResource(scope,id,'agent_profile');return updateResource(scope.tenant,id,expected!,{title:p.name,data,status:current.status});}
 const count=await db().prepare("SELECT COUNT(*) n FROM resources WHERE workspace_id=? AND kind='agent_profile' AND status!='deleted' AND json_extract(data,'$.ownerId')=? AND json_extract(data,'$.projectId') IS ?").bind(scope.tenant,userId,scope.projectId??null).first<{n:number}>();
 if((count?.n||0)>=8)throw new AppError('Huit profils suffisent pour ce projet. Modifiez un profil existant.',409,'profile_limit');
 return createResource(scope.tenant,'agent_profile',p.name,data,'ready');
}
async function sourceCurrent(scope:AgentScope,data:z.infer<typeof workflowDefinition>){
 if(!data.sourceSkillId)return;
 const skill=await getResource(scope.tenant,data.sourceSkillId);
 if(skill.kind!=='skill'||!['ready','saved'].includes(skill.status)||skill.version!==data.sourceSkillVersion||skillHiddenFrom(skill.data,scope.userId||''))throw new AppError('La méthode source a changé ou n’est plus accessible. Relisez-la et testez une nouvelle version du workflow.',409,'workflow_source_changed');
 if(typeof skill.data.projectId==='string'&&skill.data.projectId!==(scope.projectId??null))throw new AppError('Méthode d’un autre projet.',403,'project_scope_mismatch');
}
export async function proposeWorkflow(scope:AgentScope,raw:unknown){
 const userId=await actor(scope,'write'),{id,version:expected,...rest}=z.object({id:ref.optional(),version:version.optional()}).passthrough().parse(raw),p=workflowDefinition.parse(rest);
 if(Boolean(id)!==Boolean(expected))throw new AppError('Identifiant et version requis ensemble.');
 if(containsCredential(JSON.stringify(p)))throw new AppError('Retirez les secrets du cas de test.',400,'workflow_secret_rejected');
 await sourceCurrent(scope,p);
 const data={...p,ownerId:userId,projectId:scope.projectId??null,digest:await fingerprint(p),execution:'deterministic_private_tables',conversationId:scope.conversationId};
 if(id){await operationResource(scope,id,'workflow');return updateResource(scope.tenant,id,expected!,{title:p.title,data,status:'draft'});}
 return createResource(scope.tenant,'workflow',p.title,data,'draft');
}
export async function testWorkflow(scope:AgentScope,raw:unknown){
 await actor(scope,'write');const p=z.object({id:ref,version}).strict().parse(raw),r=await operationResource(scope,p.id,'workflow');
 if(r.version!==p.version)throw new AppError('Version périmée.',409,'stale_version');
 const data=workflowDefinition.parse(Object.fromEntries(Object.entries(r.data).filter(([key])=>['title','steps','fixture','sourceSkillId','sourceSkillVersion'].includes(key))));
 await sourceCurrent(scope,data);
 const actual=evaluateWorkflow(data.steps,data.fixture.input),passed=canonical(actual)===canonical(data.fixture.expected);
 const result=await updateResource(scope.tenant,r.id,r.version,{status:passed?'tested':'draft',data:{...r.data,test:{passed,digest:r.data.digest,at:Date.now(),rows:actual.length,criteria:'exact_fixture_output',limits:'Le cas de test ne prouve pas la qualité de toutes les données réelles.'}}});
 return {...result,testOutput:actual};
}
export async function commandOperation(scope:AgentScope,raw:unknown){
 const p=z.object({id:ref,version,action:z.enum(['activate','disable']),digest:z.string().length(64),confirmed:z.boolean()}).strict().parse(raw);
 const userId=await actor(scope,p.action==='activate'?'approve':'write'),r=await operationResource(scope,p.id,'workflow');
 if(r.version!==p.version||r.data.digest!==p.digest)throw new AppError('Le workflow a changé. Relisez-le.',409,'stale_version');
 if(p.action==='activate'&&(!p.confirmed||r.status!=='tested'||!r.data.test||typeof r.data.test!=='object'||(r.data.test as Record<string,unknown>).digest!==p.digest||(r.data.test as Record<string,unknown>).passed!==true))throw new AppError('Test réussi et confirmation exacte requis.',409,'workflow_test_required');
 await sourceCurrent(scope,r.data as z.infer<typeof workflowDefinition>);
 const result=await updateResource(scope.tenant,r.id,r.version,{status:p.action==='activate'?'active':'disabled'});
 await auditLog(scope.tenant,userId,'workflow.'+p.action,result.id,{version:result.version,digest:p.digest});return result;
}
export async function executeWorkflow(scope:AgentScope,raw:unknown){
 const userId=await actor(scope,'write'),p=z.object({id:ref,version,requestId:z.string().min(8).max(100),rows:workflowRows}).strict().parse(raw),r=await operationResource(scope,p.id,'workflow');
 if(containsCredential(JSON.stringify(p.rows)))throw new AppError('Retirez les identifiants et secrets du tableau avant son traitement.',400,'workflow_secret_rejected');
 if(r.version!==p.version||r.status!=='active')throw new AppError('Workflow inactif ou modifié.',409,'workflow_inactive');
 await sourceCurrent(scope,r.data as z.infer<typeof workflowDefinition>);
 const digest=await fingerprint({workflowId:r.id,version:r.version,rows:p.rows}),id='workflow-run-'+await fingerprint([scope.tenant,userId,scope.projectId??null,p.requestId]);
 const claim={ownerId:userId,projectId:scope.projectId??null,workflowId:r.id,workflowVersion:r.version,digest,conversationId:scope.conversationId},now=Date.now();
 const inserted=await db().prepare("INSERT OR IGNORE INTO resources(id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,'workflow_run',?,?,'running',?,?)").bind(id,scope.tenant,r.title,JSON.stringify(claim),now,now).run();
 if(!inserted.meta.changes){const previous=await operationResource(scope,id,'workflow_run');if(previous.data.digest!==digest)throw new AppError('Cet identifiant a déjà été utilisé avec des données différentes.',409,'idempotency_conflict');if(previous.status!=='completed')throw new AppError('L’exécution précédente exige une vérification. Aucun rejeu automatique.',409,'execution_uncertain');return {...previous,reused:true};}
 try{const rows=evaluateWorkflow(r.data.steps,p.rows);return await updateResource(scope.tenant,id,1,{status:'completed',data:{...claim,rows,completedAt:Date.now(),providerCalls:0,costKind:'no_provider_generation'}});}
 catch(error){await updateResource(scope.tenant,id,1,{status:'failed',data:{...claim,error:'workflow_input_invalid'}});throw new AppError(error instanceof Error?error.message:'Traitement impossible.',400,'workflow_input_invalid');}
}
export async function actionInbox(scope:AgentScope,raw:unknown={}){
 const userId=await actor(scope),p=z.object({before:z.number().int().positive().optional(),beforeId:ref.optional()}).strict().parse(raw);
 const json="CASE WHEN json_valid(r.data) THEN r.data ELSE '{}' END";
 const rows=await db().prepare("SELECT r.id,r.kind,r.title,r.status,r.version,r.updated_at FROM resources r LEFT JOIN resources c ON c.id=json_extract("+json+",'$.conversationId') AND c.workspace_id=r.workspace_id AND c.kind='conversation' WHERE r.workspace_id=? AND r.status IN ('awaiting_approval','waiting_user','blocked','tested','draft') AND r.kind IN ('proposal','connector_action','workflow','work','mission','github_pr','social_batch') AND COALESCE(json_extract("+json+",'$.projectId'),json_extract(CASE WHEN json_valid(c.data) THEN c.data ELSE '{}' END,'$.projectId')) IS ? AND (json_extract("+json+",'$.ownerId') IS NULL OR json_extract("+json+",'$.ownerId')=?) AND (r.kind!='connector_action' OR json_extract("+json+",'$.requester')=?) AND (r.updated_at<? OR (r.updated_at=? AND r.id>?)) ORDER BY r.updated_at DESC,r.id LIMIT 30").bind(scope.tenant,scope.projectId??null,userId,userId,p.before??Number.MAX_SAFE_INTEGER,p.before??Number.MAX_SAFE_INTEGER,p.beforeId??'').all<{id:string;kind:string;title:string;status:string;version:number;updated_at:number}>();
 return {projectId:scope.projectId??null,retrievedAt:Date.now(),items:rows.results.map(row=>({id:row.id,kind:row.kind,title:row.title,status:row.status,version:row.version,updated_at:row.updated_at})),nextBefore:rows.results.length===30?rows.results.at(-1)!.updated_at:null,nextCursor:rows.results.length===30?{before:rows.results.at(-1)!.updated_at,beforeId:rows.results.at(-1)!.id}:null,note:'Les décisions et permissions sont revérifiées lors de chaque action.'};
}
export async function listAgentOperations(scope:AgentScope){
 const userId=await actor(scope);const rows=await db().prepare("SELECT * FROM resources WHERE workspace_id=? AND kind IN ('agent_profile','workflow','workflow_run','event_subscription') AND status!='deleted' AND json_extract(data,'$.ownerId')=? AND json_extract(data,'$.projectId') IS ? ORDER BY updated_at DESC LIMIT 40").bind(scope.tenant,userId,scope.projectId??null).all<Omit<Resource,'data'>&{data:string}>();
 return {items:rows.results.map(row=>operationSnapshot({...row,data:JSON.parse(row.data)})),projectId:scope.projectId??null,retrievedAt:Date.now()};
}
export async function operationScope(who:BillingIdentity,conversationId:string):Promise<AgentScope>{const c=await getResource(who.tenant,conversationId);if(c.kind!=='conversation'||c.status==='deleted')throw new AppError('Discussion introuvable.',404);return {tenant:who.tenant,userId:who.user.userId,conversationId,projectId:await conversationProject(who.tenant,conversationId),runId:'interactive',coveredRowid:0};}
