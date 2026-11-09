import type {Composio,ToolRouterCreateSessionConfig} from '@composio/core';
import type {AnthropicProvider} from '@composio/anthropic';
import {z} from 'zod';
import {config, db, uid, authorize, createResource, getResource, updateResource} from './server';
import {AppError} from './core.mjs';
import {currentSubscription, reserve, settleHold, type BillingIdentity} from './billing';
import {modelRate} from './metering';
import {instantExplicitlyEnabled} from './execution-policy.mjs';
import {safeComposioUserId,isReadOnlyTool,parseInstantCatalog,instantPlanLimits,parseActualInstantCharge,canonicalJSON,isGenericBrowserTool} from './composio-policy.mjs';

const toolkitSchema=z.string().regex(/^[a-z][a-z0-9_]{0,99}$/);
const slugSchema=z.string().regex(/^[A-Z][A-Z0-9_]{0,199}$/).refine(s=>!s.startsWith('COMPOSIO_'));
const callSchema=z.object({toolkit:toolkitSchema,toolSlug:slugSchema,arguments:z.record(z.unknown()),mode:z.enum(['connected','instant']).default('connected'),description:z.string().trim().max(240).optional()}).strict();
type ConnectorCall=z.infer<typeof callSchema>;
type Client=Composio<AnthropicProvider>;
type Session=Awaited<ReturnType<Client['sessions']['use']>>;
type ActionRow={id:string;workspace_id:string;organization_id:string;user_id:string;session_id:string;payload:string;status:string;expires_at:number;max_micros:number;month:string;user_limit:number;org_limit:number;hold_id:string|null};
const query=(sql:string,...values:(string|number|null)[])=>db().prepare(sql).bind(...values);
const SAFE_META=new Set(['COMPOSIO_SEARCH_TOOLS','COMPOSIO_GET_TOOL_SCHEMAS']);
const noStore={'Cache-Control':'private, no-store'};
export {noStore as connectorHeaders};

export function connectorConfigured(){return !!config().COMPOSIO_API_KEY?.trim();}
async function client(){
 if(!connectorConfigured())throw new AppError('Ajoutez COMPOSIO_API_KEY dans la configuration serveur pour connecter vos outils.',503,'composio_not_configured');
 // No CLI credential fallback, telemetry, auto file transfer, or SDK retry of uncertain writes.
 const [{Composio},{AnthropicProvider}]=await Promise.all([import('@composio/core'),import('@composio/anthropic')]);
 return new Composio({apiKey:config().COMPOSIO_API_KEY,provider:new AnthropicProvider(),allowTracking:false,logLevel:'silent'});
}
function providerError(){return new AppError('Le service de connexion est indisponible ou la connexion doit être renouvelée. Aucun succès n’a été confirmé.',502,'composio_unavailable');}
async function log(who:BillingIdentity,tool:string,status:string,logId?:string){
 await query('INSERT INTO audit(id,workspace_id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?,?)',uid(),who.tenant,who.user.userId,'connector.'+status,tool,JSON.stringify({status,...(logId?{logId}:{})}),Date.now()).run();
}
function authConfigs(){
 try{return z.record(toolkitSchema,z.string().regex(/^ac_[a-zA-Z0-9_-]+$/)).parse(JSON.parse(config().COMPOSIO_AUTH_CONFIGS_JSON||'{}'));}
 catch{throw new AppError('La configuration OAuth des connecteurs est invalide.',503,'composio_config_invalid');}
}
function instantCatalog():{toolkit:string;toolSlug:string;maxCostMicros:number;verifiedAt:string;sourceUrl:string}[]{
 try{return parseInstantCatalog(config().COMPOSIO_INSTANT_CATALOG_JSON||'[]');}
 catch{throw new AppError('Le catalogue de tarifs Instant doit être vérifié.',503,'instant_price_unverified');}
}
async function instantPolicy(who:BillingIdentity){
 const sub=await currentSubscription(who.organization),limits=instantPlanLimits(sub?.plan||'free');
 return {...limits,enabled:instantExplicitlyEnabled(config().COMPOSIO_INSTANT_ENABLED)&&limits.monthlyMicros>0};
}
function checkSession(session:Session,scopeUser:string,mode:'connected'|'instant'){
 const c=session.config;
 if(c.user_id!==scopeUser||c.workbench?.enable!==false||c.proxy_execute?.enable!==false||(mode==='connected'&&c.instant!==false))throw new AppError('Les règles de cette connexion ont changé. L’exécution est bloquée.',409,'connector_policy_changed');
 return session;
}
export async function connectorStatus(who:BillingIdentity){
 const policy=await instantPolicy(who);
 return {enabled:policy.enabled,monthlyLimitUsd:policy.organizationMonthlyMicros/1e6,perCallLimitUsd:policy.perCallMicros/1e6,
 note:'Instant : confirmation par appel, crédits Braand et tarif vérifié requis. Le plafond Business est partagé par l’équipe.'};
}

