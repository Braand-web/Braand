// The adaptive brain is on by default from the current OpenRouter tariff:
// light Haiku, standard Sonnet, advanced Opus with the same Braand fees; the
// stronger levels can never be billed before a live price check; explicit
// MODEL_ROUTING_* variables always win.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/model-routing-defaults-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({entryPoints:[path.join(root,'lib/model-routing-defaults.ts')],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'error',external:['zod']});
const {withRoutingDefaults}=await import(pathToFileURL(out).href);
const rate={model:'anthropic/claude-haiku-5.5',provider:'openrouter',input:0.1,output:0.5,cacheWrite:0.125,cacheRead:0.01,usdXaf:600,fundingFeeBps:550,overheadXaf:1,verifiedAt:new Date().toISOString(),pricingSource:'https://openrouter.ai/api/v1/models',fxSource:'https://www.beac.int/'};
const env={OPENROUTER_API_KEY:'FIXTURE',OPENROUTER_MODEL:rate.model,OPENROUTER_RATE_JSON:JSON.stringify(rate),BUCKET:{fixture:true}};

const on=withRoutingDefaults(env);
assert.equal(on.MODEL_ROUTING_ENABLED,'true');assert.equal(on.MODEL_ROUTING_POLICY,'adaptive');assert.equal(on.BUCKET,env.BUCKET,'Bindings are kept');
const catalog=JSON.parse(on.MODEL_ROUTING_CATALOG_JSON);
assert.deepEqual(Object.keys(catalog),['haiku','sonnet','opus','fable52']);
assert.deepEqual(catalog.haiku.rate,rate,'The light level keeps the verified tariff');
assert.equal(catalog.fable52.rate.model,'anthropic/claude-fable-5.2');assert.equal(catalog.fable52.rate.verifiedAt,'1970-01-01T00:00:00.000Z');
for(const key of ['sonnet','opus']){const r=catalog[key].rate;assert.equal(r.model,'anthropic/claude-'+key+'-5.5');assert.equal(r.verifiedAt,'1970-01-01T00:00:00.000Z','Never billable before a live price check');assert.equal(r.fundingFeeBps,550);assert.equal(r.overheadXaf,1);assert.equal(r.pricingSource,rate.pricingSource);assert.equal(catalog[key].transport,'openrouter');}
assert.equal(withRoutingDefaults({...env,MODEL_ROUTING_ENABLED:'false'}).MODEL_ROUTING_ENABLED,'false','An explicit variable wins');
assert.equal(withRoutingDefaults({...env,MODEL_ROUTING_POLICY:'task'}).MODEL_ROUTING_POLICY,'task');
assert.equal(withRoutingDefaults({OPENROUTER_RATE_JSON:env.OPENROUTER_RATE_JSON}).MODEL_ROUTING_ENABLED,undefined,'No OpenRouter key: unchanged');
assert.equal(withRoutingDefaults({...env,OPENROUTER_RATE_JSON:'{broken'}).MODEL_ROUTING_ENABLED,undefined,'Invalid tariff: unchanged');
assert.equal(withRoutingDefaults({...env,LLM_PROVIDER:'anthropic'}).MODEL_ROUTING_ENABLED,undefined);
console.log('PASS adaptive brain defaults: 9 checks, no network.');
