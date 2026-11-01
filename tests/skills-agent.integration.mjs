// Real agent loops, registry, policy and SQLite persistence; model/provider I/O is isolated.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const project=path.resolve(import.meta.dirname,'..');
const runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,'node_modules');
const {build}=createRequire(path.join(runtime,'package.json'))('esbuild');
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync(path.join(project,'drizzle')).filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync(path.join(project,'drizzle',file),'utf8'));
function statement(query,args=[]){return {
 bind(...values){return statement(query,values);},
 async first(column){const row=sql.prepare(query).get(...args);return column?row?.[column]??null:row??null;},
 async all(){return {results:sql.prepare(query).all(...args)};},
 async run(){return this._run();},
 _run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};},
};}
const DB={prepare:query=>statement(query),async batch(statements){sql.exec('BEGIN');try{const results=statements.map(item=>item._run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const packManifest=JSON.parse(readFileSync(path.join(project,'skills/packs/manifest.json'),'utf8'));
const packedObjects=new Map(packManifest.objects.map(file=>['skills/packs/v1/'+file.sha256,file]));
let packedReads=0;
const BUCKET={async get(key){packedReads++;const file=packedObjects.get(key);assert.ok(file,'Object must be in the pinned pack');const bytes=readFileSync(path.join(project,file.path));return {size:bytes.length,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};}};
const fixture={env:{DB,BUCKET},headers:new Headers({'x-braand-identity-id':'skills-integration-owner','x-braand-identity-email':'skills@test.invalid'}),requests:[],responses:[],external:[],events:[],beforeTools:0};
globalThis.__skillsAgentTest=fixture;
const out=path.join(project,'.local-build','skills-agent-test.mjs');
mkdirSync(path.dirname(out),{recursive:true});
const entry=file=>JSON.stringify(path.join(project,file).replaceAll('\\','/'));
await build({
 stdin:{contents:`export * as agent from ${entry('lib/agent.ts')};export * as skillsRoute from ${entry('app/api/skills/route.ts')};export * as skillAssetRoute from ${entry('app/api/skills/[id]/asset/route.ts')};export * as server from ${entry('lib/server.ts')};export {SKILL_CATALOG} from ${entry('lib/skills/catalog.generated.mjs')};export {SKILL_POLICY} from ${entry('lib/skills/policy.mjs')};`,resolveDir:project,loader:'ts'},
 outfile:out,bundle:true,platform:'node',format:'esm',nodePaths:[runtime],
 plugins:[{name:'skills-agent-isolation',setup(builder){
  builder.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation)$/},args=>({path:args.path,namespace:'bindings'}));
  builder.onLoad({filter:/.*/,namespace:'bindings'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__skillsAgentTest.env;':args.path==='next/headers'?'export async function headers(){return globalThis.__skillsAgentTest.headers;}':'export function redirect(){throw Error("Unexpected redirect");}'}));
  builder.onResolve({filter:/^\.\/(metering|composio|browser|browser-agent|providers|platform-runtime)$/},args=>({path:args.path,namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{
   './platform-runtime':`export async function executePlatformTool(){throw Error('Platform calls are covered by agent-platform.integration.mjs');}export async function trackArtifact(){throw Error('Unexpected durable artifact in legacy agent test');}`,
  './metering':`export async function meteredMessage(budget,role,body,signal,routing){const fixture=globalThis.__skillsAgentTest;const request={budget,role,body:structuredClone(body),routing:structuredClone(routing)};fixture.requests.push(request);if(signal.aborted)throw Error('Aborted');const response=fixture.responses.shift();if(response===undefined)throw Error('Unexpected model request');return new Response(typeof response==='function'?response(request):response,{headers:{'content-type':'text/event-stream'}});}`,
   './composio':`export async function connectorAgentTools(){return [];}export async function executeConnectorAgentTool(){globalThis.__skillsAgentTest.external.push('connector');throw Error('Connector execution forbidden');}export async function executeMissionConnectorTool(){globalThis.__skillsAgentTest.external.push('mission_connector');throw Error('Mission connector execution forbidden in skill tests');}`,
   './providers':`export function falCatalog(){return [];}export function mediaRoute(){globalThis.__skillsAgentTest.external.push('media');throw Error('Media execution forbidden');}export async function metaGet(){globalThis.__skillsAgentTest.external.push('meta');throw Error('External account access forbidden');}`,
   './browser':`export const browserService={async create(){globalThis.__skillsAgentTest.external.push('browser');throw Error('Browser execution forbidden');}};`,
   './browser-agent':`export async function runBrowserAgentTurn(){globalThis.__skillsAgentTest.external.push('browser-agent');throw Error('Browser runner forbidden');}`,
  }[args.path]}));
 }}],
});
const {agent,server,skillsRoute,skillAssetRoute,SKILL_CATALOG,SKILL_POLICY}=await import(pathToFileURL(out).href);
const who=await server.identity(new Request('https://braand.test/api/chat'));
globalThis.fetch=async()=>{fixture.external.push('network');throw Error('Network forbidden in skills integration tests');};
const emit=async(type,data)=>{fixture.events.push({type,data});};
const signal=()=>new AbortController().signal;
function stream(blocks){return [
 {type:'message_start',message:{model:'fixture',usage:{}}},
 ...blocks.flatMap((block,index)=>block.type==='tool_use'?[{type:'content_block_start',index,content_block:{...block,input:{}}},{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}},{type:'content_block_stop',index}]:[{type:'content_block_start',index,content_block:{...block,text:''}},{type:'content_block_delta',index,delta:{type:'text_delta',text:block.text||''}},{type:'content_block_stop',index}]),
 {type:'message_stop'},
].map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join('');}
const text=value=>stream([{type:'text',text:value}]);
const tool=(id,name,input)=>({type:'tool_use',id,name,input});
const read=(id,skill='braand-pdf',extra={})=>tool(id,'read_skill',{id:skill,...extra});
function toolResult(request,id){
 const block=request.body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(block=>block.type==='tool_result'&&block.tool_use_id===id);
 assert.ok(block,`Missing result for ${id}`);
 return block;
}
const parsedResult=(request,id)=>JSON.parse(toolResult(request,id).content);
const mutationCount=()=>sql.prepare("SELECT COUNT(*) n FROM resources WHERE kind NOT IN ('conversation','subagent')").get().n;
const skillAudits=()=>sql.prepare("SELECT target,detail FROM audit WHERE workspace_id=? AND action='skill.read' ORDER BY rowid").all(who.tenant);
async function setup(){
 sql.prepare("UPDATE runs SET status='partial' WHERE status='streaming'").run();
 fixture.requests=[];fixture.responses=[];fixture.external=[];fixture.events=[];fixture.beforeTools=0;
 sql.prepare("DELETE FROM audit WHERE workspace_id=?").run(who.tenant);
 const conversation=await server.createResource(who.tenant,'conversation','Compétences locales',{},'saved');
 const runId=crypto.randomUUID(),now=Date.now();
 sql.prepare("INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,'streaming',?,?)").run(runId,who.tenant,conversation.id,now,now);
 sql.prepare("INSERT INTO messages(id,workspace_id,conversation_id,role,content,created_at) VALUES (?,?,?,'user',?,?)").run(crypto.randomUUID(),who.tenant,conversation.id,JSON.stringify([{type:'text',text:'Prépare un travail borné à partir de mes faits confirmés.'}]),now);
 const budget={who,runId,holdId:'skills-shared-'+runId,limit:12000,rate:{model:'fixture'},beforeTool:async()=>{fixture.beforeTools++;}};
 return {conversationId:conversation.id,runId,budget};
}
const run=(execution,mode='accompanied')=>agent.runAgent(who.tenant,execution.conversationId,execution.runId,emit,signal(),execution.budget,mode);
const specialist=(execution)=>agent.runSpecialist(who.tenant,execution.runId,{role:'extraction',task:'Structurer les faits selon une méthode documentaire',context:'Données privées fournies par cet espace'},emit,signal(),execution.budget);
function assertNoExternalOrMutation(before){assert.equal(mutationCount(),before);assert.deepEqual(fixture.external,[]);assert.equal(fixture.responses.length,0);}
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name);}