export async function connectorSession(who:BillingIdentity,conversationId='catalog',mode:'connected'|'instant'='connected'){
 await authorize(who.tenant,who.user.userId,'read');
 const sdk=await client(),scopeUser=await safeComposioUserId(who.tenant,who.user.userId);
 const existing=await query('SELECT session_id FROM connector_sessions WHERE workspace_id=? AND user_id=? AND conversation_id=? AND mode=?',who.tenant,who.user.userId,conversationId,mode).first<{session_id:string}>();
 if(existing){const session=await sdk.sessions.use(existing.session_id);return {sdk,session:checkSession(session,scopeUser,mode),scopeUser};}
 let instant:ToolRouterCreateSessionConfig['instant']=false;
 if(mode==='instant'){
  const policy=await instantPolicy(who),entries=instantCatalog();
  if(!policy.enabled||!entries.length)throw new AppError('Instant attend un forfait actif et un catalogue de tarifs vérifiés. Aucun appel payant n’est autorisé.',409,'instant_unavailable');
  const tools:Record<string,{enable:string[]}>=Object.create(null);
  for(const e of entries){if(!tools[e.toolkit])tools[e.toolkit]={enable:[]};tools[e.toolkit].enable.push(e.toolSlug);}
  instant={toolkits:{enable:Object.keys(tools)},tools,returnInstantCharge:true,returnPricesInSearch:true};
 }
 const options:ToolRouterCreateSessionConfig={instant,sandbox:{enable:false},proxyExecute:false,authConfigs:authConfigs(),manageConnections:false};
 try{
  const created=await sdk.sessions.create(scopeUser,options);
  await query('INSERT OR IGNORE INTO connector_sessions(workspace_id,user_id,conversation_id,session_id,scope_user,mode,created_at) VALUES (?,?,?,?,?,?,?)',who.tenant,who.user.userId,conversationId,created.sessionId,scopeUser,mode,Date.now()).run();
  const winner=await query('SELECT session_id FROM connector_sessions WHERE workspace_id=? AND user_id=? AND conversation_id=? AND mode=?',who.tenant,who.user.userId,conversationId,mode).first<{session_id:string}>();
  return {sdk,session:checkSession(winner?.session_id===created.sessionId?created:await sdk.sessions.use(winner!.session_id),scopeUser,mode),scopeUser};
 }catch{throw providerError();}
}

export async function listConnectorToolkits(who:BillingIdentity,params:URLSearchParams){
 const search=z.string().max(200).parse(params.get('search')||''),cursor=z.string().max(2000).optional().parse(params.get('cursor')||undefined);
 // Only opt into the native connected filter; an omitted value preserves the full catalogue.
 const connected=z.array(z.literal('true')).max(1).parse(params.getAll('connected')).length>0;
 if(!connectorConfigured())return {configured:false,items:[],nextCursor:null,instant:await connectorStatus(who)};
 const {session}=await connectorSession(who);
 try{
  const result=await session.toolkits({search:search||undefined,cursor,limit:30,...(connected?{isConnected:true}:{})});
  return {configured:true,items:result.items.map(t=>({slug:t.slug,name:t.name,logo:t.logo,isNoAuth:t.isNoAuth,connected:!!t.connection?.isActive,status:t.connection?.connectedAccount?.status||(t.isNoAuth?'available':'not_connected'),accountId:t.connection?.connectedAccount?.id})),nextCursor:result.cursor||null,instant:await connectorStatus(who)};
 }catch{throw providerError();}
}
export async function authorizeConnector(who:BillingIdentity,toolkit:string){
 toolkit=toolkitSchema.parse(toolkit);await authorize(who.tenant,who.user.userId,'write');
 const {session}=await connectorSession(who);
 try{
  // Composio owns the authorization flow. Braand never supplies provider tokens or accepts consent.
  const result=await session.authorize(toolkit);
  const url=new URL(result.redirectUrl!);
  if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)composio\.(dev|ai)$/.test(url.hostname))throw providerError();
  await log(who,'authorize:'+toolkit,'authorization_requested');
  return {redirectUrl:url.href};
 }catch{throw new AppError('Connexion indisponible. Reconnectez l’application et vérifiez ses autorisations ; Meta Ads nécessite votre propre configuration.',409,'connector_auth_unavailable');}
}
async function listScopedAccounts(sdk:Client, filters:NonNullable<Parameters<Client['connectedAccounts']['list']>[0]>, targetId?:string){
 const items:Awaited<ReturnType<Client['connectedAccounts']['list']>>['items']=[];
 const cursors=new Set<string>();
 let cursor:string|undefined;
 do {
  const page=await sdk.connectedAccounts.list({...filters,...(cursor?{cursor}:{})});
  items.push(...page.items);
  if(targetId && page.items.some(account=>account.id===targetId))break;
  cursor=page.nextCursor||undefined;
  if(cursor){
   if(cursors.has(cursor)||cursors.size>=100)throw new AppError('Liste des connexions incomplète. Réessayez la vérification.',503,'connector_pagination_incomplete');
   cursors.add(cursor);
  }
 }while(cursor);
 return {items};
}

