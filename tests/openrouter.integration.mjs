// Real LLM adapters and credit ledger, isolated SQLite, simulated provider APIs only.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const project=path.resolve(import.meta.dirname,'..');
const runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,'node_modules');
const {build}=createRequire(path.join(runtime,'package.json'))('esbuild');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const f of readdirSync(path.join(project,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(path.join(project,'drizzle',f),'utf8'));
function statement(query,args=[]){return {bind(...v){return statement(query,v);},async first(column){const r=sql.prepare(query).get(...args);return column?r?.[column]??null:r??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return this._run();},_run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}
const DB={prepare:q=>statement(q),async batch(ss){sql.exec('BEGIN');try{const r=ss.map(s=>s._run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const secret='sk-or-v1-FIXTURE-NEVER-A-REAL-KEY';
globalThis.__openrouterTest={env:{DB},headers:new Headers({'x-braand-identity-id':'openrouter-owner','x-braand-identity-email':'owner@test.invalid'})};
const out=path.join(project,'.local-build','openrouter-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:['llm','metering','server','billing','agent'].map(n=>'export * as '+n+' from "'+path.join(project,n==='agent'?'lib':'lib',n+'.ts').replaceAll('\\','/')+'";').join('\n'),resolveDir:project,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',nodePaths:[runtime],plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation)$/},a=>({path:a.path,namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__openrouterTest.env;':a.path==='next/headers'?'export async function headers(){return globalThis.__openrouterTest.headers;}':'export function redirect(){throw new Error("unexpected redirect");}'}));}}]});
const {llm,metering:meter,server,billing,agent}=await import(pathToFileURL(out).href);
const env=globalThis.__openrouterTest.env;
const who=await server.identity(new Request('https://braand.test/api/chat'));
const now=Date.now();sql.prepare('INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run('fixture-credit',who.organization,'topup','fixture',1000000,1000000,now,now);
const rate={model:'anthropic/claude-opus-5.5',input:5,output:25,cacheWrite:6.25,cacheRead:.5,usdXaf:600,overheadXaf:1,fundingFeeBps:300,verifiedAt:new Date().toISOString()};
const masterBody={max_tokens:4096,stream:true,system:[{type:'text',text:agent.systemPrompt,cache_control:{type:'ephemeral'}},{type:'text',text:'Plafond de cette demande : 10 crédits.'}],messages:[{role:'user',content:[{type:'text',text:'bonjour'}]},{role:'user',content:[{type:'text',text:'Réponds brièvement en français pour confirmer que tu me reçois.'}]}],tools:agent.initialToolDefinitions(env)};
const actualAgentInput=llm.estimateInputTokens(masterBody);
const body={max_tokens:64,stream:true,system:'Help the user.',messages:[{role:'user',content:'Create an advertisement.'}],tools:[{name:'save_draft',description:'Save a draft',input_schema:{type:'object',properties:{title:{type:'string'}},required:['title']}}]};
const signal=()=>new AbortController().signal;
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const calls=[];let mode='success',generationAvailable=true,generationCost=.02,generationId='gen-fixture',generationOverride=null,metadataCancelled=0;
const events=[
 {type:'message_start',message:{id:'msg-fixture',type:'message',role:'assistant',model:rate.model,content:[],usage:{input_tokens:100,output_tokens:0,cache_creation_input_tokens:10,cache_read_input_tokens:20}}},
 {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
 {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Bonjour 👋'}},
 {type:'content_block_stop',index:0},
 {type:'content_block_start',index:1,content_block:{type:'tool_use',id:'tool-fixture',name:'save_draft',input:{}}},
 {type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"title":'}},
 {type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'"Une offre"}'}},
 {type:'content_block_stop',index:1},
 {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:30}},
 {type:'message_stop'}
];
const encode=items=>items.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
const parse=text=>text.trim().split('\n\n').map(frame=>JSON.parse(frame.split('\n').find(l=>l.startsWith('data: ')).slice(6)));
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url),headers=new Headers(init.headers);calls.push({url:u.href,body:init.body,auth:headers.get('authorization')});
 assert.equal(u.hostname,'openrouter.ai','OpenRouter key must never be sent to Anthropic');
 assert.equal(headers.get('authorization'),'Bearer '+secret);
 if(u.pathname==='/api/v1/generation'){
  assert.equal(u.searchParams.get('id'),generationId);
  if(!generationAvailable)return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"error":"not ready"}'));},cancel(){metadataCancelled++;}}),{status:404,headers:{'Content-Type':'application/json'}});
  return Response.json({data:generationOverride||{id:generationId,total_cost:generationCost,provider_name:'provider-fixture',finish_reason:'stop'}});
 }
 assert.equal(u.pathname,'/api/v1/messages');
 const request=JSON.parse(init.body);assert.equal(request.model,'anthropic/claude-opus-5.5');assert.equal(String(init.body).includes(secret),false);
 assert.deepEqual(request.provider,{require_parameters:true,allow_fallbacks:false});
 if(mode==='network')throw new Error('simulated network interruption');
 if(mode==='http401')return Response.json({error:{message:'unauthorized fixture'}},{status:401});
 if(mode==='http503')return Response.json({error:{message:'unavailable fixture'}},{status:503});
 const selected=mode==='sse_error'?[events[0],{type:'error',error:{type:'overloaded_error',message:'Try later'}}]:mode==='truncated'?events.slice(0,4):events;
 const text=mode==='invalid_sse'?encode([events[0]])+'event: content_block_delta\ndata: invalid-json\n\n':encode(selected);
 const bytes=new TextEncoder().encode(text);let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const next=Math.min(bytes.length,offset+11);controller.enqueue(bytes.slice(offset,next));offset=next;}}),{headers:{'Content-Type':'text/event-stream',...(mode==='missing_id'?{}:{'X-Generation-Id':generationId})}});
};
async function budget(credits=500){
 const id=crypto.randomUUID(),time=Date.now();
 sql.prepare("INSERT INTO resources(id,workspace_id,kind,title,created_at,updated_at) VALUES (?,?,'conversation','Fixture',?,?)").run(id,who.tenant,time,time);
 sql.prepare('INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,who.tenant,id,'streaming',time,time);
 return meter.startRunBudget(who,id,credits);
}
const row=b=>sql.prepare('SELECT * FROM provider_usage WHERE run_id=? ORDER BY created_at DESC LIMIT 1').get(b.runId);
const hold=b=>sql.prepare('SELECT * FROM credit_holds WHERE id=?').get(b.holdId);
async function finish(b,status='partial'){sql.prepare('UPDATE runs SET status=? WHERE id=?').run(status,b.runId);await meter.finishRunBudget(b);}
function reset(next='success'){mode=next;generationAvailable=true;generationCost=.02;generationId='gen-'+crypto.randomUUID();generationOverride=null;}

await check('OpenRouter key selects native Messages endpoint and explicit provider overrides selection',async()=>{
 assert.equal(llm.modelConnection().provider,'anthropic');assert.throws(()=>llm.requireModel(),e=>e.code==='model_not_configured');
 env.OPENROUTER_API_KEY=secret;assert.equal(llm.modelConnection().provider,'openrouter');assert.equal(llm.modelConnection().model,rate.model);
 env.LLM_PROVIDER='anthropic';assert.equal(llm.modelConnection().provider,'anthropic');delete env.LLM_PROVIDER;
 env.OPENROUTER_RATE_JSON=JSON.stringify(rate);assert.equal(meter.modelRate().provider,'openrouter');
 const request=llm.modelRequest(body,signal());assert.equal(new Headers(request.init.headers).get('authorization'),'Bearer '+secret);assert.equal(new Headers(request.init.headers).has('x-api-key'),false);assert.equal(request.init.body.includes(secret),false);
});
await check('Readiness distinguishes a configured key from verified billing rates',async()=>{
 env.LLM_PROVIDER='openrouter';env.OPENROUTER_API_KEY=secret;delete env.OPENROUTER_RATE_JSON;
 assert.deepEqual(meter.modelReadiness(),{ready:false,reason:'rate_unverified',detail:'missing_rate'});
 env.OPENROUTER_RATE_JSON=JSON.stringify(rate);
 assert.deepEqual(meter.modelReadiness(),{ready:true,reason:null,detail:null});
 env.OPENROUTER_API_KEY='';
 assert.deepEqual(meter.modelReadiness(),{ready:false,reason:'missing_key',detail:null});
 env.OPENROUTER_API_KEY=secret;env.OPENROUTER_RATE_JSON=JSON.stringify(rate);delete env.LLM_PROVIDER;
});
await check('Unverified OpenRouter rates and wrong model are rejected',async()=>{
 for(const patch of [{model:'another-model'},{fundingFeeBps:-1},{verifiedAt:'invalid'},{verifiedAt:new Date(Date.now()-90000000).toISOString()}]){env.OPENROUTER_RATE_JSON=JSON.stringify({...rate,...patch});assert.throws(()=>meter.modelRate());}
 env.OPENROUTER_RATE_JSON=JSON.stringify({...rate,verifiedAt:new Date(Date.now()-90000000).toISOString()});
 assert.equal(meter.modelReadiness().detail,'stale_rate');
 assert.throws(()=>meter.modelRate(),/expiré/i);
 env.OPENROUTER_RATE_JSON=JSON.stringify({...rate,model:'another-model'});
 assert.equal(meter.modelReadiness().detail,'model_mismatch');
 env.OPENROUTER_RATE_JSON=JSON.stringify({...rate,fundingFeeBps:undefined});
 assert.equal(meter.modelReadiness().detail,'funding_fee_unverified');
 env.OPENROUTER_RATE_JSON=JSON.stringify(rate);
});
await check('Native streaming preserves text, Unicode and tool input deltas with actual generation cost',async()=>{
 reset();const b=await budget(),before=calls.length;const response=await meter.meteredMessage(b,'master',body,signal()),text=await response.text();assert.deepEqual(parse(text),events);assert.equal(response.headers.get('x-generation-id'),generationId);
 const usage=row(b);assert.equal(usage.status,'complete');assert.equal(usage.request_id,generationId);assert.equal(usage.provider,'openrouter');assert.equal(JSON.parse(usage.usage).output_tokens,30);assert.equal(JSON.parse(usage.usage).cost_source,'generation');assert.equal(usage.cost_xaf,.02*600*1.03+1);
 assert.equal(calls.slice(before).some(c=>c.url.includes('count_tokens')),false);await finish(b);assert.equal(hold(b).actual,Math.ceil(usage.cost_xaf/4*100));assert.equal(text.includes(secret),false);
});
await check('Output token ceiling adapts to a small accepted credit budget',async()=>{
 reset();const b=await budget(10),limited=masterBody,response=await meter.meteredMessage(b,'master',limited,signal());await response.text();
 const request=JSON.parse(calls.filter(c=>c.url.endsWith('/messages')).at(-1).body),usage=row(b),inputTokens=JSON.parse(usage.rate).inputEstimate;
 const ceiling=Math.ceil(((Math.ceil(inputTokens*1.2)*Math.max(rate.input,rate.cacheWrite,rate.cacheWriteHour||0)+request.max_tokens*rate.output)/1e6*rate.usdXaf*(1+rate.fundingFeeBps/10000)+rate.overheadXaf)/4*100);
 assert.equal(inputTokens,actualAgentInput);assert.ok(request.max_tokens>=128);assert.ok(request.max_tokens<limited.max_tokens);assert.ok(ceiling<=b.limit);await finish(b);assert.equal(hold(b).actual,Math.ceil((generationCost*600*1.03+1)/4*100));
});
await check('HTTP refusal is preserved without charging failed work',async()=>{
 reset('http401');const b=await budget(),response=await meter.meteredMessage(b,'master',body,signal());assert.equal(response.status,401);assert.equal((await response.json()).error.message,'unauthorized fixture');assert.equal(row(b).status,'rejected');await finish(b,'failed');assert.equal(hold(b).actual,0);
});
await check('Server error is unresolved and no automatic generation retry occurs',async()=>{
 reset('http503');const b=await budget(),before=calls.filter(c=>c.url.endsWith('/messages')).length;const response=await meter.meteredMessage(b,'master',body,signal());assert.equal(response.status,503);assert.equal(row(b).status,'unknown');await finish(b);assert.equal(hold(b).status,'needs_reconciliation');assert.equal(calls.filter(c=>c.url.endsWith('/messages')).length,before+1);
 await billing.settleHold(b.holdId,0);
});
await check('SSE error remains visible and cannot fabricate a successful consumption',async()=>{
 reset('sse_error');generationAvailable=false;const b=await budget(),response=await meter.meteredMessage(b,'master',body,signal()),text=await response.text();assert.equal(parse(text).at(-1).type,'error');assert.equal(row(b).status,'unknown');await finish(b,'failed');assert.equal(hold(b).status,'needs_reconciliation');await billing.settleHold(b.holdId,0);
});
await check('Complete stream with delayed metadata keeps reservation then reconciles exactly once',async()=>{
 reset();generationAvailable=false;const b=await budget(),before=calls.filter(c=>c.url.endsWith('/messages')).length;await (await meter.meteredMessage(b,'master',body,signal())).text();assert.equal(row(b).status,'estimated');assert.equal(row(b).cost_xaf,null);await finish(b);assert.equal(hold(b).status,'needs_reconciliation');assert.equal(hold(b).actual,null);
 generationAvailable=true;generationCost=.031;await meter.reconcileOpenRouterUsage(who.organization,100);const actual=hold(b).actual;assert.equal(actual,Math.ceil((.031*600*1.03+1)/4*100));assert.equal(row(b).status,'complete');
 await meter.reconcileOpenRouterUsage(who.organization,100);await meter.finishRunBudget(b);assert.equal(hold(b).actual,actual);assert.equal(sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE reference=? AND kind='consume'").get(b.holdId).n,1);assert.equal(calls.filter(c=>c.url.endsWith('/messages')).length,before+1);
});
await check('Interrupted stream is unresolved until actual provider metadata is available',async()=>{
 reset('truncated');generationAvailable=false;const b=await budget();await (await meter.meteredMessage(b,'master',body,signal())).text();assert.equal(row(b).status,'unknown');await finish(b);assert.equal(hold(b).status,'needs_reconciliation');generationAvailable=true;await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(row(b).status,'complete');assert.ok(hold(b).actual>0);
});
await check('A failed run that streamed text retains and later settles its real provider cost',async()=>{
 reset();generationAvailable=false;const b=await budget(),response=await meter.meteredMessage(b,'master',body,signal());await response.text();sql.prepare('INSERT INTO events(run_id,type,data,created_at) VALUES (?,?,?,?)').run(b.runId,'text_delta',JSON.stringify({text:'Bonjour'}),Date.now());await finish(b,'failed');assert.equal(hold(b).status,'needs_reconciliation');generationAvailable=true;generationCost=.031;await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(hold(b).actual,Math.ceil((.031*600*1.03+1)/4*100));
});
await check('Malformed SSE rejects the reader and retains an unresolved cost',async()=>{
 reset('invalid_sse');generationAvailable=false;const b=await budget(),response=await meter.meteredMessage(b,'master',body,signal());await assert.rejects(()=>response.text());assert.equal(row(b).status,'unknown');await finish(b,'failed');assert.equal(hold(b).status,'needs_reconciliation');assert.equal(hold(b).actual,null);await billing.settleHold(b.holdId,0);
});
await check('Network interruption is tracked without issuing a second generation',async()=>{
 reset('network');const b=await budget(),before=calls.length;await assert.rejects(()=>meter.meteredMessage(b,'master',body,signal()),/simulated network/);assert.equal(row(b).status,'unknown');assert.equal(calls.length,before+1);await finish(b,'failed');assert.equal(hold(b).status,'needs_reconciliation');assert.equal(hold(b).actual,null);await billing.settleHold(b.holdId,0);
});
await check('Missing generation identifier cannot turn an estimate into confirmed cost',async()=>{
 reset('missing_id');const b=await budget();await (await meter.meteredMessage(b,'master',body,signal())).text();assert.equal(row(b).request_id,null);assert.equal(row(b).status,'estimated');await finish(b);assert.equal(hold(b).status,'needs_reconciliation');await billing.settleHold(b.holdId,0);
});
await check('Generation cost rejects foreign identifiers and nonfinite or negative totals',async()=>{
 reset();await assert.rejects(()=>llm.generationCost('untrusted-id',rate));
 for(const fixture of [{id:'gen-other',total_cost:.02},{id:generationId,total_cost:-1},{id:generationId,total_cost:'0.02'}]){generationOverride=fixture;await assert.rejects(()=>llm.generationCost(generationId,rate));}
 generationOverride=null;const actual=await llm.generationCost(generationId,rate);assert.equal(actual.usd,.02);assert.equal(actual.provider,'provider-fixture');
});
await check('terminal interrupted runs reconcile stale pending usage only from a final receipt, never while streaming or by replaying a generation',async()=>{
 reset();generationAvailable=false;const b=await budget();await (await meter.meteredMessage(b,'master',body,signal())).text();const usage=row(b);
 sql.prepare("UPDATE provider_usage SET status='pending',usage=NULL,cost_xaf=NULL WHERE id=?").run(usage.id);generationAvailable=true;generationOverride={id:generationId,total_cost:.013,finish_reason:'stop'};
 const before=calls.filter(c=>c.url.endsWith('/messages')).length;await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(row(b).status,'pending');
 sql.prepare('INSERT INTO events(run_id,type,data,created_at) VALUES (?,?,?,?)').run(b.runId,'text_delta',JSON.stringify({text:'Preserved result'}),Date.now());await finish(b,'failed');assert.equal(hold(b).status,'needs_reconciliation');
 generationOverride={id:generationId,total_cost:0,finish_reason:null};await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(row(b).status,'pending');assert.equal(hold(b).status,'needs_reconciliation');
 generationOverride={id:generationId,total_cost:.013,finish_reason:'stop'};await meter.reconcileOpenRouterUsage(who.organization,100);await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(row(b).status,'complete');assert.equal(hold(b).status,'settled');assert.equal(hold(b).actual,Math.ceil((.013*600*1.03+1)/4*100));assert.equal(sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE reference=? AND kind='consume'").get(b.holdId).n,1);assert.equal(calls.filter(c=>c.url.endsWith('/messages')).length,before);
});
await check('a confirmed cancelled receipt settles interrupted usage without requiring finish_reason',async()=>{
 reset();const b=await budget();await (await meter.meteredMessage(b,'master',body,signal())).text();
 sql.prepare("UPDATE provider_usage SET status='pending',usage=NULL,cost_xaf=NULL WHERE run_id=?").run(b.runId);
 sql.prepare("UPDATE runs SET status='cancelled',updated_at=? WHERE id=?").run(Date.now()-60000,b.runId);
 generationOverride={id:generationId,total_cost:.00279685,cancelled:true,finish_reason:null};
 const before=calls.filter(c=>c.url.endsWith('/messages')).length;
 await meter.reconcileOpenRouterUsage(who.organization,100);await meter.reconcileOpenRouterUsage(who.organization,100);
 assert.equal(row(b).status,'complete');assert.equal(hold(b).status,'settled');
 assert.equal(hold(b).actual,Math.ceil((.00279685*600*1.03+1)/4*100));
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE reference=? AND kind='consume'").get(b.holdId).n,1);
 assert.equal(calls.filter(c=>c.url.endsWith('/messages')).length,before);
});
await check('an unfinished receipt cannot settle an interrupted response',async()=>{
 reset('truncated');generationOverride={id:generationId,total_cost:0,cancelled:false,finish_reason:null};
 const b=await budget();await (await meter.meteredMessage(b,'master',body,signal())).text();await finish(b,'cancelled');
 await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(hold(b).actual,null);assert.equal(hold(b).status,'needs_reconciliation');
 generationOverride={id:generationId,total_cost:.003,cancelled:true,finish_reason:null};await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(hold(b).status,'settled');
});
await check('terminal holds recover after a worker stops between saving usage and settlement',async()=>{
 reset();const b=await budget();await (await meter.meteredMessage(b,'master',body,signal())).text();
 sql.prepare("UPDATE runs SET status='completed',updated_at=? WHERE id=?").run(Date.now()-60000,b.runId);
 assert.equal(row(b).status,'complete');assert.equal(hold(b).status,'reserved');
 await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(hold(b).status,'settled');assert.ok(hold(b).actual>0);
 await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE reference=? AND kind='consume'").get(b.holdId).n,1);
});
await check('chat uses a fractional remaining balance without raising its accepted ceiling or changing media reservations',async()=>{
 reset();const person={...who,organization:'small-wallet'},time=Date.now();
 sql.prepare('INSERT INTO organizations(id,name,owner_id,created_at) VALUES (?,?,?,?)').run(person.organization,'Small wallet',who.user.userId,time);
 sql.prepare('INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run('small-lot',person.organization,'topup','fixture',537,537,time,time);
 await assert.rejects(()=>billing.reserve(person,'media:unaffordable',1000),e=>e.code==='insufficient_credits');
 const first=await meter.startRunBudget(person,crypto.randomUUID(),10);assert.equal(first.limit,537);
 await billing.settleHold(first.holdId,500);assert.equal((await billing.summary(person.organization)).wallet.available,.37);
 const second=await meter.startRunBudget(person,crypto.randomUUID(),10);assert.equal(second.limit,37);
 await billing.settleHold(second.holdId,37);await assert.rejects(()=>meter.startRunBudget(person,crypto.randomUUID(),10),e=>e.code==='insufficient_credits');
 sql.prepare('INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run('small-refill',person.organization,'topup','fixture2',500,500,time,time);
 const capped=await meter.startRunBudget(person,crypto.randomUUID(),2);assert.equal(capped.limit,200);await billing.settleHold(capped.holdId,0);
});
await check('abandoned pre-run chat reservations are released but recent reservations remain protected',async()=>{
 reset();const id=crypto.randomUUID(),h=await billing.reserve(who,'chat:'+id,1000);
 await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(sql.prepare('SELECT status FROM credit_holds WHERE id=?').get(h.id).status,'reserved');
 sql.prepare('UPDATE credit_holds SET created_at=? WHERE id=?').run(Date.now()-360000,h.id);
 await meter.reconcileOpenRouterUsage(who.organization,100);assert.equal(sql.prepare('SELECT actual FROM credit_holds WHERE id=?').get(h.id).actual,0);
});
await check('unavailable cost responses release their response bodies before another request',async()=>{reset();generationAvailable=false;const before=metadataCancelled;await assert.rejects(()=>llm.generationCost(generationId,rate),e=>e.code==='usage_unknown');assert.equal(metadataCancelled,before+1);generationAvailable=true;});
await check('terminal conversation locks recover without unlocking recent or active responses',async()=>{
 const old=Date.now()-360000;
 const cancelled=await server.createResource(who.tenant,'conversation','Interrupted fixture',{},'streaming');
 const active=await server.createResource(who.tenant,'conversation','Active fixture',{},'streaming');
 const recent=await server.createResource(who.tenant,'conversation','Recent fixture',{},'streaming');
 for(const [conversation,status] of [[cancelled,'cancelled'],[active,'streaming'],[recent,'completed']]){
  sql.prepare('INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),who.tenant,conversation.id,status,old,old);
  if(conversation!==recent)sql.prepare('UPDATE resources SET updated_at=? WHERE id=?').run(old,conversation.id);
 }
 await meter.reconcileOpenRouterUsage(who.organization,100);
 assert.equal((await server.getResource(who.tenant,cancelled.id)).status,'saved');
 assert.equal((await server.getResource(who.tenant,active.id)).status,'streaming');
 assert.equal((await server.getResource(who.tenant,recent.id)).status,'streaming');
});
await check('Usage records, ledger and surfaced errors never persist the API secret',async()=>{
 for(const table of ['provider_usage','credit_holds','credit_ledger','events','messages'])assert.equal(JSON.stringify(sql.prepare('SELECT * FROM '+table).all()).includes(secret),false);
 env.LLM_PROVIDER='unsupported';assert.throws(()=>llm.modelRequest(body,signal()),e=>!e.message.includes(secret));delete env.LLM_PROVIDER;
 assert.equal(calls.some(c=>c.url.includes(secret)||String(c.body).includes(secret)),false);
});
console.log(`${checks} OpenRouter integration checks passed. Provider APIs were simulated; no real model calls.`);
sql.close();