await check('master discovers metadata, explicitly reads a method and receives its real text on the next model turn',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([tool('discover','search_skills',{query:'rédaction vente'})]),stream([read('load-copy','copywriting')]),text('Voici les points à préciser pour préparer votre page.')];
 await run(execution);
 assert.equal(fixture.requests.length,3);
 const initial=fixture.requests[0],initialBody=JSON.stringify(initial.body);
 assert.deepEqual(initial.body.tools.filter(item=>['search_skills','read_skill'].includes(item.name)).map(item=>item.name),['search_skills','read_skill']);
 for(const method of SKILL_CATALOG){
  assert.ok(initial.body.system[0].text.includes(method.id+' ['+method.category+'] : '+method.title));
  const files=await method.load('SKILL.md',BUCKET);
  for(const content of Object.values(files))assert.ok(!initialBody.includes(JSON.stringify(content.slice(0,Math.min(240,content.length))).slice(1,-1)),`Initial prompt leaked method corpus: ${method.id}`);
 }
 const discovery=parsedResult(fixture.requests[1],'discover');
 assert.ok(discovery.skills.some(item=>item.id==='copywriting'));
 for(const item of discovery.skills){assert.equal('content' in item,false);assert.equal('provenance' in item,false);assert.equal('references' in item,false);}
 const loaded=parsedResult(fixture.requests[2],'load-copy');
 assert.equal(loaded.content,readFileSync(path.join(project,'skills/vendor/marketing/copywriting/SKILL.md'),'utf8'));
 assert.ok(loaded.content.includes('# Copywriting'));
 assert.ok(fixture.requests.every(request=>request.budget===execution.budget));
 assert.deepEqual(fixture.requests.map(request=>request.routing.task),['conversation','orchestration','orchestration']);
 const publicEvents=JSON.stringify(fixture.events);
 assert.ok(!publicEvents.includes('# Copywriting'));
 assert.ok(!publicEvents.includes('coreyhaines31'));
 assert.ok(!publicEvents.includes('provenance'));
 assert.ok(!publicEvents.includes('references/ai-tells.md'));
 const publicRead=fixture.events.find(event=>event.type==='tool_result'&&event.data.id==='load-copy').data.result;
 assert.deepEqual(Object.keys(publicRead).sort(),['chars','id','reference','status','title','truncated','version']);
 assert.equal(publicRead.status,'method_loaded');
 const audits=skillAudits();assert.equal(audits.length,1);
 const audit=JSON.parse(audits[0].detail),catalogEntry=SKILL_CATALOG.find(item=>item.id==='copywriting');
 assert.equal(audits[0].target,catalogEntry.id);assert.equal(audit.version,catalogEntry.version);assert.equal(audit.digest,catalogEntry.digest);
 assert.deepEqual(Object.keys(audit).sort(),['chars','digest','reference','truncated','version']);
 assert.ok(!JSON.stringify(audits).includes('# Copywriting'));assert.ok(!JSON.stringify(audits).includes('coreyhaines31'));
 assertNoExternalOrMutation(before);
});

