import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),outfile=path.join(root,'.local-build/model-rate-refresh-test.mjs');
mkdirSync(path.dirname(outfile),{recursive:true});
await build({stdin:{contents:`export * from './lib/model-rate-refresh';export {routedModel} from './lib/model-router';`,resolveDir:root,loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated-worker-environment',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'workers',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const env={};'}));}}]});
const url=pathToFileURL(outfile).href,refresh=await import(url);
const now=Date.parse('2026-10-26T02:00:00Z'),hour=3600000,stored=new Map();let puts=0,fetches=0,reads=0,fail=false,missing=false,beacDown=false,price='0.0000001';
const bucket={async get(key){reads++;const text=stored.get(key);return text===undefined?null:{size:Buffer.byteLength(text),async text(){return text;}};},async put(key,value){puts++;stored.set(key,value);}};
const rates=Object.fromEntries(['haiku','sonnet','opus'].map(key=>[key,{enabled:true,transport:'openrouter',maxInputTokens:90000,maxOutputTokens:8192,rate:{model:`anthropic/claude-${key}-5.5`,provider:'openrouter',input:1,output:5,cacheWrite:1.25,cacheRead:.1,cacheWriteHour:2,usdXaf:600,overheadXaf:0,fundingFeeBps:0,verifiedAt:'2026-10-24T00:00:00Z'}}]));
const env={MODEL_ROUTING_ENABLED:'true',MODEL_ROUTING_POLICY:'adaptive',MODEL_ROUTING_CATALOG_JSON:JSON.stringify(rates),OPENROUTER_API_KEY:'fixture-not-a-real-key',BUCKET:bucket};
const originalFetch=globalThis.fetch,originalError=console.error;let failures=0;
console.error=(message)=>{assert.equal(message,'Braand model pricing refresh unavailable; unverified costs remain blocked.');failures++;};
globalThis.fetch=async(address,options)=>{
 fetches++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.authorization,undefined);
 if(fail)throw Error('private-provider-error-must-not-be-logged');

 if(address==='https://www.beac.int/'&&beacDown)return new Response('origin down',{status:530});
 if(address==='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')return new Response("<Cube><Cube time='2026-10-23'><Cube currency='USD' rate='1.1212'/></Cube></Cube>");
 if(address==='https://www.beac.int/')return new Response('USD/XAF</span></div></div><div id="middle">582.5503</div><div id="right">587.5463</div><p>Date de valeur : 23/10/2026</p>');
 assert.equal(address,'https://openrouter.ai/api/v1/models');
 return Response.json({data:Object.values(rates).filter(entry=>!missing||!entry.rate.model.includes('opus')).map(entry=>({id:entry.rate.model,supported_parameters:['tools'],context_length:1000000,top_provider:{max_completion_tokens:128000},pricing:{prompt:price,completion:'0.0000005',input_cache_read:'0.00000001',input_cache_write:'0.000000125',input_cache_write_1h:'0.0000002',overrides:[{min_prompt_tokens:100000,prompt:'0.0000005'}]}}))});
};
try {
 assert.throws(()=>refresh.routedModel(env,{task:'conversation'},now),error=>error.code==='rate_unverified');
 await Promise.all(Array.from({length:6},()=>refresh.ensureModelRates(env,now)));
 assert.equal(fetches,2);assert.equal(puts,1);assert.equal(reads,1);
 const selected=refresh.routedModel(env,{task:'conversation'},now);
 assert.equal(selected.rate.input,.1);assert.equal(selected.rate.usdXaf,587.5463);assert.equal(selected.rate.fxValueDate,'2026-10-23');
 assert.equal(selected.maxInputTokens,90000);assert.equal(selected.maxOutputTokens,8192);
 assert.equal(JSON.parse(env.MODEL_ROUTING_CATALOG_JSON).haiku.rate.verifiedAt,'2026-10-24T00:00:00Z');
 assert.equal([...stored.values()].some(value=>value.includes(env.OPENROUTER_API_KEY)),false);
 console.log('PASS stale configuration recovers from official metadata, coalesces concurrent reads and stores no credentials');

 const cold=await import(url+'?cold-start');fail=true;
 assert.equal((await cold.ensureModelRates(env,now+hour)).status,'available');assert.equal(fetches,2);
 assert.equal(cold.routedModel(env,{task:'conversation'},now+hour).rate.input,.1);
 console.log('PASS a cold Worker restores verified pricing from persistent storage during a source outage');

 fail=false;price='0.0000002';await refresh.ensureModelRates(env,now+7*hour);
 assert.equal(refresh.routedModel(env,{task:'conversation'},now+7*hour).rate.input,.2);assert.equal(selected.rate.input,.1);
 assert.equal(fetches,4);assert.equal(puts,2);
 console.log('PASS six-hour refresh updates future calls while an earlier request keeps its own accounting snapshot');

 fail=true;await refresh.ensureModelRates(env,now+14*hour);
 assert.equal(refresh.routedModel(env,{task:'conversation'},now+14*hour).rate.input,.2);
 const attempted=fetches;await refresh.ensureModelRates(env,now+14*hour+1000);assert.equal(fetches,attempted);
 await refresh.ensureModelRates(env,now+32*hour);
 assert.throws(()=>refresh.routedModel(env,{task:'conversation'},now+32*hour),error=>error.code==='rate_unverified');
 assert.equal(puts,2);
 console.log('PASS a source outage uses only the still-valid snapshot, backs off retries and never extends expired pricing');

 fail=false;missing=true;
 const changed={...env,MODEL_ROUTING_CATALOG_JSON:JSON.stringify({...rates,haiku:{...rates.haiku,maxInputTokens:80000}})};
 await refresh.ensureModelRates(changed,now);
 assert.throws(()=>refresh.routedModel(changed,{task:'conversation'},now),error=>error.code==='rate_unverified');assert.equal(puts,2);
 console.log('PASS missing model metadata rejects the entire refresh and a configuration revision cannot reuse the previous cache');

 missing=false;
 const tampered=await import(url+'?tampered');const corrupted=new Map([...stored].map(([key,value])=>{const snapshot=JSON.parse(value);snapshot.entries.haiku.rate.fundingFeeBps=999;return [key,JSON.stringify(snapshot)];}));
 fail=true;await tampered.ensureModelRates({...env,BUCKET:{async get(key){const text=corrupted.get(key);return {size:text.length,async text(){return text;}};} }},now+8*hour);
 assert.throws(()=>tampered.routedModel(env,{task:'conversation'},now+8*hour),error=>error.code==='rate_unverified');
 assert.ok(failures>=4);
 console.log('PASS corrupted persisted pricing cannot alter policy fees or unlock a billable request');

 fail=false;beacDown=true;
 const backup=await import(url+'?backup'),outage={...env,MODEL_ROUTING_POLICY:'adaptive',BUCKET:{async get(){return null;},async put(){}}};
 const status=await backup.ensureModelRates(outage,now);assert.equal(status.status,'available');
 const chosen=backup.routedModel(outage,{task:'conversation'},now);
 assert.equal(chosen.rate.fxSource,'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');assert.equal(chosen.rate.conversionBasis,'ecb_eur_peg_reference');assert.equal(chosen.rate.usdXaf,Math.round(655.957/1.1212*1.005*10000)/10000);
 console.log('PASS a BEAC outage (HTTP 530) uses the ECB euro-peg reference instead of blocking the assistant');
} finally {globalThis.fetch=originalFetch;console.error=originalError;}