export async function revokeConnector(who:BillingIdentity,accountId:string){
 await authorize(who.tenant,who.user.userId,'write');
 const {sdk,scopeUser}=await connectorSession(who);
 const result=await listScopedAccounts(sdk,{userIds:[scopeUser],limit:100},accountId);
 if(!result.items.some(a=>a.id===accountId))throw new AppError('Connexion introuvable pour cet utilisateur.',404);
 try{await sdk.connectedAccounts.revoke(accountId);await log(who,'revoke','revoked');return {revoked:true};}catch{throw providerError();}
}

/** Inspect real, user-scoped connections without creating an authorization or executing a tool. */
export async function diagnoseConnectors(who:BillingIdentity,input:unknown){
 const {toolkits}=z.object({toolkits:z.array(toolkitSchema).min(1).max(8)}).strict().parse(input);
 if(!connectorConfigured())return {configured:false,items:[],reason:'configuration_pending'};
 const {sdk,session,scopeUser}=await connectorSession(who);
 try{
  const [catalogue,accounts]=await Promise.all([
   session.toolkits({toolkits:[...new Set(toolkits)],limit:8}),
   listScopedAccounts(sdk,{userIds:[scopeUser],toolkitSlugs:[...new Set(toolkits)],limit:100})
  ]);
  return {configured:true,permissionStatus:'not_checked',writesRequireExactApproval:true,items:catalogue.items.map(toolkit=>{
   const owned=accounts.items.filter(account=>account.toolkit.slug===toolkit.slug);
   const selected=toolkit.connection?.connectedAccount;
   const active=!!toolkit.connection?.isActive&&selected?.status==='ACTIVE'&&owned.some(account=>account.id===selected.id&&account.status==='ACTIVE');
   return {toolkit:toolkit.slug,name:toolkit.name,connected:active,isNoAuth:!!toolkit.isNoAuth,
    status:active?'ACTIVE':owned.some(account=>account.status==='EXPIRED')?'EXPIRED':owned.some(account=>account.status==='FAILED')?'FAILED':'NOT_CONNECTED',
    nextStep:active||toolkit.isNoAuth?'discover_tools':owned.length?'reconnect':'connect'};
  })};
 }catch{throw providerError();}
}