await check('delegated extraction reads the method using the same hold and shared reading allowance, without writing tools',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([read('master-method'),tool('delegate','delegate_specialist',{role:'extraction',task:'Structurer les données fournies',context:'Données confirmées uniquement'})]),stream([read('specialist-method','braand-xlsx')]),text('Les champs manquants sont identifiés.'),text('La structure est prête à relire.')];
 await run(execution);
 const specialistRequests=fixture.requests.filter(request=>request.role==='specialist');assert.equal(specialistRequests.length,2);
 for(const request of specialistRequests){assert.deepEqual(request.body.tools.map(item=>item.name),['search_skills','read_skill']);assert.equal(request.budget,execution.budget);}
 const loaded=parsedResult(specialistRequests[1],'specialist-method');
 assert.ok(loaded.content.includes('name: braand-xlsx'));
 assert.equal(loaded.budget.remainingReads,SKILL_POLICY.maxReadCalls-2);
 const masterLoaded=parsedResult(fixture.requests.at(-1),'master-method');
 assert.equal(loaded.budget.remainingChars,masterLoaded.budget.remainingChars-loaded.chars);
 const delegation=parsedResult(fixture.requests.at(-1),'delegate');assert.equal(delegation.executionConfirmed,false);assert.equal(delegation.status,'report_ready');
 assert.ok(fixture.requests.every(request=>request.budget===execution.budget));
 assert.equal(skillAudits().length,2);assertNoExternalOrMutation(before);
});

