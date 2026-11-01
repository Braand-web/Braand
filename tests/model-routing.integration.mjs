// Real routing, transport and ledger; local SQLite and HTTP provider fixtures.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const project=path.resolve(import.meta.dirname,'..'),runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,'node_modules');
const {build}=createRequire(path.join(runtime,'package.json'))('esbuild'),sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync(path.join(project,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(path.join(project,'drizzle',file),'utf8'));
function statement(query,args=[]){return {bind(...v){return statement(query,v);},async first(column){const r=sql.prepare(query).get(...args);return column?r?.[column]??null:r??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return this._run();},_run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}
const DB={prepare:q=>statement(q),async batch(ss){sql.exec('BEGIN');try{const r=ss.map(s=>s._run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__modelRoutingTest={env:{DB},headers:new Headers({'x-braand-identity-id':'routing-owner','x-braand-identity-email':'owner@test.invalid'})};
const out=path.join(project,'.local-build','model-routing-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:['model-router','model-client','metering','server','billing'].map((n,i)=>`export * as m${i} from ${JSON.stringify(path.join(project,'lib',n+'.ts').replaceAll('\\','/'))};`).join('\n'),resolveDir:project,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',nodePaths:[runtime],plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation)$/},a=>({path:a.path,namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__modelRoutingTest.env;':a.path==='next/headers'?'export async function headers(){return globalThis.__modelRoutingTest.headers;}':'export function redirect(){throw new Error("unexpected redirect");}'}));}}]});
const {m0:router,m1:client,m2:meter,m3:server}=await import(pathToFileURL(out).href),env=globalThis.__modelRoutingTest.env;
const who=await server.identity(new Request('https://braand.test/api/chat')),now=Date.now();
sql.prepare('INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run('routing-credits',who.organization,'topup','fixture',1000000,1000000,now,now);
const secret='FIXTURE-NEVER-A-REAL-KEY';env.MODEL_ROUTING_ENABLED='true';env.OPENAI_API_KEY=secret;env.ANTHROPIC_API_KEY=secret;
function catalog(){return Object.fromEntries(Object.entries(router.REASONING_MODELS).map(([key,model],index)=>[key,{enabled:true,maxInputTokens:100000,maxOutputTokens:8192,rate:{...model,input:index+1,output:(index+1)*5,cacheWrite:(index+1)*1.25,cacheRead:(index+1)*.1,usdXaf:600,overheadXaf:0,verifiedAt:new Date().toISOString()}}]));}
env.MODEL_ROUTING_CATALOG_JSON=JSON.stringify(catalog());
const body={max_tokens:512,stream:true,system:'Be Braand.',messages:[{role:'user',content:'Bonjour'}],tools:[{name:'read_fixture',description:'Read only fixture',input_schema:{type:'object',properties:{},required:[]}}]};
const calls=[];let mode='success',abortObserved=false;
const encode=events=>events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
function openaiEvents(model,withTool=false){return [
 {type:'response.created',response:{id:'resp-fixture',model}},
 {type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:''}},
 {type:'response.output_text.delta',output_index:0,content_index:0,delta:'Bonjour 👋'},
 {type:'response.content_part.done',output_index:0,content_index:0,part:{type:'output_text',text:'Bonjour 👋'}},
 ...(withTool?[
  {type:'response.output_item.added',output_index:1,item:{type:'function_call',call_id:'call-fixture',name:'read_fixture',arguments:''}},
  {type:'response.function_call_arguments.delta',output_index:1,delta:'{}'},
  {type:'response.output_item.done',output_index:1,item:{type:'function_call',call_id:'call-fixture',name:'read_fixture',arguments:'{}'}},
  {type:'response.output_item.done',output_index:2,item:{id:'reasoning-fixture',type:'reasoning',summary:[],encrypted_content:'OPAQUE-FIXTURE'}},
 ]:[]),
 {type:'response.completed',response:{id:'resp-fixture',model,status:'completed',service_tier:'default',usage:{input_tokens:100,output_tokens:40,input_tokens_details:{cached_tokens:20,cache_write_tokens:10},output_tokens_details:{reasoning_tokens:30}}}},
 ];}
globalThis.fetch=async(url,init={})=>{const u=new URL(url),request=JSON.parse(init.body||'{}');calls.push({url:u.href,request,signal:init.signal});
 assert.ok(['api.openai.com','api.anthropic.com'].includes(u.hostname));assert.equal(String(init.body).includes(secret),false);
 if(u.pathname.endsWith('count_tokens'))return Response.json({input_tokens:100});
 if(mode==='network')throw new Error('fixture interruption');
 if(mode==='refusal')return Response.json({error:{message:'fixture refusal'}},{status:401});
 if(u.hostname==='api.openai.com'){
  assert.equal(u.pathname,'/v1/responses');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);assert.equal(request.service_tier,'default');assert.equal(request.store,false);assert.ok(request.max_output_tokens<=8192);
  const events=openaiEvents(request.model,mode==='tools');if(mode==='wrong_model')events.at(-1).response.model='foreign-model';if(mode==='incomplete')events.pop();
  if(mode==='hanging')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(encode(events.slice(0,1))));init.signal.addEventListener('abort',()=>{abortObserved=true;controller.error(new Error('aborted fixture'));},{once:true});}}),{headers:{'content-type':'text/event-stream','x-request-id':'req-fixture'}});
  const bytes=new TextEncoder().encode(encode(events));let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+13));offset+=13;}}),{headers:{'content-type':'text/event-stream','x-request-id':'req-fixture'}});
 }
 assert.equal(new Headers(init.headers).get('x-api-key'),secret);
 return new Response(encode([{type:'message_start',message:{model:request.model,content:[],usage:{input_tokens:100,cache_creation_input_tokens:10,cache_read_input_tokens:20}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Analyse'}},{type:'content_block_stop',index:0},{type:'message_delta',usage:{output_tokens:40}},{type:'message_stop'}]),{headers:{'content-type':'text/event-stream','request-id':'req-anthropic-fixture'}});
};
async function budget(credits=500){sql.prepare("UPDATE runs SET status='partial' WHERE status='streaming'").run();const id=crypto.randomUUID(),time=Date.now();sql.prepare("INSERT INTO resources(id,workspace_id,kind,title,created_at,updated_at) VALUES (?,?,'conversation','Fixture',?,?)").run(id,who.tenant,time,time);sql.prepare('INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,who.tenant,id,'streaming',time,time);return meter.startRunBudget(who,id,credits);}
const rows=b=>sql.prepare('SELECT * FROM provider_usage WHERE hold_id=? ORDER BY rowid').all(b.holdId);
const check=async(name,fn)=>{await fn();console.log('PASS '+name);};
await check('server-owned task routing selects all requested exact models and rejects invented routing inputs',async()=>{
 const expected={conversation:'sol',orchestration:'sol',extraction:'haiku',creative:'sonnet',campaigns:'sonnet',analysis:'astra',review:'opus',browser:'sonnet',video_motion:'opus'};
 for(const [task,key] of Object.entries(expected))assert.equal(router.routedModel(env,{task}).key,key);
 assert.equal(router.routedModel(env,{task:'conversation',escalation:{reason:'validation_failed',attempt:1}}).key,'astra');
 for(const input of [{task:'user asks Opus'},{task:'conversation',model:'claude-opus-5-5'},{task:'conversation',escalation:{reason:'slow',attempt:1}},{task:'conversation',escalation:{reason:'validation_failed',attempt:2}},{task:'analysis',escalation:{reason:'validation_failed',attempt:1}}])assert.throws(()=>router.routedModel(env,input));
});
await check('video motion uses the configured Opus 5.5 with its own verified rate without changing generic creative tasks',async()=>{
 assert.equal(router.routedModel(env,{task:'video_motion',tier:'light'}).key,'opus');assert.equal(router.routedModel(env,{task:'creative'}).key,'sonnet');
 const saved=env.MODEL_ROUTING_CATALOG_JSON;try{const changed=catalog();delete changed.opus;env.MODEL_ROUTING_CATALOG_JSON=JSON.stringify(changed);assert.throws(()=>router.routedModel(env,{task:'video_motion'}));}finally{env.MODEL_ROUTING_CATALOG_JSON=saved;}
});
await check('unverified per-model rates, long-context price assumptions and absent keys fail closed',async()=>{
 for(const patch of [{enabled:false},{maxInputTokens:100001},{rate:{...catalog().sol.rate,model:'foreign'}},{rate:{...catalog().sol.rate,provider:'anthropic'}},{rate:{...catalog().sol.rate,verifiedAt:'invalid'}},{rate:{...catalog().sol.rate,verifiedAt:new Date(Date.now()-90000000).toISOString()}}]){env.MODEL_ROUTING_CATALOG_JSON=JSON.stringify({...catalog(),sol:{...catalog().sol,...patch}});assert.throws(()=>router.routedModel(env));}
 env.MODEL_ROUTING_CATALOG_JSON=JSON.stringify(catalog());delete env.OPENAI_API_KEY;assert.equal(meter.modelReadiness().ready,false);env.OPENAI_API_KEY=secret;
});
await check('private images and tool turns map to Responses without truncating connector skill results',async()=>{
 const model=router.routedModel(env),skill='read-only skill\n'+'source '.repeat(5000),request=client.responsesBody({...body,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'ZmFrZQ=='}}]},{role:'assistant',content:[{type:'tool_use',id:'call-fixture',name:'read_fixture',input:{}},{type:'provider_state',provider:'openai',model:model.model,item:{type:'reasoning',encrypted_content:'OPAQUE'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call-fixture',content:skill}]}]},model);
 assert.equal(request.input[0].content[0].type,'input_image');assert.equal(request.input[1].type,'function_call');assert.equal(request.input[2].encrypted_content,'OPAQUE');assert.equal(request.input[3].output,skill);assert.equal(request.tools[0].type,'function');
 assert.throws(()=>client.responsesBody({...body,messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'http://127.0.0.1/private'}}]}]},model));
});
await check('streaming Responses preserves Unicode, tool arguments and encrypted continuity while accounting cache and reasoning once',async()=>{
 mode='tools';const b=await budget(),response=await meter.meteredMessage(b,'master',body,new AbortController().signal),text=await response.text();const usage=rows(b)[0];assert.equal(usage.provider,'openai');assert.equal(usage.request_id,'req-fixture');assert.equal(usage.status,'complete');assert.ok(text.includes('Bonjour 👋'));assert.ok(text.includes('call-fixture'));assert.ok(text.includes('OPAQUE-FIXTURE'));const parsed=JSON.parse(usage.usage);assert.equal(parsed.input_tokens,70);assert.equal(parsed.output_tokens,40);assert.equal(parsed.cache_creation_input_tokens,10);assert.equal(parsed.cache_read_input_tokens,20);assert.equal(usage.cost_xaf,(70+40*5+10*1.25+20*.1)/1e6*600);assert.equal(text.includes(secret),false);
});
await check('several model rates settle against one hold using every recorded exact rate',async()=>{
 mode='success';const b=await budget();for(const task of ['conversation','creative','review'])await (await meter.meteredMessage(b,task,body,new AbortController().signal,{task})).text();const all=rows(b);assert.deepEqual(all.map(r=>JSON.parse(r.rate).model),['gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5']);sql.prepare("UPDATE runs SET status='completed' WHERE id=?").run(b.runId);await meter.finishRunBudget(b);const hold=sql.prepare('SELECT * FROM credit_holds WHERE id=?').get(b.holdId);assert.equal(hold.actual,all.reduce((n,r)=>n+Math.ceil(r.cost_xaf/4*100),0));
});
await check('metered OpenAI tool continuation preserves encrypted reasoning and complete tool results through the full request pipeline',async()=>{
 mode='success';const b=await budget(),longSkill='COMPOSIO SKILL '+ 'verified step '.repeat(1000),continuation={...body,messages:[{role:'user',content:'Analyse le compte.'},{role:'assistant',content:[{type:'provider_state',provider:'openai',model:'gpt-6.1-sol',item:{id:'reasoning-previous',type:'reasoning',summary:[],encrypted_content:'OPAQUE-KEEP-IN-METERED-PIPELINE'}},{type:'tool_use',id:'call-previous',name:'read_fixture',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call-previous',content:longSkill}]}]};
 await (await meter.meteredMessage(b,'master',continuation,new AbortController().signal,{task:'orchestration'})).text();const request=calls.at(-1).request;assert.equal(request.input.find(item=>item.type==='reasoning').encrypted_content,'OPAQUE-KEEP-IN-METERED-PIPELINE');assert.equal(request.input.find(item=>item.type==='function_call_output').output,longSkill);assert.equal(rows(b)[0].status,'complete');
});
await check('unknown stream or wrong model retains reservation and blocks subsequent calls without retry',async()=>{
 for(const next of ['incomplete','wrong_model','network']){mode=next;const b=await budget(),before=calls.length;try{await (await meter.meteredMessage(b,'master',body,new AbortController().signal)).text();}catch{}assert.equal(rows(b)[0].status,'unknown');assert.equal(calls.length,before+1);await assert.rejects(()=>meter.meteredMessage(b,'master',body,new AbortController().signal),/rapprocher/);assert.equal(calls.length,before+1);sql.prepare("UPDATE runs SET status='failed' WHERE id=?").run(b.runId);await meter.finishRunBudget(b);assert.equal(sql.prepare('SELECT status FROM credit_holds WHERE id=?').get(b.holdId).status,'needs_reconciliation');}
});
await check('cancelling streamed output aborts the upstream request and retains unknown consumption',async()=>{
 mode='hanging';const b=await budget(),response=await meter.meteredMessage(b,'master',body,new AbortController().signal),reader=response.body.getReader();await reader.read();await reader.cancel();assert.equal(abortObserved,true);assert.equal(rows(b)[0].status,'unknown');
});
await check('HTTP rejection makes no successful charge and the shared budget is never silently increased',async()=>{
 mode='refusal';const b=await budget();const response=await meter.meteredMessage(b,'master',body,new AbortController().signal);assert.equal(response.status,401);assert.equal(rows(b)[0].status,'rejected');mode='success';const small=await budget(.01),before=calls.length;await assert.rejects(()=>meter.meteredMessage(small,'master',body,new AbortController().signal),e=>e.code==='budget_exhausted');assert.equal(calls.length,before);
});
await check('simultaneous model calls cannot race the same reserved credits',async()=>{
 mode='success';const b=await budget(),before=calls.length,results=await Promise.allSettled([meter.meteredMessage(b,'first',body,new AbortController().signal),meter.meteredMessage(b,'second',body,new AbortController().signal)]),accepted=results.filter(result=>result.status==='fulfilled'),rejected=results.filter(result=>result.status==='rejected');assert.equal(accepted.length,1);assert.equal(rejected.length,1);assert.equal(rejected[0].reason.code,'model_budget_busy');assert.equal(calls.length,before+1);await accepted[0].value.text();assert.equal(rows(b).length,1);
});
await check('a validation escalation is allowed once across the shared durable budget',async()=>{
 mode='success';const b=await budget(),route={task:'conversation',escalation:{reason:'validation_failed',attempt:1}};await (await meter.meteredMessage(b,'master',body,new AbortController().signal,route)).text();assert.equal(JSON.parse(rows(b)[0].rate).model,'gpt-6-astra');const before=calls.length;await assert.rejects(()=>meter.meteredMessage(b,'master',body,new AbortController().signal,route),error=>error.code==='model_escalation_limit');assert.equal(calls.length,before);
});
env.MODEL_ROUTING_POLICY='adaptive';env.OPENROUTER_API_KEY=secret;
const adaptiveCatalog=Object.fromEntries(['haiku','sonnet','opus'].map((key,index)=>[key,{enabled:true,transport:'openrouter',maxInputTokens:90000,maxOutputTokens:8192,rate:{model:`anthropic/claude-${key}-5.5`,provider:'openrouter',input:index+1,output:(index+1)*5,cacheWrite:(index+1)*1.25,cacheRead:(index+1)*.1,usdXaf:600,overheadXaf:0,fundingFeeBps:0,verifiedAt:new Date().toISOString()}}]));
env.MODEL_ROUTING_CATALOG_JSON=JSON.stringify(adaptiveCatalog);
await check('production adaptive catalogue selects only explicitly configured models and transport',async()=>{
 assert.equal(router.routedModel(env).key,'haiku');assert.equal(router.routedModel(env,{task:'orchestration'}).key,'sonnet');assert.equal(router.routedModel(env,{task:'analysis'}).key,'opus');assert.equal(router.routedModel(env,{task:'video_motion',tier:'light'}).model,'anthropic/claude-opus-5.5');
 assert.equal(router.routedModel(env,{task:'conversation',escalation:{reason:'validation_failed',attempt:1}}).key,'sonnet');
 const selected=router.routedModel(env);assert.equal(selected.provider,'openrouter');assert.equal(selected.url,'https://openrouter.ai/api/v1/messages');
 const wire=JSON.parse(client.routedRequest(selected,body,new AbortController().signal).init.body);assert.deepEqual(wire.provider,{require_parameters:true,allow_fallbacks:false});assert.equal(wire.model,adaptiveCatalog.haiku.rate.model);
 assert.throws(()=>router.routedModel({...env,OPENROUTER_API_KEY:undefined}),error=>error.code==='model_not_configured');
 assert.throws(()=>router.routedModel({...env,MODEL_ROUTING_CATALOG_JSON:JSON.stringify({...adaptiveCatalog,haiku:{...adaptiveCatalog.haiku,rate:{...adaptiveCatalog.haiku.rate,model:'unapproved/model'}}})}),error=>error.code==='rate_unverified');
});
let receiptReady=true,paidCalls=0,receiptCalls=0;
globalThis.fetch=async(url,init={})=>{
 const requestUrl=new URL(url);assert.equal(requestUrl.hostname,'openrouter.ai');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);
 if(requestUrl.pathname==='/api/v1/generation'){receiptCalls++;if(!receiptReady)return Response.json({error:'Receipt pending'},{status:503});return Response.json({data:{id:requestUrl.searchParams.get('id'),model:adaptiveCatalog.haiku.rate.model,total_cost:.004,provider_name:'Fixture'}});}
 assert.equal(requestUrl.pathname,'/api/v1/messages');paidCalls++;const request=JSON.parse(init.body);assert.equal(request.model,adaptiveCatalog.haiku.rate.model);
 return new Response(encode([{type:'message_start',message:{id:`gen-fixture-${paidCalls}`,model:request.model,content:[],usage:{input_tokens:100}}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'OK'}},{type:'message_delta',usage:{output_tokens:2}},{type:'message_stop'}]),{headers:{'content-type':'text/event-stream'}});
};
await check('stream generation ID without an HTTP ID settles a real wallet debit exactly once from the receipt',async()=>{
 const b=await budget(),before=sql.prepare('SELECT sum(balance) value FROM credit_lots WHERE organization_id=?').get(who.organization).value;
 await (await meter.meteredMessage(b,'master',body,new AbortController().signal)).text();const row=rows(b)[0];assert.match(row.request_id,/^gen-fixture-/);assert.equal(row.status,'complete');assert.equal(row.cost_xaf,2.4);
 sql.prepare("UPDATE runs SET status='completed' WHERE id=?").run(b.runId);await meter.finishRunBudget(b);await meter.finishRunBudget(b);
 const hold=sql.prepare('SELECT * FROM credit_holds WHERE id=?').get(b.holdId),debits=sql.prepare("SELECT * FROM credit_ledger WHERE reference=? AND kind='consume' AND units>0").all(b.holdId);
 assert.equal(hold.status,'settled');assert.equal(hold.actual,60);assert.equal(debits.length,1);assert.equal(debits[0].units,60);assert.equal(before-sql.prepare('SELECT sum(balance) value FROM credit_lots WHERE organization_id=?').get(who.organization).value,60);
 assert.equal(sql.prepare('SELECT sum(reserved) value FROM credit_lots WHERE organization_id=?').get(who.organization).value>=0,true);
});
await check('late cost receipt settles reserved credits without issuing or charging another generation',async()=>{
 receiptReady=false;const b=await budget();await (await meter.meteredMessage(b,'master',body,new AbortController().signal)).text();const generationCalls=paidCalls;assert.equal(rows(b)[0].status,'estimated');
 sql.prepare("UPDATE runs SET status='completed' WHERE id=?").run(b.runId);await meter.finishRunBudget(b);assert.equal(sql.prepare('SELECT status FROM credit_holds WHERE id=?').get(b.holdId).status,'needs_reconciliation');
 receiptReady=true;await meter.reconcileOpenRouterUsage(who.organization,100);await meter.reconcileOpenRouterUsage(who.organization,100);
 assert.equal(paidCalls,generationCalls);assert.equal(rows(b)[0].status,'complete');assert.equal(sql.prepare('SELECT actual FROM credit_holds WHERE id=?').get(b.holdId).actual,60);assert.equal(sql.prepare("SELECT count(*) n FROM credit_ledger WHERE reference=? AND kind='consume' AND units>0").get(b.holdId).n,1);assert.ok(receiptCalls>=3);
});
assert.equal(JSON.stringify(sql.prepare('SELECT rate,usage FROM provider_usage').all()).includes(secret),false);
console.log('14 model routing integration checks passed. Provider APIs simulated; no paid calls.');
