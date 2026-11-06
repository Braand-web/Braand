import {z} from 'zod';
import {parseBEACReference} from './model-rate-sources.mjs';
import {FX_SOURCES,fxReference} from './fx-fallback.mjs';
type Bindings=Record<string,unknown>&{BUCKET?:R2Bucket};
const item=z.object({id:z.string().regex(/^[a-zA-Z0-9/._-]{1,180}$/),unit:z.enum(['megapixels','seconds','1000 characters']),maxUnits:z.number().finite().positive().max(10000)}).strict();
const policySchema=z.object({version:z.literal(1),items:z.array(item).min(1).max(12)}).strict();
type Policy=z.infer<typeof policySchema>;
type CatalogItem=Record<string,unknown>&{id:string};
type Quote={id:string;unit:string;unitPrice:number;maxUnits:number;currency:'USD';costCeilingXaf:number;credits:number;verifiedAt:string;pricingSource:string;fxSource:string;fxValueDate:string};
type Snapshot={version:1;hash:string;checkedAt:number;quotes:Quote[]};
type State={snapshot?:Snapshot;inFlight?:Promise<void>;loaded:boolean;retryAt:number};
const states=new Map<string,State>(),DAY=86400000,REFRESH=6*3600000;
const packedSchema=z.object({version:z.literal(1),enabled:z.boolean(),accountStatus:z.enum(['needs_funding','verification_pending','ready']),catalog:z.array(z.object({id:z.string()}).passthrough()).max(12),pricingPolicy:policySchema}).strict();
const packedCache=new Map<string,Record<string,string>>();
export function falConfigurationEnvironment<T extends object>(env:T):T{
    const raw=(env as Bindings).FAL_CONFIG_JSON;if(raw===undefined)return env;
    const closed={FAL_GENERATION_ENABLED:'false',FAL_ACCOUNT_STATUS:'configuration_invalid',FAL_CATALOG_JSON:'[]',FAL_PRICING_POLICY_JSON:''};
    if(typeof raw!=='string'||raw.length>32000)return {...env,...closed};
    let overlay=packedCache.get(raw);
    if(!overlay){try{const value=packedSchema.parse(JSON.parse(raw));overlay={FAL_GENERATION_ENABLED:value.enabled&&value.accountStatus==='ready'?'true':'false',FAL_ACCOUNT_STATUS:value.accountStatus,FAL_CATALOG_JSON:JSON.stringify(value.catalog),FAL_PRICING_POLICY_JSON:JSON.stringify(value.pricingPolicy)};}catch{overlay=closed;}
        if(packedCache.size>=4)packedCache.delete(packedCache.keys().next().value!);packedCache.set(raw,overlay);
    }
    return {...env,...overlay};
}
export const FAL_PRICE_URL='https://api.fal.ai/v1/models/pricing';
function settings(env:Bindings){
    if(!env.FAL_KEY||!env.FAL_PRICING_POLICY_JSON)return null;
    const policy=policySchema.parse(JSON.parse(String(env.FAL_PRICING_POLICY_JSON))),catalog=z.array(z.object({id:z.string()}).passthrough()).max(50).parse(JSON.parse(String(env.FAL_CATALOG_JSON||'[]')));
    if(new Set(policy.items.map(p=>p.id)).size!==policy.items.length||policy.items.some(p=>catalog.filter(c=>c.id===p.id).length!==1))throw Error('fal_policy_invalid');
    for(const p of policy.items)assertFalInputBounds(p,catalog.find(c=>c.id===p.id)!.inputSchema);
    // Prices may be account-specific. A credential rotation gets a separate
    // one-way cache key; the credential itself is never written to R2 or logs.
    return {policy,catalog:catalog as CatalogItem[],signature:JSON.stringify({policy,catalog,credential:env.FAL_KEY})};
}
export function assertFalInputBounds(p:z.infer<typeof item>,raw:unknown){
    const schema=z.object({type:z.literal('object'),additionalProperties:z.literal(false),required:z.array(z.string()),properties:z.record(z.record(z.unknown()))}).parse(raw),r=schema.properties;
    const requireKeys=(...keys:string[])=>{if(keys.some(key=>!schema.required.includes(key)||!r[key]))throw Error('fal_quantity_unbounded');};
    const enumeration=(key:string,values:unknown[])=>r[key]?.type==='boolean'||r[key]?.type==='string'?Array.isArray(r[key].enum)&&r[key].enum.length>0&&r[key].enum.every(v=>values.includes(v)):false;
    if(r.sync_mode&&!enumeration('sync_mode',[false])||r.enable_safety_checker&&!enumeration('enable_safety_checker',[true]))throw Error('fal_unsafe_output_mode');
    if(p.unit==='megapixels'){
        requireKeys('num_images','image_size','num_inference_steps');
        const sizes:Record<string,number>={square:512*512,square_hd:1024*1024,portrait_4_3:768*1024,portrait_16_9:576*1024,landscape_4_3:1024*768,landscape_16_9:1024*576},names=r.image_size.enum;
        if(p.id!=='fal-ai/flux/schnell'||r.num_images.type!=='integer'||r.num_images.maximum!==1||r.num_inference_steps.type!=='integer'||!Number.isSafeInteger(r.num_inference_steps.maximum)||Number(r.num_inference_steps.maximum)<1||Number(r.num_inference_steps.maximum)>4||!Array.isArray(names)||!names.length||names.some(n=>typeof n!=='string'||!sizes[n])||p.maxUnits<Math.ceil(Math.max(...names.map(n=>sizes[String(n)]))/1e6))throw Error('fal_quantity_unbounded');
    }else if(p.unit==='seconds'){
        requireKeys('duration','resolution','prompt_expansion_mode');
        if(p.id!=='minimax/h3-max-turbo/text-to-video'||!['number','integer'].includes(String(r.duration.type))||!Number.isFinite(r.duration.maximum)||Number(r.duration.maximum)>15||!enumeration('resolution',['480P'])||!enumeration('prompt_expansion_mode',['disabled'])||p.maxUnits<Math.ceil(Number(r.duration.maximum)+0.7))throw Error('fal_quantity_unbounded');
    }else if(p.unit==='1000 characters'){
        requireKeys('text');if(r.text.type!=='string'||!Number.isSafeInteger(r.text.maxLength)||Number(r.text.maxLength)<1||Number(r.text.maxLength)>5000||p.maxUnits<Math.ceil(Number(r.text.maxLength)/1000))throw Error('fal_quantity_unbounded');
    }else throw Error('fal_price_unit_unsupported');
}
export function priceFalCatalog(policy:Policy,prices:unknown,fx:ReturnType<typeof parseBEACReference>,now=Date.now()):Quote[]{
    const rows=z.array(z.object({endpoint_id:z.string(),unit_price:z.number().finite().positive(),unit:z.string(),currency:z.literal('USD')})).max(50).parse(prices);
    if(!Number.isFinite(fx.usdXaf)||fx.usdXaf<50||fx.usdXaf>5000||!FX_SOURCES.includes(fx.fxSource))throw Error('fal_fx_invalid');
    return policy.items.map(p=>{const matches=rows.filter(r=>r.endpoint_id===p.id);if(matches.length!==1||matches[0].unit!==p.unit)throw Error('fal_price_unit_changed');const cost=matches[0].unit_price*p.maxUnits*fx.usdXaf,credits=Math.max(1,Math.ceil(cost/4));if(!Number.isFinite(cost)||credits>1000)throw Error('fal_price_limit');return {id:p.id,unit:p.unit,unitPrice:matches[0].unit_price,maxUnits:p.maxUnits,currency:'USD',costCeilingXaf:cost,credits,verifiedAt:new Date(now).toISOString(),pricingSource:FAL_PRICE_URL,fxSource:fx.fxSource,fxValueDate:fx.fxValueDate};});
}
function overlay(catalog:CatalogItem[],policy:Policy,snapshot:Snapshot,hash:string,now:number){
    if(snapshot.version!==1||snapshot.hash!==hash||snapshot.checkedAt>now||now-snapshot.checkedAt>DAY||snapshot.quotes.length!==policy.items.length)throw Error('fal_snapshot_stale');
    for(const p of policy.items){const matches=snapshot.quotes.filter(q=>q.id===p.id);const q=matches[0];if(matches.length!==1||q.unit!==p.unit||q.maxUnits!==p.maxUnits||q.currency!=='USD'||q.pricingSource!==FAL_PRICE_URL||!FX_SOURCES.includes(q.fxSource)||Date.parse(q.verifiedAt)!==snapshot.checkedAt||!Number.isFinite(q.costCeilingXaf)||q.costCeilingXaf<=0||!Number.isSafeInteger(q.credits)||q.credits<1||q.credits>1000||q.costCeilingXaf>q.credits*4)throw Error('fal_snapshot_invalid');}
    return catalog.filter(c=>policy.items.some(p=>p.id===c.id)).map(c=>({...c,...snapshot.quotes.find(q=>q.id===c.id)}));
}
// A configured dynamic policy fails closed until a current source-backed quote
// has been loaded. Legacy administrator catalogues retain their existing path.
export function falRateEnvironment<T extends object>(env:T,now=Date.now()):T{
    env=falConfigurationEnvironment(env);
    if((env as Bindings).FAL_GENERATION_ENABLED==='false')return {...env,FAL_CATALOG_JSON:'[]'};
    try{const configured=settings(env as Bindings);if(!configured)return env;const state=states.get(configured.signature);if(!state?.snapshot)return {...env,FAL_CATALOG_JSON:'[]'};const values=overlay(configured.catalog,configured.policy,state.snapshot,state.snapshot.hash,now);return {...env,FAL_CATALOG_JSON:JSON.stringify(values)};}
    catch{return {...env,FAL_CATALOG_JSON:'[]'};}
}
async function read(url:string,key?:string,maxBytes=2000000){
    const response=await fetch(url,{headers:key?{Authorization:'Key '+key}:{Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(!response.ok||!response.body){await response.body?.cancel();throw Error('fal_source_unavailable');}
    const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw Error('fal_source_too_large');parts.push(value);}}finally{await reader.cancel().catch(()=>undefined);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
export async function ensureFalRates(env:Bindings,now=Date.now()){
    env=falConfigurationEnvironment(env);
    // A known unavailable media account must not delay ordinary chat requests
    // with catalogue, exchange-rate or storage reads.
    if(env.FAL_GENERATION_ENABLED==='false')return {status:'disabled'};
    let configured:ReturnType<typeof settings>;try{configured=settings(env);}catch{return {status:'configuration_invalid'};}if(!configured)return {status:'disabled'};
    const {signature,policy,catalog}=configured;let state=states.get(signature);if(!state){state={loaded:false,retryAt:0};if(states.size>=4){const stale=[...states].find(([,s])=>!s.inFlight);if(stale)states.delete(stale[0]);}states.set(signature,state);}
    if(state.inFlight){await state.inFlight;return {status:state.snapshot&&now-state.snapshot.checkedAt<=DAY?'available':'unavailable'};}
    if(state.snapshot&&now>=state.snapshot.checkedAt&&now-state.snapshot.checkedAt<REFRESH||now<state.retryAt)return {status:state.snapshot&&now-state.snapshot.checkedAt<=DAY?'available':'unavailable'};
    const current=state;
    current.inFlight=(async()=>{
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature))),n=>n.toString(16).padStart(2,'0')).join(''),path='internal/fal-pricing/'+hash+'.json';
        if(!current.loaded){current.loaded=true;try{const saved=await env.BUCKET?.get(path);if(saved&&saved.size<131072){const snapshot=JSON.parse(await saved.text()) as Snapshot;overlay(catalog,policy,snapshot,hash,now);current.snapshot=snapshot;}}catch{/* A cache is never permission to use an expired or foreign quote. */}if(current.snapshot&&now-current.snapshot.checkedAt<REFRESH)return;}
        try{const url=new URL(FAL_PRICE_URL);for(const p of policy.items)url.searchParams.append('endpoint_id',p.id);const [priceText,fx]=await Promise.all([read(url.href,String(env.FAL_KEY),131072),fxReference((source:string)=>read(source),parseBEACReference,now)]),quotes=priceFalCatalog(policy,JSON.parse(priceText).prices,fx,now),snapshot:Snapshot={version:1,hash,checkedAt:now,quotes};overlay(catalog,policy,snapshot,hash,now);current.snapshot=snapshot;current.retryAt=0;try{await env.BUCKET?.put(path,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'},customMetadata:{purpose:'internal-fal-pricing'}});}catch{/* Verified memory quote remains usable if cache storage fails. */}}
        catch{current.retryAt=now+300000;}
    })().finally(()=>{current.inFlight=undefined;});
    await current.inFlight;return {status:current.snapshot&&now>=current.snapshot.checkedAt&&now-current.snapshot.checkedAt<=DAY?'available':'unavailable'};
}