await check('reading a method never grants a specialist media preparation or another mutation',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([read('specialist-read','braand-campaign-operations')]),stream([tool('forged-media','prepare_media',{title:'Interdit',rationale:'Une méthode ne donne aucun droit',task:'image',input:{},maxCredits:120})])];
 await assert.rejects(()=>specialist(execution),/Outil interdit au spécialiste/);
 assert.equal(fixture.requests.length,2);
 assert.ok(parsedResult(fixture.requests[1],'specialist-read').content.includes('name: braand-campaign-operations'));
 assert.ok(fixture.requests.every(request=>request.budget===execution.budget&&!request.body.tools.some(item=>item.name==='prepare_media')));
 assert.equal(skillAudits().length,1);assertNoExternalOrMutation(before);
});

await check('autonomous planning can read methods but cannot obtain or invoke prepare_media',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([read('autonomous-method','braand-media-pipeline')]),stream([tool('autonomous-media','prepare_media',{title:'Interdit',rationale:'Validation exacte requise',task:'image',input:{},maxCredits:120})]),text('La création attendra une proposition accompagnée et sa validation.')];
 await run(execution,'autonomous');
 for(const request of fixture.requests){assert.ok(request.body.tools.some(item=>item.name==='read_skill'));assert.ok(!request.body.tools.some(item=>['prepare_media','propose_media','delegate_specialist'].includes(item.name)));assert.equal(request.budget,execution.budget);}
 assert.ok(parsedResult(fixture.requests[1],'autonomous-method').content.includes('name: braand-media-pipeline'));
 const rejection=toolResult(fixture.requests[2],'autonomous-media');assert.equal(rejection.is_error,true);assert.match(rejection.content,/mode Autonome/);
 assert.equal(skillAudits().length,1);assertNoExternalOrMutation(before);
});

await check('invalid references are rejected before content, audit, mutation or provider access',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([
  read('escape','copywriting',{reference:'../LICENSE'}),
  read('remote','copywriting',{reference:'https://outside.invalid/method.md'}),
  read('unselected','copywriting',{reference:'references/ai-tells.md'}),
  read('unknown','not-a-reviewed-skill'),
 ]),text('Ces références ne sont pas disponibles.')];
 await run(execution);
 for(const id of ['escape','remote','unselected','unknown'])assert.equal(toolResult(fixture.requests[1],id).is_error,true);
 assert.equal(skillAudits().length,0);assertNoExternalOrMutation(before);
});

await check('master and delegated specialist exhaust one read-call allowance before any mutation or external access',async()=>{
 const execution=await setup(),before=mutationCount();
 const pdf=readFileSync(path.join(project,'skills/braand/documents/braand-pdf/SKILL.md'),'utf8');
 assert.ok(pdf.length*SKILL_POLICY.maxReadCalls<SKILL_POLICY.maxRunChars,'Fixture must exercise calls before character exhaustion');
 const masterReads=Array.from({length:SKILL_POLICY.maxReadCalls-1},(_,index)=>read('bounded-'+index));
 fixture.responses=[stream([...masterReads,tool('bounded-delegation','delegate_specialist',{role:'extraction',task:'Dernière lecture bornée',context:'Méthodes déjà consultées'})]),stream([read('last-allowed'),read('over-limit')]),text('Je termine avec la méthode disponible.'),text('La limite de lecture est atteinte.')];
 await run(execution);
 const continuation=fixture.requests.find(request=>request.role==='specialist'&&request.body.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.tool_use_id==='over-limit')));
 assert.ok(continuation);
 const last=parsedResult(continuation,'last-allowed');assert.equal(last.budget.remainingReads,0);
 const rejection=toolResult(continuation,'over-limit');assert.equal(rejection.is_error,true);assert.match(rejection.content,/budget de lecture/);
 assert.equal(skillAudits().length,SKILL_POLICY.maxReadCalls);
 assert.ok(fixture.requests.every(request=>request.budget===execution.budget));assertNoExternalOrMutation(before);
});