export const connectorActionTools=[
 {name:'braand_connector_status',description:'Inspect actual connection status for up to eight discovered toolkits in this user/workspace. Distinguishes active, expired and missing accounts without external tool execution. ACTIVE does not prove publish or ads permissions. Reconnect expired accounts with braand_connect_toolkit; discover read tools to verify actual Page/ad-account access.',input_schema:{type:'object',properties:{toolkits:{type:'array',items:{type:'string'},minItems:1,maxItems:8}},required:['toolkits'],additionalProperties:false}},
 {name:'braand_connector_receipt',description:'Read the authoritative status and actual result of this user’s previously proposed connector action after approval. A pending or uncertain receipt never proves success.',input_schema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
 {name:'braand_connect_toolkit',description:'Show the user an « Autoriser » card for a discovered toolkit they have not connected (or whose connection expired). reason: one plain-French sentence saying why Braand needs it for the current task. The user clicks, consents on the provider page, then « C’est fait, continuer » resumes the conversation. Never create auth configs or handle tokens.',input_schema:{type:'object',properties:{toolkit:{type:'string'},reason:{type:'string',maxLength:240}},required:['toolkit'],additionalProperties:false}},
 {name:'braand_connector_action',description:'Use a discovered app tool with this user’s connected account. Only verified read-only tools run immediately. Every write/unknown operation and every paid Instant call creates an exact-arguments approval card, and does NOT execute. Read its schema first. Instant is only available for administrator-verified priced tools. Never pass credentials or account overrides.',input_schema:{type:'object',properties:{toolkit:{type:'string'},toolSlug:{type:'string'},arguments:{type:'object'},mode:{type:'string',enum:['connected','instant']},description:{type:'string',maxLength:240,description:'One short sentence for the user, in their language, saying what this action does and why (shown on the approval card).'}},required:['toolkit','toolSlug','arguments'],additionalProperties:false}}
];
export async function connectorAgentTools(who:BillingIdentity,conversationId:string){
 if(!connectorConfigured())return [];
 const {session}=await connectorSession(who,conversationId);
 const tools=z.array(z.object({name:z.string(),description:z.string().optional(),input_schema:z.record(z.unknown())}).passthrough()).parse(await session.tools());
 // Execution and authentication helpers are intentionally replaced by guarded Braand adapters.
 return [...tools.filter(t=>SAFE_META.has(t.name)),...connectorActionTools];
}
async function metadata(sdk:Client,call:ConnectorCall){
 if(isGenericBrowserTool(call.toolkit,call.toolSlug))throw new AppError('Utilisez le navigateur privé Braand pour cette action.',403,'browser_adapter_required');
 const tools=await sdk.tools.getRawComposioTools({tools:[call.toolSlug]});
 const tool=tools.find(t=>t.slug===call.toolSlug&&t.toolkit?.slug===call.toolkit);
 if(!tool)throw new AppError('Outil introuvable. Recherchez son schéma avant de continuer.',404,'connector_tool_unknown');
 return tool;
}
async function ownedAccount(sdk:Client,session:Session,who:BillingIdentity,call:ConnectorCall){
 const result=await session.toolkits({toolkits:[call.toolkit],limit:1});
 const toolkit=result.items.find(t=>t.slug===call.toolkit);
 if(!toolkit)throw new AppError('Connecteur introuvable.',404);
 if(toolkit.connection?.isActive&&toolkit.connection.connectedAccount?.status==='ACTIVE'){
  const id=toolkit.connection.connectedAccount.id,scopeUser=await safeComposioUserId(who.tenant,who.user.userId);
  const accounts=await listScopedAccounts(sdk,{userIds:[scopeUser],statuses:['ACTIVE'],toolkitSlugs:[call.toolkit],limit:100},id);
  if(!accounts.items.some(a=>a.id===id&&a.status==='ACTIVE'&&a.toolkit.slug===call.toolkit))throw new AppError('Ce compte ne fait pas partie de vos connexions actives.',403,'connector_account_denied');
  return id;
 }
 if(toolkit.isNoAuth)return undefined;
 throw new AppError('Connectez ou reconnectez votre compte avant cette action.',409,'connector_not_connected');
}
function nativeApprovalResponses(error:{inputRequests:unknown;requestState?:unknown}){
 if(typeof error.requestState!=='string'||!error.requestState||error.requestState.length>50000)return null;
 const requests=error.inputRequests;
 if(!requests||typeof requests!=='object'||Array.isArray(requests))return null;
 const entries=Object.entries(requests);
 if(!entries.length||entries.length>20)return null;
 const responses:Record<string,{action:'accept';content:{decision:'approve'}}>=Object.create(null);
 for(const [id,value] of entries){
  if(!id||!value||typeof value!=='object'||Array.isArray(value))return null;
  const question=value as Record<string,unknown>,schema=question.requested_schema as Record<string,unknown>|undefined;
  if(question.type!=='elicitation'||question.mode!=='form'||!schema||schema.type!=='object')return null;
  const properties=schema.properties;
  if(!properties||typeof properties!=='object'||Array.isArray(properties)||Object.keys(properties).length!==1||!Object.hasOwn(properties,'decision'))return null;
  if(schema.required!==undefined&&(!Array.isArray(schema.required)||schema.required.some(key=>key!=='decision')))return null;
  const decision=(properties as Record<string,unknown>).decision as Record<string,unknown>|undefined;
  if(!decision||decision.type!=='string')return null;
  const choices=Array.isArray(decision.enum)&&decision.oneOf===undefined?decision.enum:Array.isArray(decision.oneOf)&&decision.enum===undefined?decision.oneOf.map(choice=>choice&&typeof choice==='object'?(choice as Record<string,unknown>).const:undefined):null;
  if(!choices||!choices.includes('approve')||!choices.includes('deny')||choices.some(choice=>typeof choice!=='string'||!['approve','deny','always_approve'].includes(choice)))return null;
  // A local click covers this exact call only; never grant Composio a lasting session approval.
  responses[id]={action:'accept',content:{decision:'approve'}};
 }
 return responses;
}
async function executeConnected(who:BillingIdentity,session:Session,call:ConnectorCall,account?:string,approvalGranted=false,beforeExecute?:()=>Promise<void>){
 try{
  let result;
  try{await beforeExecute?.();result=await session.execute(call.toolSlug,call.arguments,account?{account}:undefined);}
  catch(error){
   const {ComposioToolInputRequiredError}=await import('@composio/core');
   if(!(error instanceof ComposioToolInputRequiredError))throw error;
   if(!approvalGranted)throw new AppError('Cette action demande une confirmation pour cet appel exact.',409,'connector_approval_required');
   const inputResponses=nativeApprovalResponses(error);
   if(!inputResponses)throw new AppError('Le fournisseur demande une intervention supplémentaire. Aucun appel n’a été exécuté.',409,'connector_input_required');
   await authorize(who.tenant,who.user.userId,'write');
   await beforeExecute?.();
   try{result=await session.execute(call.toolSlug,call.arguments,{...(account?{account}:{}),inputResponses,requestState:error.requestState});}
   catch(resumeError){
    if(resumeError instanceof ComposioToolInputRequiredError)throw new AppError('Le fournisseur demande une intervention supplémentaire. Aucun appel n’a été exécuté.',409,'connector_input_required');
    throw resumeError;
   }
  }
  await log(who,call.toolSlug,result.resultType,result.logId);
  return result;
 }catch(error){
  if(error instanceof AppError&&['connector_approval_required','connector_input_required','work_inactive'].includes(error.code)){await log(who,call.toolSlug,error.code);throw error;}
  await log(who,call.toolSlug,'uncertain');throw providerError();
 }
}
export async function executeConnectorAgentTool(who:BillingIdentity,conversationId:string,name:string,input:unknown,work?:{id:string;stepId:string}){
 await authorize(who.tenant,who.user.userId,'write');
 if(name==='braand_connector_status')return diagnoseConnectors(who,input);
 if(name==='braand_connector_receipt'){
  const {id}=z.object({id:z.string().uuid()}).strict().parse(input);
  const row=await query('SELECT status,result,log_id FROM connector_actions WHERE id=? AND workspace_id=? AND user_id=?',id,who.tenant,who.user.userId).first<{status:string;result:string|null;log_id:string|null}>();
  if(!row||await (await import('./decisions')).decisionOrigin(who.tenant,id)!==conversationId)throw new AppError('Action introuvable dans cette discussion.',404);
  return {id,status:row.status,result:row.result?JSON.parse(row.result):null,logId:row.log_id};
 }
 if(name==='braand_connect_toolkit'){const p=z.object({toolkit:toolkitSchema,reason:z.string().trim().max(240).optional()}).strict().parse(input);const {redirectUrl}=await authorizeConnector(who,p.toolkit);return {kind:'connect_request',toolkit:p.toolkit,reason:p.reason||'',redirectUrl,notice:'Une carte « Autoriser » est affichée à l’utilisateur. Attends qu’il revienne ; ne prétends pas que le service est connecté.'};}
 const {sdk,session}=await connectorSession(who,conversationId);
 if(SAFE_META.has(name)){
  try{
   // Do not slice, summarize, filter or reconstruct SEARCH: skills must reach the native tool_result intact.
   const result=await session.executeMeta(name as 'COMPOSIO_SEARCH_TOOLS'|'COMPOSIO_GET_TOOL_SCHEMAS',z.record(z.unknown()).parse(input));
   await log(who,name,result.resultType,result.logId);return result;
  }catch{await log(who,name,'failed');throw providerError();}
 }
 if(name!=='braand_connector_action')throw new AppError('Cet outil ne peut pas contourner les validations Braand.',403,'connector_tool_denied');
 const call=callSchema.parse(input);
 if(canonicalJSON(call.arguments).length>50000)throw new AppError('Les paramètres sont trop volumineux.',400);
 const tool=await metadata(sdk,call);
 if(call.mode==='connected'){
  const account=await ownedAccount(sdk,session,who,call);
  if(isReadOnlyTool(tool)){
   try{return await executeConnected(who,session,call,account);}
   catch(error){if(!(error instanceof AppError)||error.code!=='connector_approval_required')throw error;}
  }
  return proposeAction(who,conversationId,session,call,account,work);
 }
 return proposeAction(who,conversationId,session,call,undefined,work);
}

/** An approved work can read connected tools and propose exact writes, never approve them. */
export async function executeMissionConnectorTool(who:BillingIdentity,conversationId:string,name:string,input:unknown,workId:string,stepId:string){
 const work=await query("SELECT w.id FROM agent_work w JOIN agent_work_steps s ON s.work_id=w.id WHERE w.id=? AND s.id=? AND w.workspace_id=? AND w.actor_id=? AND w.conversation_id=? AND w.status='running' AND s.status='running' AND w.approved_version IS NOT NULL AND w.expires_at>?",workId,stepId,who.tenant,who.user.userId,conversationId,Date.now()).first();
 if(!work)throw new AppError('Ce mandat ne permet pas cet appel connecté.',403,'work_connector_denied');
 if(!['COMPOSIO_SEARCH_TOOLS','COMPOSIO_GET_TOOL_SCHEMAS','braand_connector_status','braand_connector_receipt','braand_connector_action'].includes(name))throw new AppError('Cet outil exige une intervention dans le chat.',403,'work_connector_denied');
 if(name==='braand_connector_action'){
  const call=callSchema.parse(input);
  if(call.mode!=='connected')throw new AppError('Les appels Instant ne sont pas autorisés par ce mandat.',403,'work_connector_denied');
  const prior=await query('SELECT a.id,a.payload FROM connector_actions a JOIN agent_work_artifacts r ON r.resource_id=a.id WHERE r.work_id=? AND r.step_id=? AND a.workspace_id=? AND a.user_id=? ORDER BY a.created_at DESC LIMIT 100',workId,stepId,who.tenant,who.user.userId).all<{id:string;payload:string}>();
  const matching=prior.results.find(row=>{const p=JSON.parse(row.payload);return p.toolkit===call.toolkit&&p.toolSlug===call.toolSlug&&p.mode===call.mode&&canonicalJSON(p.arguments)===canonicalJSON(call.arguments);});
  // A receipt is authoritative even if rejected, failed or uncertain. Never recreate it on resume.
  if(matching)return getResource(who.tenant,matching.id);
 }
 const result=await executeConnectorAgentTool(who,conversationId,name,input,{id:workId,stepId});
 if(result&&typeof result==='object'&&'kind' in result&&result.kind==='connector_action')await (await import('./work')).trackWorkArtifact(workId,stepId,result as {id:string;kind:string});
 return result;
}

async function proposeAction(who:BillingIdentity,conversationId:string,session:Session,call:ConnectorCall,account?:string,work?:{id:string;stepId:string}){
 let maxMicros=0,maxCredits=0,sessionId=session.sessionId;
 const policy=await instantPolicy(who);
 if(call.mode==='instant'){
  const entry=instantCatalog().find(e=>e.toolkit===call.toolkit&&e.toolSlug===call.toolSlug);
  if(!policy.enabled||!entry||entry.maxCostMicros>policy.perCallMicros)throw new AppError('Cet appel Instant ne dispose pas d’un tarif vérifié compatible avec votre plafond.',409,'instant_price_unverified');
  const paid=await connectorSession(who,'instant','instant');sessionId=paid.session.sessionId;
  // Eligibility comes from the provider, independently of the application price registry.
  const search=await paid.session.search({query:call.toolSlug,toolkits:[call.toolkit]});
  if(!search.toolkitConnectionStatuses.some(t=>t.toolkit===call.toolkit&&t.instantAccount?.allowedToolSlugs.includes(call.toolSlug)))throw new AppError('Cet outil ne prend pas en charge Instant.',409,'instant_unsupported');
  maxMicros=entry.maxCostMicros;
  await (await import('./model-pricing')).ensureModelPricing();
  const rate=modelRate();maxCredits=Math.ceil(((maxMicros/1e6)*rate.usdXaf*1.2+rate.overheadXaf)/4*100);
 }
 const data={...call,conversationId,accountId:account||null,requester:who.user.userId,sessionId,priceUsd:maxMicros?maxMicros/1e6:null,maxCredits:maxCredits/100,expiresAt:Date.now()+15*60000,status:'pending'};
 const resource=await createResource(who.tenant,'connector_action',call.toolkit+' · '+call.toolSlug,data,'pending');
 const insertion=query('INSERT INTO connector_actions(id,workspace_id,organization_id,user_id,session_id,payload,expires_at,created_at,max_micros,month,user_limit,org_limit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',resource.id,who.tenant,who.organization,who.user.userId,sessionId,canonicalJSON(data),data.expiresAt,Date.now(),maxMicros,new Date().toISOString().slice(0,7),policy.monthlyMicros,policy.organizationMonthlyMicros);
 await db().batch([insertion,...(work?[query('INSERT INTO agent_work_artifacts(work_id,step_id,resource_id) VALUES (?,?,?)',work.id,work.stepId,resource.id)]:[])]);
 await log(who,call.toolSlug,'approval_required');return resource;
}
async function syncAction(who:BillingIdentity,id:string,status:string,result?:unknown){
 const resource=await getResource(who.tenant,id);
 const saved=await updateResource(who.tenant,id,resource.version,{status,data:{...resource.data,status,...(result!==undefined?{result}:{})}});
 await (await import('./work')).wakeWorkForResource(who.tenant,id);return saved;
}
export async function decideConnectorAction(who:BillingIdentity,id:string,decision:'approve'|'reject'){
 await authorize(who.tenant,who.user.userId,'write');
 const row=await query('SELECT * FROM connector_actions WHERE id=? AND workspace_id=? AND user_id=? AND organization_id=?',id,who.tenant,who.user.userId,who.organization).first<ActionRow>();
 if(!row)throw new AppError('Approbation introuvable pour cet utilisateur.',404);
 if(row.status!=='pending')return getResource(who.tenant,id);
 const resource=await getResource(who.tenant,id),data=JSON.parse(row.payload);
 if(canonicalJSON(resource.data)!==row.payload)throw new AppError('La proposition a changé. Une nouvelle approbation est nécessaire.',409,'stale_approval');
 if(row.expires_at<=Date.now())throw new AppError('Cette proposition a expiré. Demandez une nouvelle proposition.',409,'approval_expired');
 if(decision==='reject'){
  const rejected=await query("UPDATE connector_actions SET status='rejected' WHERE id=? AND status='pending'",id).run();
  if(!rejected.meta.changes)return getResource(who.tenant,id);
  return syncAction(who,id,'rejected');
 }
 const linked=await query('SELECT w.status,w.expires_at,w.actor_id,w.approved_version FROM agent_work w JOIN agent_work_artifacts a ON a.work_id=w.id WHERE a.resource_id=? AND w.workspace_id=?',id,who.tenant).first<{status:string;expires_at:number;actor_id:string;approved_version:number|null}>();
 if(linked&&(!['running','waiting_approval','waiting_external'].includes(linked.status)||linked.expires_at<=Date.now()||linked.actor_id!==who.user.userId||linked.approved_version===null))throw new AppError('Le travail est arrêté ou expiré. Reprenez le mandat avant cette action.',409,'work_inactive');
 const call=callSchema.parse({toolkit:data.toolkit,toolSlug:data.toolSlug,arguments:data.arguments,mode:data.mode});
 const {sdk,session}=await connectorSession(who,call.mode==='instant'?'instant':'catalog',call.mode);
 await metadata(sdk,call);
 let account:string|undefined;
 if(call.mode==='connected'){
  account=await ownedAccount(sdk,session,who,call);
  if((account||null)!==data.accountId)throw new AppError('Le compte connecté a changé. Demandez une nouvelle proposition.',409,'stale_approval');
 }else{
  const policy=await instantPolicy(who),entry=instantCatalog().find(e=>e.toolkit===call.toolkit&&e.toolSlug===call.toolSlug);
  if(!policy.enabled||!entry||entry.maxCostMicros!==row.max_micros||row.max_micros>policy.perCallMicros||row.user_limit!==policy.monthlyMicros||row.org_limit!==policy.organizationMonthlyMicros||row.month!==new Date().toISOString().slice(0,7))throw new AppError('Le tarif ou le budget Instant a changé. Demandez une nouvelle proposition.',409,'stale_approval');
 }
 // Atomic compare-and-set: only one request may cross the external mutation boundary.
 let claim;
 try{claim=await query("UPDATE connector_actions SET status='executing' WHERE id=? AND status='pending' AND expires_at>?",id,Date.now()).run();}
 catch{throw new AppError('Le budget Instant mensuel est atteint.',409,'instant_budget');}
 if(!claim.meta.changes)return getResource(who.tenant,id);
 let holdId:string|undefined;
 if(call.mode==='instant'){
  try{
   const hold=await reserve(who,'instant:'+id,Math.round(data.maxCredits*100));holdId=hold.id;
   await query('UPDATE connector_actions SET hold_id=? WHERE id=?',hold.id,id).run();
  }catch(error){await query("UPDATE connector_actions SET status='pending' WHERE id=? AND status='executing'",id).run();throw error;}
 }
 try{
  await authorize(who.tenant,who.user.userId,'write');
  await syncAction(who,id,'executing');
  // Reuse the proposal's own session, never a caller-supplied session/account or approval response.
  const original=checkSession(await sdk.sessions.use(row.session_id),await safeComposioUserId(who.tenant,who.user.userId),call.mode);
  const workGuard=async()=>{if(linked&&!await query("SELECT w.id FROM agent_work w JOIN agent_work_artifacts a ON a.work_id=w.id WHERE a.resource_id=? AND w.workspace_id=? AND w.actor_id=? AND w.status IN ('running','waiting_approval','waiting_external') AND w.expires_at>? AND w.approved_version IS NOT NULL",id,who.tenant,who.user.userId,Date.now()).first())throw new AppError('Le travail est arrêté ou expiré.',409,'work_inactive');};
  const result=await executeConnected(who,original,call,call.mode==='instant'?'instant_account':account,true,workGuard);
  const actual=call.mode==='instant'?parseActualInstantCharge(result):0;
  const uncertain=call.mode==='instant'&&(actual===null||actual>row.max_micros);
  const status=uncertain?'uncertain':result.resultType==='completed'?'completed':'failed';
  await query('UPDATE connector_actions SET status=?,actual_micros=?,result=?,log_id=? WHERE id=?',status,actual,JSON.stringify(result),result.logId,id).run();
  if(holdId&&actual!==null&&!uncertain){const units=result.resultType==='failed'?0:Math.min(Math.round(data.maxCredits*100),Math.ceil(Math.round(data.maxCredits*100)*actual/row.max_micros));await settleHold(holdId,units);}
  return syncAction(who,id,status,result);
 }catch(error){
  if(error instanceof AppError&&['connector_input_required','work_inactive'].includes(error.code)){
   await query("UPDATE connector_actions SET status='needs_input',actual_micros=0 WHERE id=?",id).run();
   if(holdId)await settleHold(holdId,0);
   return syncAction(who,id,'needs_input');
  }
  // Timeouts can hide a successful mutation or charge. Retain the hold; never retry automatically.
  await query("UPDATE connector_actions SET status='uncertain' WHERE id=?",id).run();
  await log(who,call.toolSlug,'uncertain');return syncAction(who,id,'uncertain');
 }
}

/** Internal social adapter: writes require an already claimed exact server mandate. */
export async function socialConnectorCall(who:BillingIdentity,call:{toolkit:string;toolSlug:string;arguments:Record<string,unknown>;accountId?:string},permit?:{deliveryId:string;ordinal:number;payloadDigest:string}|{replyId:string;payloadDigest:string}){
 await authorize(who.tenant,who.user.userId,'write');
 const parsed=callSchema.parse({toolkit:call.toolkit,toolSlug:call.toolSlug,arguments:call.arguments,mode:'connected'}),{sdk,session,scopeUser}=await connectorSession(who,'social');
 const tool=await metadata(sdk,parsed),accounts=await listScopedAccounts(sdk,{userIds:[scopeUser],statuses:['ACTIVE'],toolkitSlugs:[parsed.toolkit],limit:100},call.accountId);
 if(!call.accountId||!accounts.items.some(a=>a.id===call.accountId&&a.status==='ACTIVE'&&a.toolkit.slug===parsed.toolkit))throw new AppError('Le compte social doit être reconnecté.',409,'social_account_disconnected');
 const read=isReadOnlyTool(tool);
 if(!read){
  if(!permit)throw new AppError('Un mandat social exact est nécessaire.',403,'social_approval_required');
  const {digest}=await import('./platform-contracts');if(await digest(parsed.arguments)!==permit.payloadDigest)throw new AppError('Les paramètres approuvés ont changé.',409,'social_stale_approval');
  const valid='deliveryId' in permit?await query("SELECT d.id FROM social_deliveries d JOIN social_delivery_steps s ON s.delivery_id=d.id JOIN social_accounts a ON a.id=(SELECT account_id FROM social_posts WHERE id=d.post_id) WHERE d.id=? AND d.workspace_id=? AND d.actor_id=? AND d.status='publishing' AND s.ordinal=? AND s.status='submitting' AND s.tool_slug=? AND s.payload_digest=? AND a.connected_account_id=?",permit.deliveryId,who.tenant,who.user.userId,permit.ordinal,call.toolSlug,permit.payloadDigest,call.accountId).first():await query("SELECT r.id FROM social_replies r JOIN social_comments c ON c.id=r.comment_id JOIN social_accounts a ON a.id=c.account_id WHERE r.id=? AND r.workspace_id=? AND r.actor_id=? AND r.status='publishing' AND r.payload_digest=? AND a.connected_account_id=?",permit.replyId,who.tenant,who.user.userId,permit.payloadDigest,call.accountId).first();
  if(!valid)throw new AppError('Le mandat n’autorise pas cet envoi.',403,'social_approval_required');
 }
 return executeConnected(who,session,parsed,call.accountId,!read);
}

export async function socialConnections(who:BillingIdentity,toolkit:string){
 toolkit=toolkitSchema.parse(toolkit);const {sdk,scopeUser}=await connectorSession(who,'social');
 const accounts=await listScopedAccounts(sdk,{userIds:[scopeUser],statuses:['ACTIVE'],toolkitSlugs:[toolkit],limit:100});return accounts.items.map(account=>({id:account.id,status:account.status,toolkit:account.toolkit.slug}));
}
