import {modelRateSchema, type ModelRate} from './model-protocol';
import {withRoutingDefaults} from './model-routing-defaults';
import {MODEL_PRICING_URL, FX_REFERENCE_URL, parseBEACReference, refreshOpenRouterRate} from './model-rate-sources.mjs';

type Environment = Record<string, unknown> & {BUCKET?: R2Bucket};
type Target = {key:string; rate:ModelRate; maxInputTokens:number; maxOutputTokens:number};
type Entry = {rate:ModelRate; maxInputTokens:number; maxOutputTokens:number};
type Snapshot = {version:1; fingerprint:string; checkedAt:number; entries:Record<string,Entry>};
type State = {snapshot?:Snapshot; values?:Record<string,string>; inFlight?:Promise<void>; retryAt:number; loaded:boolean; reason?:string};
const states = new Map<string,State>();
const REFRESH_MS = 6 * 3600000, MAX_AGE_MS = 86400000, RETRY_MS = 300000;
const fields = ['MODEL_ROUTING_ENABLED','MODEL_ROUTING_CATALOG_JSON','LLM_PROVIDER','OPENROUTER_MODEL','OPENROUTER_RATE_JSON'] as const;
const signature = (env:Environment) => JSON.stringify(fields.map(key => env[key] ?? null));
const object = (value:unknown):Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const json = (value:unknown):unknown => JSON.parse(typeof value === 'string' ? value : '{}');

function targets(env:Environment):Target[] {
 if (env.MODEL_ROUTING_ENABLED === 'true') return Object.entries(object(json(env.MODEL_ROUTING_CATALOG_JSON))).flatMap(([key,value]) => {
  const entry = object(value);
  if (entry.enabled !== true || entry.transport !== 'openrouter') return [];
  const rate = modelRateSchema.parse(entry.rate);
  if (rate.provider && rate.provider !== 'openrouter') throw new Error('model_rate_provider_invalid');
  if (!Number.isSafeInteger(entry.maxInputTokens) || !Number.isSafeInteger(entry.maxOutputTokens)) throw new Error('model_rate_limits_invalid');
  return [{key,rate,maxInputTokens:entry.maxInputTokens as number,maxOutputTokens:entry.maxOutputTokens as number}];
 });
 if (env.LLM_PROVIDER !== 'openrouter' && (env.LLM_PROVIDER || !env.OPENROUTER_API_KEY)) return [];
 const rate = modelRateSchema.parse(json(env.OPENROUTER_RATE_JSON));
 if (rate.model !== env.OPENROUTER_MODEL) return [];
 return [{key:'default',rate,maxInputTokens:typeof rate.maxInputTokens === 'number' ? rate.maxInputTokens : 90000,maxOutputTokens:8192}];
}

function overlays(env:Environment, selected:Target[], snapshot:Snapshot, fingerprint:string, now:number):Record<string,string> {
 if (snapshot?.version !== 1 || snapshot.fingerprint !== fingerprint || !Number.isFinite(snapshot.checkedAt) || snapshot.checkedAt > now || now - snapshot.checkedAt > MAX_AGE_MS) throw new Error('model_rate_snapshot_expired');
 const entries:Record<string,Entry> = {};
 for (const target of selected) {
  const saved = snapshot.entries?.[target.key], rate = modelRateSchema.parse(saved?.rate);
  if (rate.model !== target.rate.model || rate.provider !== 'openrouter' || Date.parse(rate.verifiedAt) !== snapshot.checkedAt || !Number.isSafeInteger(saved.maxInputTokens) || saved.maxInputTokens < 1 || saved.maxInputTokens > target.maxInputTokens || !Number.isSafeInteger(saved.maxOutputTokens) || saved.maxOutputTokens < 128 || saved.maxOutputTokens > target.maxOutputTokens) throw new Error('model_rate_snapshot_invalid');
  // Policy fees are owned by Braand and cannot be replaced by cached supplier data.
  if (rate.fundingFeeBps !== target.rate.fundingFeeBps || rate.overheadXaf !== target.rate.overheadXaf || rate.pricingSource !== MODEL_PRICING_URL || rate.fxSource !== FX_REFERENCE_URL) throw new Error('model_rate_snapshot_policy_changed');
  entries[target.key] = {...saved,rate};
 }
 if (env.MODEL_ROUTING_ENABLED !== 'true') return {OPENROUTER_RATE_JSON:JSON.stringify(entries.default.rate)};
 const catalog = object(json(env.MODEL_ROUTING_CATALOG_JSON));
 for (const [key,entry] of Object.entries(entries)) catalog[key] = {...object(catalog[key]),...entry};
 return {MODEL_ROUTING_CATALOG_JSON:JSON.stringify(catalog)};
}