await check('aggregate character limit truncates the final excerpt and refuses another read without mutations or external access',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([
  read('creative-entry','ad-creative'),
  read('creative-reference','ad-creative',{reference:'references/static-ad-templates.md'}),
  read('copy-entry','copywriting'),
 ]),(request)=>{
  const remaining=parsedResult(request,'copy-entry').budget.remainingChars;
  const reference=readFileSync(path.join(project,'skills/vendor/marketing/copywriting/references/ai-tells.md'),'utf8');
  assert.ok(remaining>0&&remaining<reference.length);
  // Ending exactly at EOF avoids requiring a particular word-boundary algorithm.
  return stream([read('copy-reference','copywriting',{reference:'references/ai-tells.md',offset:reference.length-remaining})]);
 },stream([read('character-overflow')]),text('Les extraits disponibles suffisent à cette étape.')];
 await run(execution);
 const request=fixture.requests.at(-1);
 const loaded=['creative-entry','creative-reference','copy-entry','copy-reference'].map(id=>parsedResult(request,id));
 assert.equal(loaded.reduce((sum,item)=>sum+item.chars,0),SKILL_POLICY.maxRunChars);
 assert.equal(loaded.at(-1).budget.remainingChars,0);assert.equal(loaded.at(-1).truncated,true);
 const rejection=toolResult(request,'character-overflow');assert.equal(rejection.is_error,true);assert.match(rejection.content,/budget de lecture/);
 assert.equal(skillAudits().length,4);assertNoExternalOrMutation(before);
});

await check('settings metadata requires identity and workspace access and never exposes method content',async()=>{
 const headers=fixture.headers;
 try{
  const response=await skillsRoute.GET(new Request('https://braand.test/api/skills'));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  const dto=await response.json();assert.equal(dto.skills.length,166);
  assert.ok(dto.skills.some(item=>item.id==='braand-meeting-actions'));
  assert.ok(dto.skills.every(item=>Object.keys(item).sort().join(',')==='capability,category,description,id,title,version'));
  const foreign=await skillsRoute.GET(new Request('https://braand.test/api/skills',{headers:{'x-braand-workspace':'another-client'}}));assert.equal(foreign.status,403);
  const packed=packManifest.entries.find(entry=>!entry.augment),reference='SKILL.md';
  const asset=await skillAssetRoute.GET(new Request('https://braand.test/api/skills/'+packed.id+'/asset?reference='+encodeURIComponent(reference)),{params:Promise.resolve({id:packed.id})});assert.equal(asset.status,200);assert.match(asset.headers.get('content-disposition'),/^attachment;/);
  const readsBeforeForeign=packedReads;
  const denied=await skillAssetRoute.GET(new Request('https://braand.test/api/skills/'+packed.id+'/asset?reference=SKILL.md',{headers:{'x-braand-workspace':'another-client'}}),{params:Promise.resolve({id:packed.id})});assert.equal(denied.status,403);assert.equal(packedReads,readsBeforeForeign);
  fixture.headers=new Headers();
  const anonymousAsset=await skillAssetRoute.GET(new Request('https://braand.test/api/skills/'+packed.id+'/asset?reference=SKILL.md'),{params:Promise.resolve({id:packed.id})});assert.equal(anonymousAsset.status,401);assert.equal(packedReads,readsBeforeForeign);
  const anonymous=await skillsRoute.GET(new Request('https://braand.test/api/skills'));assert.equal(anonymous.status,401);assert.equal(anonymous.headers.get('cache-control'),'private, no-store');
 }finally{fixture.headers=headers;}
});

await check('a simple response does not require method discovery, delegation or extra model calls',async()=>{
 const execution=await setup(),before=mutationCount();fixture.responses=[text('Bonjour ! Comment puis-je vous aider ?')];
 await run(execution);assert.equal(fixture.requests.length,1);assert.equal(skillAudits().length,0);assertNoExternalOrMutation(before);
});

