// Real orchestrator, tool policy and SQLite persistence. No provider or external action.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const project=path.resolve(import.meta.dirname,'..'),runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,'node_modules'),{build}=createRequire(path.join(runtime,'package.json'))('esbuild');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(path.join(project,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(path.join(project,'drizzle',file),'utf8'));
function statement(query,args=[]){return {bind(...v){return statement(query,v);},async first(column){const row=sql.prepare(query).get(...args);return column?row?.[column]??null:row??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return this._run();},_run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};}};}
const DB={prepare:q=>statement(q),async batch(ss){sql.exec('BEGIN');try{const r=ss.map(s=>s._run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const blobs=new Map();const BUCKET={async put(key,data){blobs.set(key,new Uint8Array(data));},async delete(key){blobs.delete(key);},async get(key){const bytes=blobs.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer}:null;}};
const fixture={env:{DB,BUCKET},headers:new Headers({'x-braand-identity-id':'internal-agent-owner','x-braand-identity-email':'owner@test.invalid'}),requests:[],responses:[],external:[],events:[],beforeTools:0};globalThis.__internalAgentTest=fixture;
const out=path.join(project,'.local-build','internal-agent-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:`export * as agent from ${JSON.stringify(path.join(project,'lib/agent.ts').replaceAll('\\','/'))};export * as server from ${JSON.stringify(path.join(project,'lib/server.ts').replaceAll('\\','/'))};`,resolveDir:project,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',nodePaths:[runtime],plugins:[{name:'agent-routing-isolation',setup(b){
 b.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation)$/},a=>({path:a.path,namespace:'bindings'}));
 b.onLoad({filter:/.*/,namespace:'bindings'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__internalAgentTest.env;':a.path==='next/headers'?'export async function headers(){return globalThis.__internalAgentTest.headers;}':'export function redirect(){throw Error("Unexpected redirect");}'}));
 b.onResolve({filter:/^\.\/(metering|composio|browser|browser-agent|providers|platform-runtime)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:project,contents:{
  './platform-runtime':`import {analyzeData,getAnalysisResult} from ${JSON.stringify(path.join(project,"lib/data-analysis.ts").replaceAll("\\","/"))};import {saveSourceProject,getSourceProject} from ${JSON.stringify(path.join(project,"lib/source-projects.ts").replaceAll("\\","/"))};export async function executePlatformTool(name,input,scope,budget){const ready=!!globalThis.__internalAgentTest.env.BUCKET;if(name==='capabilities')return {canWrite:true,analysis:{ready},software:{ready,executionReady:false}};if(name==='analyze_data')return analyzeData(budget.who,input);if(name==='get_analysis_result')return getAnalysisResult(budget.who,input);if(name==='save_source_project')return saveSourceProject(budget.who,input);if(name==='get_source_project')return getSourceProject(budget.who,input);throw Error('Unexpected platform tool');}export async function trackArtifact(){throw Error('Unexpected durable artifact in isolated agent test');}`,
  './metering':`export async function meteredMessage(budget,role,body,signal,routing){const f=globalThis.__internalAgentTest;f.requests.push({budget,role,body:structuredClone(body),routing:structuredClone(routing)});if(signal.aborted)throw Error('Aborted');const response=f.responses.shift();if(response===undefined)throw Error('Unexpected model request');return new Response(typeof response==='function'?response():response,{headers:{'content-type':'text/event-stream'}});}`,
  './composio':`export async function connectorAgentTools(){return globalThis.__internalAgentTest.connectorAvailable?[{name:'braand_connector_status',description:'Fixture read-only connection diagnosis',input_schema:{type:'object',properties:{},additionalProperties:false}}]:[];}export async function executeMissionConnectorTool(){throw Error('Mission connector calls are covered by connector integration tests');}export async function executeConnectorAgentTool(){globalThis.__internalAgentTest.external.push('connector');throw Error('External connectors forbidden in routing tests');}`,
  './providers':`export function falCatalog(){return [];}export function mediaRoute(){throw Error('Media generation forbidden in routing tests');}export async function metaGet(){globalThis.__internalAgentTest.external.push('meta_read');return {data:[]};}`,
  './browser':`export const browserService={async create(){globalThis.__internalAgentTest.external.push('browser');throw Error('Browser forbidden in routing tests');}};`,
  './browser-agent':`export async function runBrowserAgentTurn(){throw Error('Unexpected browser runner');}`,
 }[a.path]}));
}}]});
const {agent,server}=await import(pathToFileURL(out).href),who=await server.identity(new Request('https://braand.test/api/chat'));
globalThis.fetch=async()=>{throw Error('Network forbidden in orchestrator routing tests');};
const emit=async(type,data)=>{fixture.events.push({type,data});},signal=()=>new AbortController().signal;
function stream(blocks){return [{type:'message_start',message:{model:'fixture',usage:{}}},...blocks.flatMap((block,index)=>block.type==='tool_use'?[{type:'content_block_start',index,content_block:{...block,input:{}}},{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}},{type:'content_block_stop',index}]:[{type:'content_block_start',index,content_block:{...block,text:''}},{type:'content_block_delta',index,delta:{type:'text_delta',text:block.text||''}},{type:'content_block_stop',index}]),{type:'message_stop'}].map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join('');}
const text=value=>stream([{type:'text',text:value}]);
async function setup(){sql.prepare("UPDATE runs SET status='partial' WHERE status='streaming'").run();fixture.requests=[];fixture.responses=[];fixture.external=[];fixture.events=[];fixture.beforeTools=0;fixture.connectorAvailable=false;const conversation=await server.createResource(who.tenant,'conversation','Chat local',{},'saved'),runId=crypto.randomUUID(),now=Date.now();sql.prepare("INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,'streaming',?,?)").run(runId,who.tenant,conversation.id,now,now);sql.prepare("INSERT INTO messages(id,workspace_id,conversation_id,role,content,created_at) VALUES (?,?,?,'user',?,?)").run(crypto.randomUUID(),who.tenant,conversation.id,JSON.stringify([{type:'text',text:'Contexte privé de cet espace'}]),now);const budget={who,runId,holdId:'shared-'+runId,limit:5000,rate:{model:'fixture'},beforeTool:async()=>{fixture.beforeTools++;}};return {conversationId:conversation.id,runId,budget};}
const run=execution=>agent.runAgent(who.tenant,execution.conversationId,execution.runId,emit,signal(),execution.budget);
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const tool=(id,name,input)=>({type:'tool_use',id,name,input});
await check('a simple general conversation stays one model call with no artificial workflow',async()=>{
 const execution=await setup(),before=blobs.size;fixture.responses=[text('Voici une explication courte.')];await run(execution);assert.equal(fixture.requests.length,1);assert.equal(fixture.beforeTools,0);assert.equal(blobs.size,before);assert.deepEqual(fixture.external,[]);
});
await check('the principal discovers analysis progressively and executes the actual deterministic service',async()=>{
 const execution=await setup();fixture.responses=[stream([tool('discover','capabilities',{area:'analysis'})]),stream([tool('compute','analyze_data',{title:'أرقام مقدمة',dataset:{format:'inline',columns:['قيمة'],rows:[['0.1'],['0.2']]},steps:[{op:'group',by:[],aggregates:[{op:'sum',column:'قيمة',as:'total'}]}]})]),text('المجموع هو 0.3 وفق البيانات المقدمة.')];await run(execution);
 assert.equal(fixture.requests.length,3);assert.equal(fixture.requests[0].body.tools.some(t=>t.name==='analyze_data'),false);assert.equal(fixture.requests[1].body.tools.some(t=>t.name==='analyze_data'),true);assert.equal(fixture.requests[1].body.tools.some(t=>t.name==='save_source_project'),false);
 const result=fixture.events.find(e=>e.type==='tool_result'&&e.data.name==='analyze_data').data.result;assert.equal(result.execution,'computed');assert.deepEqual(result.preview,[['0.3']]);assert.equal(sql.prepare('SELECT status FROM files WHERE id=?').get(result.file.id).status,'ready');assert.deepEqual(fixture.external,[]);
});
await check('duplicate source mutations reuse their receipt and do not duplicate a file or pretend to test code',async()=>{
 const execution=await setup(),before=blobs.size,input={title:'Code récupérable',summary:'Sources préparées',files:[{path:'index.js',content:'export const answer=42;'}]};
 fixture.responses=[stream([tool('discover','capabilities',{area:'software'})]),stream([tool('write-one','save_source_project',input),tool('write-again','save_source_project',input)]),text('Les sources sont prêtes ; leur exécution reste à vérifier.')];await run(execution);
 assert.equal(blobs.size,before+1);assert.equal(sql.prepare("SELECT COUNT(*) n FROM resources WHERE title='Code récupérable' AND kind='deliverable'").get().n,1);
 const first=fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='write-one').data.result;assert.equal(first.tests,'not_run');assert.equal(first.deployment,'not_deployed');assert.equal(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='write-again').data.result.reused,true);assert.deepEqual(fixture.external,[]);
});
await check('planning cannot acquire computation or file-writing rights through capabilities',async()=>{
 const execution=await setup(),before=blobs.size;fixture.responses=[stream([tool('discover','capabilities',{area:'analysis'})]),stream([tool('denied','analyze_data',{title:'No mutation',dataset:{format:'inline',columns:['x'],rows:[[1]]},steps:[]})]),text('La préparation reste sans exécution.')];
 await agent.runAgent(who.tenant,execution.conversationId,execution.runId,emit,signal(),execution.budget,'autonomous');assert.equal(fixture.requests[1].body.tools.some(t=>t.name==='analyze_data'),false);assert.equal(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='denied').data.error!==undefined,true);assert.equal(blobs.size,before);assert.equal(sql.prepare("SELECT COUNT(*) n FROM resources WHERE title='No mutation'").get().n,0);assert.deepEqual(fixture.external,[]);
});
await check('the real principal receives the new policy and runtime and can read guides and time',async()=>{
 const execution=await setup();fixture.responses=[stream([tool('context-discover','capabilities',{area:'context'})]),stream([tool('clock','get_current_time',{timezone:'Europe/Paris'}),tool('guide','read_agent_guide',{topic:'tool-map'})]),text('Voici les capacités et l’heure vérifiées.')];await run(execution);
 const initial=fixture.requests[0].body;assert.match(initial.system[0].text,/IDENTITÉ ET RELATION/);assert.ok(initial.system.some(block=>block.text.includes('braand-personal-agent-v2')));
 assert.equal(initial.tools.some(t=>t.name==='read_agent_context'),false);assert.equal(fixture.requests[1].body.tools.some(t=>t.name==='read_agent_context'),true);assert.equal(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='clock').data.result.timezone,'Europe/Paris');assert.match(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='guide').data.result.content,/Correspondance/);assert.deepEqual(fixture.external,[]);
});
await check('profile updates have durable receipts and appear in the next real conversation',async()=>{
 const execution=await setup(),input={version:0,profile:{displayName:'Recette privée',timezone:'Africa/Abidjan'}};
 fixture.responses=[stream([tool('profile-discover','capabilities',{area:'context'})]),stream([tool('profile-one','update_agent_context',input),tool('profile-duplicate','update_agent_context',input)]),text('Vos préférences sont enregistrées.')];await run(execution);
 assert.equal(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='profile-one').data.result.version,1);assert.equal(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='profile-duplicate').data.result.reused,true);
 const next=await setup();fixture.responses=[text('Bonjour.')];await run(next);assert.ok(fixture.requests[0].body.system.some(block=>block.text.includes('Recette privée')&&block.text.includes('Africa/Abidjan')));
});
await check('a planning conversation cannot mutate the assistant profile',async()=>{
 const execution=await setup();fixture.responses=[stream([tool('profile-forbidden','update_agent_context',{version:1,profile:{displayName:'Unexpected'}})]),text('Le profil reste inchangé.')];
 await agent.runAgent(who.tenant,execution.conversationId,execution.runId,emit,signal(),execution.budget,'autonomous');assert.equal(fixture.requests[0].body.tools.some(t=>t.name==='update_agent_context'),false);assert.ok(fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='profile-forbidden').data.error);assert.equal((await agent.executeTool(who.tenant,'read_agent_context',{})).profile.displayName,'Recette privée');
});
await check('a real user correction becomes sourced learning and is reused on the next principal turn',async()=>{
 const execution=await setup(),quote='Dans mes rapports, sépare les faits des hypothèses.';
 sql.prepare("UPDATE messages SET content=? WHERE conversation_id=? AND role='user'").run(JSON.stringify([{type:'text',text:quote}]),execution.conversationId);
 fixture.responses=[stream([tool('learning-discover','capabilities',{area:'context'})]),stream([tool('learn','record_learning',{quote,kind:'preference'})]),text('Cette préférence est enregistrée.')];await run(execution);
 const receipt=fixture.events.find(e=>e.type==='tool_result'&&e.data.id==='learn').data.result;assert.equal(receipt.data.content,quote);assert.equal(receipt.data.learning.evidence,'exact_user_quote');
 const next=await setup();fixture.responses=[text('Je distingue les éléments vérifiés des hypothèses.')];await run(next);assert.ok(fixture.requests[0].body.system.some(block=>block.text.startsWith('Mémoire de cet espace')&&block.text.includes(quote)));assert.deepEqual(fixture.external,[]);
});
console.log(`${count} native engine orchestrator checks passed. Real services/SQLite, simulated model and capability readiness, no provider calls.`);
sql.close();delete globalThis.__internalAgentTest;
