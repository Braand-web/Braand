import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),scriptPath=path.join(root,'.local-build/model-rate-worker.mjs');
mkdirSync(path.dirname(scriptPath),{recursive:true});
await build({stdin:{contents:`
 import {ensureModelRates} from './lib/model-rate-refresh';import {routedModel} from './lib/model-router';
 export default {async fetch(request,env){const now=Date.parse('2026-10-26T02:00:00Z');const pricing=await ensureModelRates(env,now);try{const model=routedModel(env,{task:'conversation'},now);return Response.json({ready:true,input:model.rate.input,pricing:pricing.status});}catch{return Response.json({ready:false,pricing:pricing.status},{status:503});}}};
`,resolveDir:root,loader:'ts'},outfile:scriptPath,bundle:true,platform:'browser',format:'esm',external:['cloudflare:workers']});
const model='anthropic/claude-haiku-5.5',catalog={haiku:{enabled:true,transport:'openrouter',maxInputTokens:90000,maxOutputTokens:8192,rate:{model,provider:'openrouter',input:1,output:5,cacheRead:.1,cacheWrite:1.25,cacheWriteHour:2,usdXaf:600,fundingFeeBps:0,overheadXaf:0,verifiedAt:'2026-10-24T00:00:00Z'}}};
let redirect=false,calls=0;const requests=[];
const options={modules:true,scriptPath,compatibilityDate:'2026-05-15',cf:false,r2Buckets:['BUCKET'],bindings:{MODEL_ROUTING_ENABLED:'true',MODEL_ROUTING_POLICY:'adaptive',MODEL_ROUTING_CATALOG_JSON:JSON.stringify(catalog),OPENROUTER_API_KEY:'fixture-only'},outboundService:async request=>{
 calls++;requests.push({url:request.url,authorization:request.headers.get('authorization')});assert.equal(request.headers.get('authorization'),null);
 if(redirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});
 if(request.url==='https://www.beac.int/')return new Response('USD/XAF</span></div></div><div id="middle">582.5503</div><div id="right">587.5463</div><p>Date de valeur : 23/10/2026</p>');
 assert.equal(request.url,'https://openrouter.ai/api/v1/models');
 return Response.json({data:[{id:model,supported_parameters:['tools'],context_length:1000000,top_provider:{max_completion_tokens:128000},pricing:{prompt:'0.0000001',completion:'0.0000005',input_cache_read:'0.00000001',input_cache_write:'0.000000125',input_cache_write_1h:'0.0000002'}}]});
}};
const mf=new Miniflare(options);
try {
 for(let index=0;index<2;index++){const response=await mf.dispatchFetch('https://fixture.invalid/');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ready:true,input:.1,pricing:'available'});}
 assert.equal(calls,2);assert.equal((await (await mf.getR2Bucket('BUCKET')).list({prefix:'internal/model-pricing/'})).objects.length,1);
 console.log('PASS real workerd validates the Fetch redirect mode, refreshes expired prices and persists a reusable private snapshot');
 redirect=true;await mf.setOptions({...options,bindings:{...options.bindings,MODEL_ROUTING_CATALOG_JSON:JSON.stringify({...catalog,haiku:{...catalog.haiku,maxInputTokens:80000}})}});
 const response=await mf.dispatchFetch('https://fixture.invalid/');assert.equal(response.status,503);assert.equal((await response.json()).ready,false);
 // BEAC failure may start the allowlisted ECB fallback before or just after
 // the parallel pricing fetch rejects. Its timing is not redirect following.
 assert.ok(calls>=4&&calls<=5);
 console.log('PASS real workerd rejects source redirects without contacting an unapproved host or unlocking generation');
} finally {await mf.dispose();}
assert.ok(requests.every(r=>['https://openrouter.ai/api/v1/models','https://www.beac.int/','https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'].includes(r.url)&&r.authorization===null),'all completed requests stay on the fixed public allowlist, including fallback');