await check('an adapted meeting method produces a real private artifact with an independent structural check',async()=>{
 const execution=await setup();
 fixture.responses=[stream([read('meeting-method','braand-meeting-actions')]),stream([tool('meeting-save','save_deliverable',{title:'Compte rendu — test isolé',content:'# Décisions\nOffre validée selon les notes fournies.\n\n## Actions\nResponsable et échéance à confirmer.',summary:'Compte rendu fondé sur les notes de test.',category:'management',sources:['Notes fournies dans la conversation de test']})]),request=>{
  const saved=parsedResult(request,'meeting-save');assert.equal(saved.kind,'deliverable');assert.equal(saved.status,'draft');assert.equal(saved.data.executionConfirmed,false);
  return stream([tool('meeting-verify','verify_deliverable',{id:saved.id,version:saved.version,criteria:['Compte rendu conservé avec référence aux notes'],requiredSources:true,requiredResourceIds:[]})]);
 },text('Le compte rendu est enregistré. Les responsables et échéances restent à confirmer.')];
 await run(execution);
 const verified=parsedResult(fixture.requests.at(-1),'meeting-verify');assert.equal(verified.status,'structurally_verified');assert.equal(verified.executionConfirmed,false);assert.equal(verified.semanticReview,'required');
 const row=sql.prepare('SELECT kind,workspace_id,data FROM resources WHERE id=?').get(verified.resourceId);
 assert.equal(row.kind,'deliverable');assert.equal(row.workspace_id,who.tenant);assert.match(JSON.parse(row.data).content,/à confirmer/);
 assert.ok(sql.prepare('SELECT COUNT(*) n FROM agent_verifications WHERE resource_id=?').get(verified.resourceId).n>=1);
 assert.equal(skillAudits().length,1);assert.deepEqual(fixture.external,[]);assert.equal(fixture.responses.length,0);
});


await check('video skill is available to the real harness with progressive guides and no new execution authority',async()=>{
 const execution=await setup(),before=mutationCount();
 fixture.responses=[stream([tool('video-discovery','search_skills',{semanticIds:['video-motion-studio'],category:'creative'})]),stream([read('video-entry','video-motion-studio')]),stream([read('motion-guide','video-motion-studio',{reference:'references/motion-design.md'})]),text('Je prépare une direction visuelle adaptée à votre produit et aux moyens disponibles.')];
 await run(execution);
 assert.equal(parsedResult(fixture.requests[1],'video-discovery').skills[0].id,'video-motion-studio');
 const entry=parsedResult(fixture.requests[2],'video-entry');assert.equal(entry.capability,'media_proposal');assert.equal(entry.provenance.license,'User-provided');
 assert.ok(parsedResult(fixture.requests[3],'motion-guide').content.includes('easing'));
 assert.ok(fixture.requests.every(request=>!request.body.tools.some(tool=>['shell','run_python','build_timeline.py','prepare_video_edit'].includes(tool.name))));
 assertNoExternalOrMutation(before);
});

await check('an imported method and its original text run through the real tool loop with private storage and unchanged permissions',async()=>{
 const execution=await setup(),before=mutationCount(),readsBefore=packedReads;
 const entry=packManifest.entries.find(entry=>entry.id==='reels-viraux-motion-design'),reference=entry.variants[0].entry;
 fixture.responses=[stream([read('pack-entry',entry.id)]),stream([read('pack-source',entry.id,{reference})]),text('Voici une proposition fondée sur la méthode importée, à adapter aux ressources disponibles.')];
 await run(execution);
 assert.equal(packedReads,readsBefore+2);assert.match(parsedResult(fixture.requests[1],'pack-entry').content,/Braand/);assert.ok(parsedResult(fixture.requests[2],'pack-source').content.length>100);assert.equal(skillAudits().length,2);
 assert.ok(fixture.requests.every(request=>!request.body.tools.some(tool=>['shell','exec_command','image_gen__imagegen','skills__read'].includes(tool.name))));
 assertNoExternalOrMutation(before);
});

console.log(count+' skills agent integration checks passed; no external model, provider or mutation calls.');
sql.close();
