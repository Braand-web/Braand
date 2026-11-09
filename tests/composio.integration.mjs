// Real Braand services, routes, permissions and SQLite; simulated SDK only. No real external calls.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const project=path.resolve(import.meta.dirname,'..'),runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,'node_modules');
const {build}=createRequire(path.join(runtime,'package.json'))('esbuild');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync(path.join(project,'drizzle')).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(path.join(project,'drizzle',file),'utf8'));
function statement(query,args=[]){return {bind(...values){return statement(query,values);},async first(column){const row=sql.prepare(query).get(...args);return column?row?.[column]??null:row??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return this._run();},_run(){const row=sql.prepare(query).run(...args);return {meta:{changes:Number(row.changes),last_row_id:Number(row.lastInsertRowid)}};}};}
const DB={prepare:query=>statement(query),async batch(statements){sql.exec('BEGIN');try{const rows=statements.map(item=>item._run());sql.exec('COMMIT');return rows;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const sessions=new Map(),accounts=new Map(),calls=[],effects=[],created=[],authorized=[],revoked=[];
const definitions=['COMPOSIO_SEARCH_TOOLS','COMPOSIO_GET_TOOL_SCHEMAS','COMPOSIO_MULTI_EXECUTE_TOOL','COMPOSIO_REMOTE_WORKBENCH','COMPOSIO_REMOTE_BASH_TOOL','COMPOSIO_PROXY_EXECUTE','COMPOSIO_MANAGE_CONNECTIONS','METAADS_CREATE_CAMPAIGN'].map(name=>({name,description:'Fixture schema',input_schema:{type:'object'}}));
const metadata=new Map([
 ['METAADS_GET_AD_ACCOUNTS',{slug:'METAADS_GET_AD_ACCOUNTS',toolkit:{slug:'metaads'},tags:['readOnlyHint']}],
 ['METAADS_GET_INSIGHTS',{slug:'METAADS_GET_INSIGHTS',toolkit:{slug:'metaads'},tags:['readOnlyHint']}],
 ['METAADS_CREATE_CAMPAIGN',{slug:'METAADS_CREATE_CAMPAIGN',toolkit:{slug:'metaads'},tags:['createHint']}],
 ['FACEBOOK_CREATE_POST',{slug:'FACEBOOK_CREATE_POST',toolkit:{slug:'facebook'},tags:['createHint']}],
 ['EXA_SEARCH',{slug:'EXA_SEARCH',toolkit:{slug:'exa'},tags:['readOnlyHint']}],
]);
const searchResult={resultType:'completed',logId:'log_search_fixture',data:{results:[{primary_tool_slugs:['METAADS_GET_AD_ACCOUNTS'],related_tool_slugs:['METAADS_GET_INSIGHTS'],difficulty:'medium',recommended_plan_steps:['Read accounts first','Read campaign insights'],known_pitfalls:['Do not use a page ID as an ad account ID.'],extra_guidance:'Verified skill context '.repeat(1500)}],tool_schemas:{METAADS_GET_AD_ACCOUNTS:{input_schema:{type:'object'}}}}};
class NativeInputRequiredError extends Error {
 constructor(inputRequests,requestState){super('Fixture native input required');this.inputRequests=inputRequests;this.requestState=requestState;}
}
const approvalQuestion={type:'elicitation',mode:'form',message:'Approve exact fixture call',requested_schema:{type:'object',properties:{decision:{type:'string',oneOf:[{const:'approve'},{const:'always_approve'},{const:'deny'}]}},required:['decision']}};
let actualCharge='0.10',executionResult='completed',executeThrows=false,forceForeignAccount=false,nativeChallenge=null,catalogueSlugs=['metaads','exa'];
function toolkitFor(session,slug){
 const account=forceForeignAccount?accounts.get('account_other'):[...accounts.values()].find(value=>value.userId===session.userId&&value.toolkit.slug===slug);
 return {slug,name:({metaads:'Meta Ads',exa:'Exa',github:'GitHub',notion:'Notion'})[slug]||slug,isNoAuth:slug==='exa',...(account?{connection:{isActive:account.status==='ACTIVE',connectedAccount:{id:account.id,status:account.status}}}:{})};
}
function makeSession(id,userId,options){
 const session={sessionId:id,userId,config:{user_id:userId,instant:options.instant,workbench:options.sandbox,proxy_execute:{enable:options.proxyExecute},manage_connections:{enabled:false}},sandbox:options.sandbox,async tools(){return definitions;},async toolkits(params={}){
  calls.push({kind:'toolkits',session:id,params});
  if(params.toolkits)return {items:params.toolkits.map(slug=>toolkitFor(session,slug)),cursor:undefined,totalPages:1};
  let items=catalogueSlugs.map(slug=>toolkitFor(session,slug));
  if(params.isConnected===true)items=items.filter(item=>item.connection?.isActive);
  if(params.search)items=items.filter(item=>(item.name+' '+item.slug).toLowerCase().includes(params.search.toLowerCase()));
  const page=params.cursor==='fixture-next-page'?1:Number(params.cursor?.replace('fixture-page-','')||0),next=page+1;
  return {items:items.slice(page,next),cursor:next<items.length?(next===1?'fixture-next-page':'fixture-page-'+next):undefined,totalPages:items.length};
 },async authorize(toolkit){authorized.push({userId,toolkit});return {id:'auth_fixture',redirectUrl:'https://connect.composio.dev/link/fixture'};},async executeMeta(name,input){calls.push({kind:'meta',session:id,name,input});return searchResult;},async search(input){calls.push({kind:'instant-search',session:id,input});return {toolkitConnectionStatuses:[{toolkit:'exa',instantAccount:{allowedToolSlugs:['EXA_SEARCH']}}]};},async execute(name,input,executionOptions){
  calls.push({kind:'execute',session:id,name,input:structuredClone(input),options:structuredClone(executionOptions)});
  if(nativeChallenge&&(!executionOptions?.inputResponses||nativeChallenge.repeat)){nativeChallenge.onChallenge?.();throw new NativeInputRequiredError(nativeChallenge.requests,nativeChallenge.state);}
  if(executeThrows)throw new Error('Simulated provider timeout');
  effects.push({name,input:structuredClone(input),options:structuredClone(executionOptions)});
  return {resultType:executionResult,logId:'log_execution_fixture',data:executionResult==='failed'?{}:{data:[{id:'act_fixture',name:'Fictional test account'}]},error:executionResult==='failed'?'Simulated provider refusal':null,...(executionOptions?.account==='instant_account'&&actualCharge!==null?{instantCharge:{amount:actualCharge,currency:'USD',chargedBy:'composio'}}:{})};
 }};sessions.set(id,session);return session;
}
globalThis.__composioTest={NativeInputRequiredError,env:{DB,COMPOSIO_API_KEY:'fixture_project_key_not_a_real_secret'},headers:new Headers({'x-braand-identity-id':'owner','x-braand-identity-email':'owner@test.invalid'}),makeClient(options){assert.equal(options.apiKey,'fixture_project_key_not_a_real_secret');return {
 sessions:{async create(userId,config){const id='session_fixture_'+(created.length+1);created.push({id,userId,config});return makeSession(id,userId,config);},async use(id){assert.ok(sessions.has(id),'A session must be persisted before reuse');return sessions.get(id);}},
 tools:{async getRawComposioTools({tools}){return tools.map(slug=>metadata.get(slug)).filter(Boolean);}},
 connectedAccounts:{async list({userIds,cursor}){assert.ok(userIds?.length===1,'Account listing must be scoped to one Braand user');if(cursor===undefined)return {items:[],nextCursor:"fixture-owned-accounts-page-2"};assert.equal(cursor,"fixture-owned-accounts-page-2");return {items:[...accounts.values()].filter(account=>userIds.includes(account.userId)),nextCursor:null};},async revoke(id){revoked.push(id);accounts.get(id).status='REVOKED';return {};}}
 };}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('External calls are forbidden in this isolated suite');};
const out=path.join(project,'.local-build','composio-integration.mjs');mkdirSync(path.dirname(out),{recursive:true});
const modules={connectors:'lib/composio.ts',server:'lib/server.ts',billing:'lib/billing.ts',route:'app/api/connectors/[...path]/route.ts'};
await build({stdin:{contents:Object.entries(modules).map(([name,file])=>'export * as '+name+' from "'+path.join(project,file).replaceAll('\\','/')+'";').join('\n'),resolveDir:project,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',nodePaths:[runtime],plugins:[{name:'isolated-composio-bindings',setup(builder){builder.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation|@composio\/core|@composio\/anthropic)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__composioTest.env;':args.path==='next/headers'?'export async function headers(){return globalThis.__composioTest.headers;}':args.path==='@composio/core'?'export const ComposioToolInputRequiredError=globalThis.__composioTest.NativeInputRequiredError;export class Composio {constructor(options){Object.assign(this,globalThis.__composioTest.makeClient(options));}}':args.path==='@composio/anthropic'?'export class AnthropicProvider {}':'export function redirect(){throw new Error("unexpected redirect");}'}));}}]});
const {connectors:c,server:s,billing:b,route}=await import(pathToFileURL(out).href),env=globalThis.__composioTest.env;
let checks=0;const failures=[];
async function check(name,fn){try{await fn();checks++;console.log('PASS '+name);}catch(error){failures.push({name,error});console.error('FAIL '+name+': '+error.message);}}
const request=(method='GET',body,space='owner',origin='https://braand.test')=>new Request('https://braand.test/api/connectors/toolkits',{method,headers:{'Content-Type':'application/json','x-braand-workspace':space,...(origin?{origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
const context=(...segments)=>({params:Promise.resolve({path:segments})});
const who=await s.identity(request());
const call=(toolSlug='METAADS_CREATE_CAMPAIGN',arguments_={name:'Fictional test campaign',status:'PAUSED'})=>({toolkit:'metaads',toolSlug,arguments:arguments_});
const countExecutions=()=>calls.filter(item=>item.kind==='execute').length;
async function proposal(args=call()){return c.executeConnectorAgentTool(who,'chat-fixture','braand_connector_action',args);}
async function secondUser(){globalThis.__composioTest.headers=new Headers({'x-braand-identity-id':'other','x-braand-identity-email':'other@test.invalid'});try{return await s.identity(request('GET',undefined,'other'));}finally{globalThis.__composioTest.headers=new Headers({'x-braand-identity-id':'owner','x-braand-identity-email':'owner@test.invalid'});}}

await check('Sessions are tenant-scoped, persist across turns, and explicitly disable Instant, sandbox and proxy',async()=>{
 const first=await c.connectorSession(who,'chat-fixture'),again=await c.connectorSession(who,'chat-fixture');
 assert.equal(first.session.sessionId,again.session.sessionId);assert.match(first.scopeUser,/^braand_[a-f0-9]{64}$/);
 const other=await secondUser(),foreign=await c.connectorSession(other,'chat-fixture');assert.notEqual(first.scopeUser,foreign.scopeUser);assert.notEqual(first.session.sessionId,foreign.session.sessionId);
 const config=created.find(item=>item.id===first.session.sessionId).config;
 assert.equal(config.instant,false);assert.deepEqual(config.sandbox,{enable:false});assert.equal(config.proxyExecute,false);
 assert.equal(config.toolkits,undefined,'All toolkits remain discoverable');
 accounts.set('account_owner',{id:'account_owner',userId:first.scopeUser,toolkit:{slug:'metaads'},status:'ACTIVE'});
 accounts.set('account_other',{id:'account_other',userId:foreign.scopeUser,toolkit:{slug:'metaads'},status:'ACTIVE'});
});
await check('Agent receives dynamic discovery and guarded adapters, never raw writes, batch, sandbox or proxy',async()=>{
 const tools=await c.connectorAgentTools(who,'chat-fixture');
 assert.deepEqual(tools.map(tool=>tool.name).sort(),['COMPOSIO_GET_TOOL_SCHEMAS','COMPOSIO_SEARCH_TOOLS','braand_connect_toolkit','braand_connector_action','braand_connector_receipt','braand_connector_status'].sort());
 for(const name of ['COMPOSIO_MULTI_EXECUTE_TOOL','COMPOSIO_REMOTE_WORKBENCH','COMPOSIO_REMOTE_BASH_TOOL','COMPOSIO_PROXY_EXECUTE','METAADS_CREATE_CAMPAIGN'])await assert.rejects(()=>c.executeConnectorAgentTool(who,'chat-fixture',name,{}));
});
await check('SEARCH result including long skill, plan, pitfalls and schemas reaches agent intact',async()=>{
 const result=await c.executeConnectorAgentTool(who,'chat-fixture','COMPOSIO_SEARCH_TOOLS',{queries:[{use_case:'Read Meta Ads accounts and insights'}]});
 assert.strictEqual(result,searchResult);assert.equal(result.data.results[0].extra_guidance.length,searchResult.data.results[0].extra_guidance.length);assert.equal(countExecutions(),0);
});
await check('Connector catalogue follows the SDK cursor and retains user-scoped connection state',async()=>{
 const first=await c.listConnectorToolkits(who,new URLSearchParams());assert.equal(first.items[0].connected,true);assert.equal(first.nextCursor,'fixture-next-page');
 assert.equal(Object.hasOwn(calls.at(-1).params,'isConnected'),false);assert.equal(calls.at(-1).params.limit,30);
 const second=await c.listConnectorToolkits(who,new URLSearchParams({cursor:first.nextCursor}));assert.equal(second.items[0].slug,'exa');assert.equal(second.nextCursor,null);
 assert.equal(Object.hasOwn(calls.at(-1).params,'isConnected'),false);assert.equal(calls.at(-1).params.cursor,first.nextCursor);
});
await check('Connected catalogue uses native filtering before pagination and composes with search without scanning the full catalogue',async()=>{
 const {scopeUser}=await c.connectorSession(who),other=await secondUser(),foreign=await c.connectorSession(other),previous=catalogueSlugs;
 accounts.set('account_catalogue_github',{id:'account_catalogue_github',userId:scopeUser,toolkit:{slug:'github'},status:'ACTIVE'});
 accounts.set('account_catalogue_notion',{id:'account_catalogue_notion',userId:foreign.scopeUser,toolkit:{slug:'notion'},status:'ACTIVE'});
 catalogueSlugs=['metaads','exa','notion','github'];
 try{
  const before=calls.length,first=await c.listConnectorToolkits(who,new URLSearchParams({connected:'true'}));
  assert.equal(calls.length,before+1);assert.deepEqual(first.items.map(item=>item.slug),['metaads']);assert.equal(first.nextCursor,'fixture-next-page');
  assert.equal(calls.at(-1).params.isConnected,true);
  const second=await c.listConnectorToolkits(who,new URLSearchParams({connected:'true',cursor:first.nextCursor}));
  assert.equal(calls.length,before+2);assert.deepEqual(second.items.map(item=>item.slug),['github']);assert.equal(second.nextCursor,null);assert.equal(second.items[0].accountId,'account_catalogue_github');
  assert.deepEqual(calls.at(-1).params,{search:undefined,cursor:first.nextCursor,limit:30,isConnected:true});
  const matching=await c.listConnectorToolkits(who,new URLSearchParams({connected:'true',search:'GitHub'}));
  assert.equal(calls.length,before+3);assert.deepEqual(matching.items.map(item=>item.slug),['github']);assert.equal(matching.nextCursor,null);assert.equal(calls.at(-1).params.search,'GitHub');
  const noAuth=await c.listConnectorToolkits(who,new URLSearchParams({connected:'true',search:'Exa'}));
  assert.equal(calls.length,before+4);assert.deepEqual(noAuth.items,[]);assert.equal(noAuth.nextCursor,null);
 }finally{catalogueSlugs=previous;accounts.delete('account_catalogue_github');accounts.delete('account_catalogue_notion');}
});
await check('Connected catalogue isolates other users and a second workspace belonging to the same user',async()=>{
 const other=await secondUser(),foreign=await c.listConnectorToolkits(other,new URLSearchParams({connected:'true'}));
 assert.deepEqual(foreign.items.map(item=>item.accountId),['account_other']);assert.equal(foreign.nextCursor,null);
 const space='catalogue_secondary_workspace';sql.prepare('INSERT INTO workspaces(id,name,created_at,organization_id) VALUES (?,?,?,?)').run(space,'Catalogue fixture',Date.now(),who.organization);
 try{
  const scoped=await s.identity(request('GET',undefined,space)),result=await c.listConnectorToolkits(scoped,new URLSearchParams({connected:'true'}));
  assert.deepEqual(result.items,[]);assert.equal(result.nextCursor,null);
  const ownSession=await c.connectorSession(who),secondSession=await c.connectorSession(scoped);
  assert.notEqual(ownSession.scopeUser,secondSession.scopeUser);assert.notEqual(ownSession.session.sessionId,secondSession.session.sessionId);assert.equal(calls.at(-1).session,secondSession.session.sessionId);
 }finally{sql.prepare('DELETE FROM connector_sessions WHERE workspace_id=?').run(space);sql.prepare('DELETE FROM workspaces WHERE id=?').run(space);}
});
await check('Catalogue HTTP query accepts only connected=true and validates filters before contacting the SDK',async()=>{
 const catalogueRequest=query=>new Request('https://braand.test/api/connectors/toolkits?'+query,{headers:request().headers});
 const response=await route.GET(catalogueRequest('connected=true&search=Meta'),context('toolkits'));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).items.map(item=>item.slug),['metaads']);assert.equal(calls.at(-1).params.isConnected,true);assert.equal(calls.at(-1).params.search,'Meta');
 const before=calls.length,sessionCount=created.length;
 for(const query of ['connected=','connected=false','connected=1','connected=TRUE','connected=true&connected=true','connected=true&connected=false','connected=true&search='+('s'.repeat(201)),'connected=true&cursor='+('c'.repeat(2001))]){
  const invalid=await route.GET(catalogueRequest(query),context('toolkits'));assert.equal(invalid.status,400,query.slice(0,80));assert.equal((await invalid.json()).code,'validation_error');
 }
 assert.equal(calls.length,before);assert.equal(created.length,sessionCount);
 const key=env.COMPOSIO_API_KEY;delete env.COMPOSIO_API_KEY;
 try{assert.equal((await route.GET(catalogueRequest('connected=invalid'),context('toolkits'))).status,400);const unavailable=await route.GET(catalogueRequest('connected=true'),context('toolkits'));assert.equal(unavailable.status,200);assert.deepEqual((await unavailable.json()).items,[]);}finally{env.COMPOSIO_API_KEY=key;}
});
await check('Authorization returns only a hosted Connect Link without creating accounts or accepting consent',async()=>{
 const before=accounts.size,result=await c.authorizeConnector(who,'metaads');assert.equal(result.redirectUrl,'https://connect.composio.dev/link/fixture');assert.equal(accounts.size,before);assert.equal(authorized.at(-1).toolkit,'metaads');
});
await check('Connection diagnosis reports active, expired and missing accounts without execution or authorization',async()=>{
 const before=countExecutions(),authorizations=authorized.length;
 const active=await c.executeConnectorAgentTool(who,'chat-fixture','braand_connector_status',{toolkits:['metaads','github']});
 assert.equal(active.items[0].connected,true);assert.equal(active.items[0].status,'ACTIVE');assert.equal(active.items[1].status,'NOT_CONNECTED');assert.equal(active.items[1].nextStep,'connect');
 assert.equal(active.permissionStatus,'not_checked');assert.equal(active.writesRequireExactApproval,true);
 accounts.get('account_owner').status='EXPIRED';
 try{const expired=await c.diagnoseConnectors(who,{toolkits:['metaads']});assert.equal(expired.items[0].connected,false);assert.equal(expired.items[0].status,'EXPIRED');assert.equal(expired.items[0].nextStep,'reconnect');}finally{accounts.get('account_owner').status='ACTIVE';}
 const other=await secondUser();accounts.get('account_other').status='EXPIRED';
 try{const foreign=await c.diagnoseConnectors(other,{toolkits:['metaads']});assert.equal(foreign.items[0].status,'EXPIRED');assert.equal(JSON.stringify(foreign).includes('account_owner'),false);}finally{accounts.get('account_other').status='ACTIVE';}
 assert.equal(countExecutions(),before);assert.equal(authorized.length,authorizations);
});
await check('Connection diagnosis cannot mistake another user account for an active own connection or bypass schema limits',async()=>{
 forceForeignAccount=true;
 try{const result=await c.diagnoseConnectors(who,{toolkits:['metaads']});assert.equal(result.items[0].connected,false);assert.equal(JSON.stringify(result).includes('account_other'),false);}finally{forceForeignAccount=false;}
 const before=calls.length;
 for(const input of [{toolkits:[]},{toolkits:Array(9).fill('metaads')},{toolkits:['metaads'],accountId:'account_other'},{toolkits:['METAADS']}])await assert.rejects(()=>c.diagnoseConnectors(who,input));
 assert.equal(calls.length,before);
 const key=env.COMPOSIO_API_KEY;delete env.COMPOSIO_API_KEY;
 try{assert.deepEqual(await c.diagnoseConnectors(who,{toolkits:['metaads']}),{configured:false,items:[],reason:'configuration_pending'});}finally{env.COMPOSIO_API_KEY=key;}
 assert.equal(calls.length,before);
});
await check('Facebook publication remains pending until exact approval, executes once and exposes an authoritative receipt',async()=>{
 const {scopeUser}=await c.connectorSession(who);accounts.set('account_facebook',{id:'account_facebook',userId:scopeUser,toolkit:{slug:'facebook'},status:'ACTIVE'});
 try{
  const args={page_id:'123456789',message:'Fictional publication for an isolated test',published:true},before=countExecutions();
  const pending=await proposal({toolkit:'facebook',toolSlug:'FACEBOOK_CREATE_POST',arguments:args});
  assert.equal(pending.status,'pending');assert.equal(countExecutions(),before);assert.deepEqual(pending.data.arguments,args);
  await Promise.all([c.decideConnectorAction(who,pending.id,'approve'),c.decideConnectorAction(who,pending.id,'approve')]);
  const receipt=await c.executeConnectorAgentTool(who,'chat-fixture','braand_connector_receipt',{id:pending.id});
  assert.equal(receipt.status,'completed');assert.equal(receipt.logId,'log_execution_fixture');assert.equal(countExecutions(),before+1);
  const sent=calls.filter(item=>item.kind==='execute').at(-1);assert.deepEqual(sent.input,args);assert.equal(sent.options.account,'account_facebook');
 }finally{accounts.delete('account_facebook');}
});
await check('Active own-account read-only tool executes with exact arguments and account',async()=>{
 const input={fields:['id','name']},before=countExecutions();await proposal(call('METAADS_GET_AD_ACCOUNTS',input));assert.equal(countExecutions(),before+1);
 assert.deepEqual(calls.filter(item=>item.kind==='execute').at(-1),{kind:'execute',session:sessions.values().next().value.sessionId,name:'METAADS_GET_AD_ACCOUNTS',input,options:{account:'account_owner'}});
});
await check('Inactive accounts and a foreign connected-account override cannot be executed or revoked',async()=>{
 const before=countExecutions();accounts.get('account_owner').status='EXPIRED';await assert.rejects(()=>proposal(call('METAADS_GET_AD_ACCOUNTS')));accounts.get('account_owner').status='ACTIVE';
 await assert.rejects(()=>proposal({...call('METAADS_GET_AD_ACCOUNTS'),accountId:'account_other'}));await assert.rejects(()=>c.revokeConnector(who,'account_other'));assert.equal(countExecutions(),before);assert.equal(revoked.length,0);
});
await check('A session reporting another user account cannot cross the provider execution boundary',async()=>{
 const before=countExecutions();forceForeignAccount=true;try{await assert.rejects(()=>proposal(call('METAADS_GET_AD_ACCOUNTS')));}finally{forceForeignAccount=false;}
 assert.equal(countExecutions(),before);
});
await check('A restored connected session cannot silently enable Instant fallback',async()=>{
 const {session}=await c.connectorSession(who,'chat-fixture'),before=countExecutions(),previous=session.config.instant;session.config.instant={return_instant_charge:true};
 try{await assert.rejects(()=>proposal({toolkit:'exa',toolSlug:'EXA_SEARCH',arguments:{query:'Must not run without approval'},mode:'connected'}));}finally{session.config.instant=previous;}
 assert.equal(countExecutions(),before);
});
await check('Meta write is pending with exact original arguments and makes no provider call',async()=>{
 const before=countExecutions(),args={name:'Fictional campaign',daily_budget:100,status:'PAUSED'},result=await proposal(call('METAADS_CREATE_CAMPAIGN',args));
 assert.equal(result.kind,'connector_action');assert.equal(result.status,'pending');assert.deepEqual(result.data.arguments,args);assert.equal(countExecutions(),before);
});
await check('Concurrent approvals and later replays execute an exact approved write once',async()=>{
 const args={name:'Approved fictional campaign',daily_budget:100,status:'PAUSED'},result=await proposal(call('METAADS_CREATE_CAMPAIGN',args)),before=countExecutions();
 await Promise.all([c.decideConnectorAction(who,result.id,'approve'),c.decideConnectorAction(who,result.id,'approve')]);await c.decideConnectorAction(who,result.id,'approve');
 assert.equal(countExecutions(),before+1);assert.deepEqual(calls.filter(item=>item.kind==='execute').at(-1).input,args);assert.equal(sql.prepare('SELECT status FROM connector_actions WHERE id=?').get(result.id).status,'completed');
});
await check('Native approval on a read produces a local card; only an explicit approval resumes the same arguments and account once',async()=>{
 const args={fields:['id','name']},beforeEffects=effects.length,beforeRequests=countExecutions();nativeChallenge={requests:{native_fixture:approvalQuestion},state:'sensitive_native_request_state'};
 try{
  const pending=await proposal(call('METAADS_GET_AD_ACCOUNTS',args));assert.equal(pending.status,'pending');assert.equal(effects.length,beforeEffects);assert.equal(countExecutions(),beforeRequests+1);
  assert.equal(JSON.stringify(pending).includes(nativeChallenge.state),false);assert.equal(JSON.stringify(pending).includes('always_approve'),false);
  const finished=await c.decideConnectorAction(who,pending.id,'approve');assert.equal(finished.status,'completed');assert.equal(effects.length,beforeEffects+1);assert.equal(countExecutions(),beforeRequests+3);
  const requests=calls.filter(item=>item.kind==='execute').slice(-2);assert.equal(requests[0].name,requests[1].name);assert.deepEqual(requests[0].input,args);assert.deepEqual(requests[1].input,args);assert.equal(requests[0].options.account,requests[1].options.account);
  assert.deepEqual(requests[1].options.inputResponses,{native_fixture:{action:'accept',content:{decision:'approve'}}});assert.equal(requests[1].options.requestState,'sensitive_native_request_state');assert.equal(JSON.stringify(finished).includes(nativeChallenge.state),false);
 }finally{nativeChallenge=null;}
});
await check('Revoked membership is checked again before a native approved call can resume',async()=>{
 const pending=await proposal(),beforeEffects=effects.length,beforeRequests=countExecutions();nativeChallenge={requests:{native_fixture:approvalQuestion},state:'sensitive_native_revocation_state',onChallenge(){sql.prepare("UPDATE organization_members SET active=0 WHERE organization_id='owner' AND user_id='owner'").run();}};
 try{const result=await c.decideConnectorAction(who,pending.id,'approve');assert.equal(result.status,'uncertain');}finally{nativeChallenge=null;sql.prepare("UPDATE organization_members SET active=1 WHERE organization_id='owner' AND user_id='owner'").run();}
 assert.equal(effects.length,beforeEffects);assert.equal(countExecutions(),beforeRequests+1);
});
await check('Receipt returns authoritative persisted status and result without a new provider execution or cross-user disclosure',async()=>{
 const pending=await proposal(),pendingReceipt=await c.executeConnectorAgentTool(who,'chat-fixture','braand_connector_receipt',{id:pending.id});assert.deepEqual(pendingReceipt,{id:pending.id,status:'pending',result:null,logId:null});
 const finished=await c.decideConnectorAction(who,pending.id,'approve'),before=countExecutions();
 // A resource projection cannot make the model invent a successful provider result.
 await s.updateResource(who.tenant,finished.id,finished.version,{data:{...finished.data,result:{tampered:true}}});
 const receipt=await c.executeConnectorAgentTool(who,'chat-fixture','braand_connector_receipt',{id:pending.id});
 assert.equal(receipt.status,'completed');assert.equal(receipt.logId,'log_execution_fixture');assert.equal(receipt.result.resultType,'completed');assert.deepEqual(receipt.result.data,{data:[{id:'act_fixture',name:'Fictional test account'}]});assert.equal(receipt.result.tampered,undefined);assert.equal(countExecutions(),before);
 const other=await secondUser();await assert.rejects(()=>c.executeConnectorAgentTool(other,'chat-fixture','braand_connector_receipt',{id:pending.id}));
 await assert.rejects(()=>c.executeConnectorAgentTool(who,'chat-fixture','braand_connector_receipt',{id:pending.id,arguments:{tampered:true}}));assert.equal(countExecutions(),before);
});
await check('Competing approval and rejection preserve one authoritative decision and never execute after a rejection wins',async()=>{
 for(const decisions of [['approve','reject'],['reject','approve']]){
  const pending=await proposal(),before=countExecutions();await Promise.allSettled(decisions.map(decision=>c.decideConnectorAction(who,pending.id,decision)));
  const row=sql.prepare('SELECT status FROM connector_actions WHERE id=?').get(pending.id),resource=await s.getResource(who.tenant,pending.id);
  assert.ok(['rejected','completed'].includes(row.status));assert.equal(resource.status,row.status);assert.equal(resource.data.status,row.status);assert.equal(countExecutions(),before+(row.status==='completed'?1:0));
 }
});
await check('Rejection, changed arguments, expiry, and another user cannot authorize the proposed write',async()=>{
 const before=countExecutions(),rejected=await proposal();await c.decideConnectorAction(who,rejected.id,'reject');await c.decideConnectorAction(who,rejected.id,'approve');
 const stale=await proposal();await s.updateResource(who.tenant,stale.id,stale.version,{data:{...stale.data,arguments:{name:'Tampered campaign'}}});await assert.rejects(()=>c.decideConnectorAction(who,stale.id,'approve'));
 const expired=await proposal();sql.prepare('UPDATE connector_actions SET expires_at=? WHERE id=?').run(Date.now()-1,expired.id);await assert.rejects(()=>c.decideConnectorAction(who,expired.id,'approve'));
 const foreign=await proposal(),other=await secondUser();await assert.rejects(()=>c.decideConnectorAction(other,foreign.id,'approve'));assert.equal(countExecutions(),before);
});
await check('Account replacement after proposal invalidates approval before mutation',async()=>{
 const pending=await proposal(),account=accounts.get('account_owner'),before=countExecutions();accounts.delete('account_owner');accounts.set('replacement',{...account,id:'replacement'});
 await assert.rejects(()=>c.decideConnectorAction(who,pending.id,'approve'));assert.equal(countExecutions(),before);accounts.delete('replacement');accounts.set(account.id,account);
});
await check('Unknown or missing Instant upper-bound prices deny all paid calls',async()=>{
 const before=countExecutions();await assert.rejects(()=>proposal({toolkit:'exa',toolSlug:'EXA_SEARCH',arguments:{query:'Fictional test'},mode:'instant'}));assert.equal(countExecutions(),before);
});
await check('Connector routes enforce identity, origin, exact decision schema and private caching',async()=>{
 const previous=globalThis.__composioTest.headers;globalThis.__composioTest.headers=new Headers();assert.equal((await route.GET(request(),context('toolkits'))).status,401);globalThis.__composioTest.headers=previous;
 assert.equal((await route.POST(request('POST',{toolkit:'metaads'},'owner','https://evil.test'),context('authorize'))).status,403);
 assert.equal((await route.POST(request('POST',{toolkit:'metaads'},'owner',null),context('authorize'))).status,403);
 const response=await route.GET(request(),context('toolkits'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
 const pending=await proposal();assert.equal((await route.POST(request('POST',{decision:'approve',arguments:{name:'Tampered'}},'owner'),context('approvals',pending.id))).status,400);
});

// Paid-path fixtures below are simulated; every actual provider call remains intercepted above.
const now=Date.now();sql.prepare("INSERT INTO billing_subscriptions(id,organization_id,plan,cycle,start_at,end_at,order_id) VALUES ('fixture_business','owner','business','period',?,?,'fixture_order')").run(now-1000,now+30*86400000);
sql.prepare("INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) VALUES ('fixture_credits','owner','topup','fixture',100000,100000,?,?)").run(now-1000,now);
env.COMPOSIO_INSTANT_ENABLED='true';env.ANTHROPIC_RATE_JSON=JSON.stringify({model:'claude-opus-5-5',input:5,output:25,cacheWrite:6.25,cacheRead:.5,usdXaf:600,overheadXaf:1,verifiedAt:new Date().toISOString()});
env.COMPOSIO_INSTANT_CATALOG_JSON=JSON.stringify([{toolkit:'exa',toolSlug:'EXA_SEARCH',maxCostUsd:'0.10',verifiedAt:new Date().toISOString(),sourceUrl:'https://docs.composio.dev/docs/instant-tools'}]);
const instant=()=>proposal({toolkit:'exa',toolSlug:'EXA_SEARCH',arguments:{query:'Fictional test only'},mode:'instant'});
await check('Instant approval reserves Braand credits and reconciles explicit actual charge',async()=>{
 const pending=await instant(),before=countExecutions();assert.equal(pending.data.priceUsd,.10);assert.equal(countExecutions(),before);
 const result=await c.decideConnectorAction(who,pending.id,'approve');assert.equal(result.status,'completed');const row=sql.prepare('SELECT actual_micros,hold_id FROM connector_actions WHERE id=?').get(pending.id);assert.equal(row.actual_micros,100000);assert.equal(sql.prepare('SELECT status FROM credit_holds WHERE id=?').get(row.hold_id).status,'settled');assert.equal(calls.filter(item=>item.kind==='execute').at(-1).options.account,'instant_account');
});
await check('An uncertain provider result is not retried and preserves the reservation',async()=>{
 const pending=await instant(),before=countExecutions();executeThrows=true;try{await c.decideConnectorAction(who,pending.id,'approve');}finally{executeThrows=false;}
 await c.decideConnectorAction(who,pending.id,'approve');assert.equal(countExecutions(),before+1);const row=sql.prepare('SELECT status,hold_id FROM connector_actions WHERE id=?').get(pending.id);assert.equal(row.status,'uncertain');assert.equal(sql.prepare('SELECT status FROM credit_holds WHERE id=?').get(row.hold_id).status,'reserved');
});
await check('Missing actual Instant cost remains unresolved rather than being treated as a free call',async()=>{
 const pending=await instant();actualCharge=null;try{await c.decideConnectorAction(who,pending.id,'approve');}finally{actualCharge='0.10';}
 const row=sql.prepare('SELECT status,actual_micros,hold_id FROM connector_actions WHERE id=?').get(pending.id);assert.equal(row.status,'uncertain');assert.equal(row.actual_micros,null);assert.equal(sql.prepare('SELECT status FROM credit_holds WHERE id=?').get(row.hold_id).status,'reserved');
});
await check('A changed Instant cost bound invalidates the previous approval without spending',async()=>{
 const pending=await instant(),before=countExecutions(),catalog=env.COMPOSIO_INSTANT_CATALOG_JSON;env.COMPOSIO_INSTANT_CATALOG_JSON=JSON.stringify([{...JSON.parse(catalog)[0],maxCostUsd:'0.09'}]);
 try{await assert.rejects(()=>c.decideConnectorAction(who,pending.id,'approve'));}finally{env.COMPOSIO_INSTANT_CATALOG_JSON=catalog;}
 assert.equal(countExecutions(),before);
});
await check('Native authentication, unknown forms, missing state and mixed questions never receive consent or consume credits',async()=>{
 const unsupported=[
  {requests:{native_fixture:{type:'elicitation',mode:'url',url:'https://connect.composio.dev/native-auth'}},state:'sensitive_native_state_url'},
  {requests:{native_fixture:{...approvalQuestion,requested_schema:{type:'object',properties:{api_key:{type:'string'}},required:['api_key']}}},state:'sensitive_native_state_auth'},
  {requests:{native_fixture:approvalQuestion},state:undefined},
  {requests:{native_fixture:{...approvalQuestion,requested_schema:{type:'object',properties:{decision:{type:'string',enum:['approve','deny']},confirm:{type:'boolean'}}}}},state:'sensitive_native_state_extra'},
  {requests:{native_fixture:approvalQuestion,unknown_fixture:{...approvalQuestion,mode:'url'}},state:'sensitive_native_state_mixed'},
  {requests:{native_fixture:{...approvalQuestion,requested_schema:{type:'object',properties:{decision:{type:'string',enum:['approve','consent']}}}}},state:'sensitive_native_state_enum'},
 ];
 for(const challenge of unsupported){
  const pending=await instant(),beforeEffects=effects.length,beforeRequests=countExecutions();nativeChallenge=challenge;
  let result;try{result=await c.decideConnectorAction(who,pending.id,'approve');}finally{nativeChallenge=null;}
  assert.equal(result.status,'needs_input');assert.equal(effects.length,beforeEffects);assert.equal(countExecutions(),beforeRequests+1);
  const row=sql.prepare('SELECT actual_micros,hold_id FROM connector_actions WHERE id=?').get(pending.id),hold=sql.prepare('SELECT status,actual FROM credit_holds WHERE id=?').get(row.hold_id);assert.equal(row.actual_micros,0);assert.equal(hold.status,'settled');assert.equal(hold.actual,0);
  assert.equal(JSON.stringify(result).includes('sensitive_native_state_'),false);assert.equal(JSON.stringify(result).includes('native_fixture'),false);
 }
});
await check('A repeated native challenge stops after one approved resume without execution or charge',async()=>{
 const pending=await instant(),beforeEffects=effects.length,beforeRequests=countExecutions();nativeChallenge={requests:{native_fixture:approvalQuestion},state:'sensitive_native_repeat_state',repeat:true};
 let result;try{result=await c.decideConnectorAction(who,pending.id,'approve');}finally{nativeChallenge=null;}
 assert.equal(result.status,'needs_input');assert.equal(effects.length,beforeEffects);assert.equal(countExecutions(),beforeRequests+2);const row=sql.prepare('SELECT hold_id FROM connector_actions WHERE id=?').get(pending.id);assert.equal(sql.prepare('SELECT actual FROM credit_holds WHERE id=?').get(row.hold_id).actual,0);
});
await check('A provider failure without a delivery returns Braand credits while retaining the actual platform cost',async()=>{
 const pending=await instant();executionResult='failed';try{await c.decideConnectorAction(who,pending.id,'approve');}finally{executionResult='completed';}
 const row=sql.prepare('SELECT status,actual_micros,hold_id FROM connector_actions WHERE id=?').get(pending.id);assert.equal(row.status,'failed');assert.equal(row.actual_micros,100000);
 const hold=sql.prepare('SELECT status,actual FROM credit_holds WHERE id=?').get(row.hold_id);assert.equal(hold.status,'settled');assert.equal(hold.actual,0);
});
await check('Plan downgrade invalidates a pending Instant approval even when its call price still fits Pro',async()=>{
 const catalog=env.COMPOSIO_INSTANT_CATALOG_JSON;env.COMPOSIO_INSTANT_CATALOG_JSON=JSON.stringify([{...JSON.parse(catalog)[0],maxCostUsd:'0.05'}]);
 const pending=await instant(),before=countExecutions();sql.prepare("UPDATE billing_subscriptions SET plan='pro' WHERE id='fixture_business'").run();
 try{await assert.rejects(()=>c.decideConnectorAction(who,pending.id,'approve'));}finally{sql.prepare("UPDATE billing_subscriptions SET plan='business' WHERE id='fixture_business'").run();env.COMPOSIO_INSTANT_CATALOG_JSON=catalog;}
 assert.equal(countExecutions(),before);assert.equal(sql.prepare('SELECT status FROM connector_actions WHERE id=?').get(pending.id).status,'pending');
});
await check('Monthly Instant budget remains atomic when two approvals compete for the remaining allowance',async()=>{
 const month=new Date().toISOString().slice(0,7),used=sql.prepare("SELECT COALESCE(SUM(COALESCE(actual_micros,max_micros)),0) n FROM connector_actions WHERE organization_id='owner' AND month=? AND status IN ('executing','completed','failed','uncertain')").get(month).n;
 const filler=await proposal();sql.prepare("UPDATE connector_actions SET status='completed',max_micros=?,actual_micros=? WHERE id=?").run(1900000-used,1900000-used,filler.id);
 const one=await instant(),two=await instant(),before=countExecutions();const settled=await Promise.allSettled([c.decideConnectorAction(who,one.id,'approve'),c.decideConnectorAction(who,two.id,'approve')]);
 assert.equal(settled.filter(result=>result.status==='fulfilled').length,1);assert.equal(settled.filter(result=>result.status==='rejected').length,1);assert.equal(countExecutions(),before+1);
 const total=sql.prepare("SELECT SUM(COALESCE(actual_micros,max_micros)) n FROM connector_actions WHERE organization_id='owner' AND month=? AND status IN ('executing','completed','failed','uncertain')").get(month).n;assert.equal(total,2000000);
});
await check('Audit records tool status without arguments, account data or provider credentials',async()=>{
 const rows=sql.prepare("SELECT detail FROM audit WHERE action LIKE 'connector.%'").all();assert.ok(rows.length>0);
 for(const row of rows){const detail=JSON.parse(row.detail);assert.ok(Object.keys(detail).every(key=>['status','logId'].includes(key)));assert.equal(row.detail.includes(env.COMPOSIO_API_KEY),false);assert.equal(row.detail.includes('Fictional test account'),false);}
});
await check('approved durable work proposes a linked exact action once and preserves its receipt on resume',async()=>{
 const conversation=await s.createResource(who.tenant,'conversation','Mission fixture',{},'saved'),resource=await s.createResource(who.tenant,'work','Mandat fixture',{},'draft'),now=Date.now();
 sql.prepare("INSERT INTO agent_work(id,workspace_id,organization_id,actor_id,conversation_id,objective,status,approved_version,budget_units,expires_at,next_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'running',1,1000,?,?,?,?)").run(resource.id,who.tenant,who.organization,who.user.userId,conversation.id,'Test',now+600000,now,now,now);
 const step=resource.id+':step';sql.prepare("INSERT INTO agent_work_steps(id,work_id,ordinal,title,instruction,criteria,depends_on,status,max_units) VALUES (?,?,0,'Test','Test','[]','[]','running',500)").run(step,resource.id);
 const invoke=(name,args)=>c.executeMissionConnectorTool(who,conversation.id,name,args,resource.id,step),before=countExecutions();
 for(const name of ['COMPOSIO_REMOTE_BASH_TOOL','braand_connect_toolkit','COMPOSIO_MULTI_EXECUTE_TOOL'])await assert.rejects(()=>invoke(name,{}),e=>e.code==='work_connector_denied');
 await assert.rejects(()=>invoke('braand_connector_action',{...call(),mode:'instant'}),e=>e.code==='work_connector_denied');
 const pending=await invoke('braand_connector_action',call());assert.equal(pending.kind,'connector_action');assert.equal(countExecutions(),before);
 assert.equal(sql.prepare('SELECT work_id FROM agent_work_artifacts WHERE resource_id=?').get(pending.id).work_id,resource.id);
 assert.equal((await invoke('braand_connector_action',call())).id,pending.id);
 sql.prepare("UPDATE agent_work SET status='paused' WHERE id=?").run(resource.id);await assert.rejects(()=>c.decideConnectorAction(who,pending.id,'approve'),e=>e.code==='work_inactive');assert.equal(countExecutions(),before);
 sql.prepare("UPDATE agent_work SET status='running' WHERE id=?").run(resource.id);const completed=await c.decideConnectorAction(who,pending.id,'approve');assert.equal(completed.status,'completed');assert.equal(countExecutions(),before+1);
 assert.equal((await invoke('braand_connector_action',call())).id,pending.id);assert.equal(countExecutions(),before+1);
 const gated=await invoke('braand_connector_action',call('METAADS_CREATE_CAMPAIGN',{name:'Native pause fixture',status:'PAUSED'})),beforeEffects=effects.length;
 nativeChallenge={requests:{fixture:approvalQuestion},state:'fixture-request-state',onChallenge:()=>sql.prepare("UPDATE agent_work SET status='paused' WHERE id=?").run(resource.id)};
 try{const stopped=await c.decideConnectorAction(who,gated.id,'approve');assert.equal(stopped.status,'needs_input');assert.equal(effects.length,beforeEffects);}finally{nativeChallenge=null;}
 sql.prepare("UPDATE agent_work SET status='cancelled' WHERE id=?").run(resource.id);await assert.rejects(()=>invoke('braand_connector_status',{}),e=>e.code==='work_connector_denied');
});
// Uncertain usage remains traceable without blocking the wallet.
assert.equal((await b.summary(who.organization)).wallet.reserved,0);
assert.ok(sql.prepare("SELECT COUNT(*) n FROM credit_holds WHERE organization_id=? AND status!='settled'").get(who.organization).n>0);
globalThis.fetch=originalFetch;sql.close();
console.log(`${checks} Composio integration checks passed; ${failures.length} failed. SDK/provider responses were simulated. No real connection, payment or provider call.`);
if(failures.length)process.exitCode=1;
