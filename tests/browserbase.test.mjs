import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['lib/browserbase.ts'],bundle:true,platform:'node',format:'esm',write:false,external:['@cloudflare/playwright']});
const {createBrowserbaseTransport,createBrowserbaseDriver,browserbasePrice}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const id='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
function fixture({minutes=0,reserved=0,failed=false,ended=true}={}){
 const calls=[],env={WEB_PROVIDERS_JSON:JSON.stringify({version:1,browserbase:{apiKey:'fixture-browserbase-key',enabled:true,verified:true,verifiedAt:new Date().toISOString(),mode:'free_only',maxSessionSeconds:120,maxBrowserMinutes:60}}),DB:{prepare(){return{bind(){return{async first(){return{n:reserved};}};}};}}};
 const transport=async(url,init={})=>{calls.push({url:String(url),init});const route=new URL(url).pathname;
 if(route==='/v1/projects')return Response.json([{id:project}]);
 if(route.endsWith('/usage'))return Response.json({browserMinutes:minutes,proxyBytes:0});
 if(route==='/v1/sessions'){if(failed)throw Error('Connection lost after dispatch');return Response.json({id,connectUrl:'wss://connect.browserbase.com?sessionId='+id+'&apiKey=fixture-browserbase-key'});}
 if(route==='/v1/sessions/'+id){if(init.method==='POST')return Response.json({id,status:'COMPLETED'});return Response.json({id,status:ended?'COMPLETED':'RUNNING',startedAt:new Date(Date.now()-5000).toISOString(),endedAt:ended?new Date().toISOString():null});}
 if(new URL(url).hostname==='connect.browserbase.com')return{status:101,webSocket:{fixture:true}};
 throw Error('Unexpected external request');};
 return {env,calls,adapter:createBrowserbaseTransport(env,async()=>undefined,transport)};
}
test('Browserbase uses inferred project, disabled recording, no proxy and a bounded session',async()=>{
 const f=fixture();await f.adapter.lifecycle.beforeOpen({timeoutSeconds:60});
 const response=await f.adapter.binding.fetch('http://fake.host/v1/devtools/browser',{method:'POST',body:JSON.stringify({guardrails:{allowedDomains:['example.com']}})});assert.equal(response.status,200);assert.equal((await response.json()).sessionId,id);
 const sent=JSON.parse(f.calls.find(x=>new URL(x.url).pathname==='/v1/sessions').init.body);
 assert.equal('projectId' in sent,false);assert.equal(sent.timeout,60);assert.equal(sent.proxies,false);assert.equal(sent.keepAlive,false);assert.equal(sent.browserSettings.recordSession,false);assert.equal(sent.browserSettings.logSession,false);assert.equal(sent.browserSettings.solveCaptchas,false);assert.deepEqual(sent.browserSettings.allowedDomains,['example.com']);
 const upgrade=await f.adapter.binding.fetch('http://fake.host/v1/devtools/browser/'+id,{headers:{Upgrade:'websocket'}});assert.equal(upgrade.status,101);assert.ok(upgrade.webSocket);
});
test('foreign endpoints, arbitrary paths and cold reconnections cannot create sessions',async()=>{
 const f=fixture();for(const url of ['https://attacker.example/v1/devtools/browser','http://fake.host/evaluate','http://fake.host/v1/devtools/browser/'+id])assert.equal((await f.adapter.binding.fetch(url,{headers:{Upgrade:'websocket'}})).status,409);assert.equal(f.calls.length,0);
});
test('free allowance includes concurrent reservations and stops before provider creation',async()=>{
 const f=fixture({minutes:59,reserved:100});const r=await f.adapter.binding.fetch('http://fake.host/v1/devtools/browser',{method:'POST',body:JSON.stringify({guardrails:{allowedDomains:['example.com']}})});assert.equal(r.status,409);assert.equal(f.calls.filter(x=>new URL(x.url).pathname==='/v1/sessions').length,0);
});
test('an uncertain create is dispatched once and never silently retried',async()=>{
 const f=fixture({failed:true});const r=await f.adapter.binding.fetch('http://fake.host/v1/devtools/browser',{method:'POST',body:JSON.stringify({guardrails:{allowedDomains:['example.com']}})});assert.equal(r.status,409);assert.equal(f.calls.filter(x=>new URL(x.url).pathname==='/v1/sessions').length,1);
});
test('only completed provider timestamps can settle a receipt; termination is explicit',async()=>{
 const f=fixture();const receipt=await f.adapter.lifecycle.receipt(id);assert.equal(receipt.status,'complete');assert.ok(receipt.milliseconds>=4900);await f.adapter.lifecycle.terminate(id);assert.deepEqual(JSON.parse(f.calls.at(-1).init.body),{status:'REQUEST_RELEASE'});assert.equal((await fixture({ended:false}).adapter.lifecycle.receipt(id)).status,'unknown');
});
test('provider switches cannot reuse old handles or invent a paid rate',async()=>{
 const f=fixture(),driver=createBrowserbaseDriver(f.env);await assert.rejects(()=>driver.receipt(JSON.stringify({version:1,providerId:id,domains:['example.com']})),e=>e.code==='browser_provider_changed');const rate=browserbasePrice(f.env);assert.equal(rate.usdPerBrowserHour,0);assert.equal(rate.usdXaf,0);assert.equal(rate.freeOnly,true);
});
