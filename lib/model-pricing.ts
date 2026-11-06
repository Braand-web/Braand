import {env} from 'cloudflare:workers';
import {modelRateEnvironment} from './model-rate-refresh';
import {z} from 'zod';
import {AppError} from './core.mjs';
import {modelRateSchema,type ModelRate} from './model-protocol';
import {ECB_REFERENCE_URL,fxReference} from './fx-fallback.mjs';

const MODEL_SOURCE='https://openrouter.ai/api/v1/models';
const FX_SOURCE='https://www.beac.int/';
const REFRESH_MS=6*60*60*1000,VALID_MS=24*60*60*1000;
const allowedModels=['anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5','anthropic/claude-opus-5.5'] as const;
const policySchema=z.object({enabled:z.literal(true),models:z.array(z.enum(allowedModels)).min(1).max(3).refine(models=>new Set(models).size===models.length),basis:z.literal('inference_credits'),maxInputTokens:z.number().int().min(1024).max(90000)}).strict();
type Policy=z.infer<typeof policySchema>;
const quoteSchema=z.object({checkedAt:z.number().int(),expiresAt:z.number().int(),modelSource:z.literal(MODEL_SOURCE),fxSource:z.enum([FX_SOURCE,ECB_REFERENCE_URL]),fxValueDate:z.string(),fxSell:z.number().finite().positive(),fundingBasis:z.literal('separate_company_expense'),rates:z.record(modelRateSchema)}).strict();
type Quote=z.infer<typeof quoteSchema>;
let memory:{policy:string;quote:Quote;loadedAt:number;retryAfter?:number}|undefined;
let pending:{policy:string;work:Promise<void>}|undefined;
function settings(){return env as Cloudflare.Env&Record<string,string|undefined>;}
// Prefer the production refresh snapshot when present; do not fetch or apply two competing quotes.
function policy(){if(modelRateEnvironment(settings())!==settings())return null;const raw=settings().MODEL_PRICING_REFRESH_JSON;if(!raw)return null;try{return {raw,value:policySchema.parse(JSON.parse(raw))};}catch{throw new AppError('La politique de vérification des coûts est invalide.',503,'rate_unverified');}}
function failure(){return new AppError('La vérification des coûts est temporairement indisponible. Votre demande est conservée.',503,'rate_unverified');}
// BEAC publishes a dated buy/sell pair. An undated number elsewhere in the page
// is never accepted; weekends/holidays retain the last published business date.
export function parseBeacReference(html:string,now=Date.now()){
 const values=[...html.matchAll(/USD\/XAF[\s\S]{0,700}?id=["']middle["'][^>]*>\s*([\d.,]+)\s*<\/div>[\s\S]{0,100}?id=["']right["'][^>]*>\s*([\d.,]+)\s*<\/div>/g)];
 const dates=[...html.matchAll(/Date de valeur\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/g)];
 if(values.length!==1||dates.length!==1)throw failure();
 const [,day,month,year]=dates[0],date=`${year}-${month}-${day}`,stamp=Date.parse(date+'T00:00:00Z'),age=now-stamp;
 const buy=Number(values[0][1].replace(',','.')),sell=Number(values[0][2].replace(',','.'));
 if(!Number.isFinite(age)||age<0||age>7*VALID_MS||new Date(stamp).toISOString().slice(0,10)!==date||!Number.isFinite(buy)||!Number.isFinite(sell)||buy<=0||buy>sell||sell<100||sell>2000)throw failure();
 return {date,sell};
}
type FxReference={date:string;sell:number;source:typeof FX_SOURCE|typeof ECB_REFERENCE_URL;basis:'beac_sell_reference'|'ecb_eur_peg_reference'};
export function buildPricingQuote(value:Policy,catalog:unknown,reference:string|FxReference,now=Date.now()):Quote{
 value=policySchema.parse(value);
 const source=z.object({data:z.array(z.unknown())}).parse(catalog),fx:FxReference=typeof reference==='string'?{...parseBeacReference(reference,now),source:FX_SOURCE,basis:'beac_sell_reference'}:reference,rates:Record<string,ModelRate>={};
 // OpenRouter model credits exclude card-recharge fees. Those are company
 // funding expenses, not a surcharge on each model request.
 const fundingFeeBps=0;
 for(const id of value.models){const matches=source.data.filter(item=>typeof item==='object'&&item!==null&&'id' in item&&item.id===id);if(matches.length!==1)throw failure();const item=z.object({id:z.string(),pricing:z.record(z.unknown()),context_length:z.number().int(),supported_parameters:z.array(z.string())}).passthrough().parse(matches[0]);if(!item.supported_parameters.includes('tools')||item.context_length<value.maxInputTokens)throw failure();
  const price=(name:string)=>{const raw=item.pricing[name];if(typeof raw!=='string'||!/^\d+(?:\.\d+)?$/.test(raw))throw failure();const cost=Number(raw+'e6');if(!Number.isFinite(cost)||cost<0||cost>10000)throw failure();return cost;};
  const overrides=item.pricing.overrides;if(overrides!==undefined){if(!Array.isArray(overrides))throw failure();for(const override of overrides){const tier=z.object({min_prompt_tokens:z.number().int().positive()}).passthrough().parse(override);if(tier.min_prompt_tokens<=value.maxInputTokens)throw failure();}}
  const requestPrice=item.pricing.request;if(requestPrice!==undefined&&Number(requestPrice)!==0)throw failure();
  rates[id]=modelRateSchema.parse({provider:'openrouter',model:id,input:price('prompt'),output:price('completion'),cacheRead:price('input_cache_read'),cacheWrite:price('input_cache_write'),cacheWriteHour:price('input_cache_write_1h'),usdXaf:fx.sell,overheadXaf:0,fundingFeeBps,verifiedAt:new Date(now).toISOString(),pricingSource:MODEL_SOURCE,fxSource:fx.source,fxValueDate:fx.date,conversionBasis:fx.basis,fundingBasis:'separate_company_expense',meteringBasis:'inference_credits',maxInputTokens:value.maxInputTokens});
 }
 return {checkedAt:now,expiresAt:now+VALID_MS,modelSource:MODEL_SOURCE,fxSource:fx.source,fxValueDate:fx.date,fxSell:fx.sell,fundingBasis:'separate_company_expense',rates};
}
function validateQuote(raw:unknown,value:Policy,now:number){const quote=quoteSchema.parse(raw),fxAge=now-Date.parse(quote.fxValueDate+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(quote.fxValueDate)||!Number.isFinite(fxAge)||fxAge<0||fxAge>7*VALID_MS||quote.fxSell<100||quote.fxSell>2000||quote.checkedAt>now||quote.expiresAt<=now||quote.expiresAt-quote.checkedAt!==VALID_MS||Object.keys(quote.rates).length!==value.models.length)throw failure();for(const id of value.models){const rate=quote.rates[id];if(!rate||rate.model!==id||rate.provider!=='openrouter'||Date.parse(rate.verifiedAt)!==quote.checkedAt||rate.usdXaf!==quote.fxSell||rate.overheadXaf!==0||rate.fundingFeeBps!==0||rate.maxInputTokens!==value.maxInputTokens||rate.pricingSource!==MODEL_SOURCE||rate.fxSource!==quote.fxSource||rate.fxValueDate!==quote.fxValueDate||rate.conversionBasis!==(quote.fxSource===FX_SOURCE?'beac_sell_reference':'ecb_eur_peg_reference')||rate.fundingBasis!=='separate_company_expense'||rate.meteringBasis!=='inference_credits')throw failure();}return quote;}
// BEAC first; if its page is down, the ECB euro-peg reference (lib/fx-fallback.mjs).
async function readFx(now:number):Promise<FxReference>{const fx=await fxReference((url:string)=>readPublic(url,2000000),(html:string,at:number)=>({...parseBeacReference(html,at),source:FX_SOURCE,basis:'beac_sell_reference'}),now) as {date?:string;sell?:number;usdXaf?:number;fxValueDate?:string;source?:string;basis?:string};return fx.source===FX_SOURCE?fx as FxReference:{date:String(fx.fxValueDate),sell:Number(fx.usdXaf),source:ECB_REFERENCE_URL,basis:'ecb_eur_peg_reference'};}
async function readPublic(url:string,maxBytes:number){const response=await fetch(url,{redirect:'manual',headers:{Accept:url===MODEL_SOURCE?'application/json':'text/html, application/xml'},signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body)throw failure();const reader=response.body.getReader(),decoder=new TextDecoder();let length=0,text='';try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>maxBytes)throw failure();text+=decoder.decode(part.value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}}
export async function ensureModelPricing(now=Date.now(),allowRefresh=true){
 const selected=policy();if(!selected)return;
 if(memory?.policy===selected.raw&&memory.quote.expiresAt>now&&now>=memory.loadedAt&&now-memory.loadedAt<300000&&(!allowRefresh||now-memory.quote.checkedAt<REFRESH_MS||now<(memory.retryAfter||0))){validateQuote(memory.quote,selected.value,now);return;}
 if(allowRefresh&&pending?.policy===selected.raw)return pending.work;
 const work=(async()=>{const database=settings().DB;if(!database)throw failure();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(selected.raw)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const stored=await database.prepare('SELECT quote FROM model_pricing_snapshots WHERE policy_hash=?').bind(hash).first<{quote:string}>();let previous:Quote|undefined;
  if(stored)try{previous=validateQuote(JSON.parse(stored.quote),selected.value,now);}catch{/* Invalid snapshots never become new verification evidence. */}
  if(previous&&(now-previous.checkedAt<REFRESH_MS||!allowRefresh)){memory={policy:selected.raw,quote:previous,loadedAt:now};return;}
  if(!allowRefresh)throw failure();
  try{const [catalog,fx]=await Promise.all([readPublic(MODEL_SOURCE,8000000),readFx(now)]),quote=buildPricingQuote(selected.value,JSON.parse(catalog),fx,now);
   await database.prepare('INSERT INTO model_pricing_snapshots(policy_hash,quote,checked_at,expires_at) VALUES (?,?,?,?) ON CONFLICT(policy_hash) DO UPDATE SET quote=excluded.quote,checked_at=excluded.checked_at,expires_at=excluded.expires_at WHERE excluded.checked_at>=model_pricing_snapshots.checked_at').bind(hash,JSON.stringify(quote),quote.checkedAt,quote.expiresAt).run();memory={policy:selected.raw,quote,loadedAt:now};
  }catch{if(previous){memory={policy:selected.raw,quote:previous,loadedAt:now,retryAfter:now+300000};return;}memory=undefined;throw failure();}
 })();if(!allowRefresh){await work;return;}pending={policy:selected.raw,work};try{await work;}finally{if(pending?.work===work)pending=undefined;}
}
export function currentPricingRate(model:string,provider:string,now=Date.now()):ModelRate|undefined{
 const selected=policy();if(!selected||provider!=='openrouter')return;
 if(memory?.policy!==selected.raw||!memory.quote.rates[model])throw failure();return validateQuote(memory.quote,selected.value,now).rates[model];
}