// Synchronous consumers see only a previously verified, still-current snapshot.
export function modelRateEnvironment<T extends object>(env:T, now=Date.now()):T {
 const state = states.get(signature(env as Environment));
 return state?.snapshot && state.values && now >= state.snapshot.checkedAt && now - state.snapshot.checkedAt <= MAX_AGE_MS ? {...env,...state.values} : env;
}

async function sourceText(url:string, limit:number) {
 let response:Response;
 const source=url === MODEL_PRICING_URL ? 'pricing' : 'fx';
 try {response = await fetch(url,{headers:{Accept:source === 'pricing' ? 'application/json' : 'text/html'},redirect:'manual',signal:AbortSignal.timeout(8000)});}catch{throw new Error('model_'+source+'_fetch_failed');}
 if (!response.ok || !response.body) throw new Error('model_'+source+'_http_'+response.status);
 const reader = response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
 try {while (true) {const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw new Error('model_rate_source_too_large');chunks.push(part.value);}}
 finally {await reader.cancel().catch(()=>undefined);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}

export async function ensureModelRates(bindings:object & {BUCKET?:R2Bucket}, now=Date.now()) {
 const env=withRoutingDefaults(bindings) as Environment;
 let selected:Target[];
 try {selected=targets(env);} catch {return {status:'configuration_invalid'};}
 if (!selected.length) return {status:'disabled'};
 const key=signature(env);let state=states.get(key);
 if (!state) {state={retryAt:0,loaded:false};if(states.size>=8){const inactive=[...states].find(([,value])=>!value.inFlight);if(inactive)states.delete(inactive[0]);}states.set(key,state);}
 if (state.inFlight) {await state.inFlight;return {status:state.snapshot&&now>=state.snapshot.checkedAt&&now-state.snapshot.checkedAt<=MAX_AGE_MS?'available':'unavailable',reason:state.reason};}
 if (state.snapshot && now>=state.snapshot.checkedAt && now-state.snapshot.checkedAt<REFRESH_MS || now<state.retryAt) return {status:state.snapshot?'available':'unavailable'};
 const current=state;
 current.inFlight=(async()=>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  const fingerprint=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  const storageKey='internal/model-pricing/v1/'+fingerprint+'.json';
  if (!current.loaded) {
   current.loaded=true;
   try {const stored=await env.BUCKET?.get(storageKey);if(stored&&stored.size<=131072){const snapshot=JSON.parse(await stored.text()) as Snapshot;current.values=overlays(env,selected,snapshot,fingerprint,now);current.snapshot=snapshot;}}catch{/* An invalid or unavailable cache is never accepted as verified pricing. */}
   if(current.snapshot&&now-current.snapshot.checkedAt<REFRESH_MS)return;
  }
  try {
   const [pricing,reference]=await Promise.all([sourceText(MODEL_PRICING_URL,5000000),sourceText(FX_REFERENCE_URL,2000000)]);
   const data=object(JSON.parse(pricing)).data;if(!Array.isArray(data))throw new Error('model_rate_catalog_invalid');
   const fx=parseBEACReference(reference,now),entries:Record<string,Entry>={};
   for(const target of selected){const matches=data.filter(value=>object(value).id===target.rate.model);if(matches.length!==1)throw new Error('model_rate_missing');entries[target.key]=refreshOpenRouterRate(matches[0],target.rate,target,fx,now);}
   const snapshot:Snapshot={version:1,fingerprint,checkedAt:now,entries};
   const values=overlays(env,selected,snapshot,fingerprint,now);
   current.snapshot=snapshot;current.values=values;current.retryAt=0;current.reason=undefined;
   try {await env.BUCKET?.put(storageKey,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'},customMetadata:{purpose:'internal-model-pricing'}});}catch{/* A verified in-memory snapshot remains usable if persistence fails. */}
  } catch (error) {
   current.reason=error instanceof Error&&/^(?:fx_reference_invalid|model_[a-z_0-9]+)$/.test(error.message)?error.message:'model_rate_validation_failed';
   current.retryAt=now+RETRY_MS;
   console.error('Braand model pricing refresh unavailable; unverified costs remain blocked.');
  }
 })().finally(()=>{current.inFlight=undefined;});
 await current.inFlight;
 return {status:current.snapshot&&now-current.snapshot.checkedAt<=MAX_AGE_MS?'available':'unavailable',reason:current.reason};
}
