// fal.ai model discovery and the administrator-approved runtime catalog.
// Agents can search the whole fal catalog and request a model; it becomes
// usable only after an operations administrator approves it with bounded
// inputs. Approved models are repriced from fal's pricing API like the
// configured catalog, and fail closed when the price is older than a day.
import {z} from 'zod';
import {AppError} from './core.mjs';
import {FX_REFERENCE_URL,parseBEACReference} from './model-rate-sources.mjs';
import {FAL_PRICE_URL} from './fal-rate-refresh';
import {MEDIA_TASKS} from './media-routing.mjs';

type Bucket={get(key:string):Promise<{text():Promise<string>;size:number}|null>;put(key:string,value:string):Promise<unknown>};
type Bindings=Record<string,unknown>&{BUCKET?:Bucket;FAL_KEY?:string};
const STORE='internal/fal-approved-models.json',DAY=86400000,REPRICE=6*3600000,RELOAD=300000;
const FAL_MODELS_URL='https://api.fal.ai/v1/models';

const quoteSchema=z.object({credits:z.number().int().positive().max(1000),costCeilingXaf:z.number().positive(),unitPrice:z.number().positive(),verifiedAt:z.string().datetime(),fxValueDate:z.string().optional()});
export const approvedModelSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9/._-]{1,180}$/),name:z.string().min(1).max(120),kind:z.enum(['image','video','audio']),
 tasks:z.array(z.string().refine(task=>Object.hasOwn(MEDIA_TASKS,task),'Tâche inconnue')).min(1).max(7),
 description:z.string().max(600).default(''),
 unit:z.enum(['megapixels','seconds','1000 characters','images','videos','units']),maxUnits:z.number().positive().max(10000),
 inputSchema:z.object({type:z.literal('object'),additionalProperties:z.literal(false),required:z.array(z.string()),properties:z.record(z.record(z.unknown()))}).passthrough(),
 approvedAt:z.string().datetime(),approvedBy:z.string().max(160),quote:quoteSchema.optional(),
});
export type ApprovedModel=z.infer<typeof approvedModelSchema>;
const storeSchema=z.object({version:z.literal(1),items:z.array(approvedModelSchema).max(40)});

let cache:{items:ApprovedModel[];loadedAt:number;inFlight?:Promise<void>}={items:[],loadedAt:0};

/** Approved models with a current price, in the catalog item shape. */
export function approvedCatalogItems(now=Date.now()){
 return cache.items.filter(item=>item.quote&&now-Date.parse(item.quote.verifiedAt)<=DAY).map(item=>({id:item.id,name:item.name,kind:item.kind,credits:item.quote!.credits,costCeilingXaf:item.quote!.costCeilingXaf,verifiedAt:item.quote!.verifiedAt,inputSchema:item.inputSchema,description:item.description||item.name,tasks:item.tasks,priority:500}));
}
export function approvedModels(){return cache.items;}

async function readText(url:string,headers:Record<string,string>,maxBytes=2000000){
 const response=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await response.body?.cancel();throw new AppError('Source fal indisponible.',502,'fal_source_unavailable');}
 const text=await response.text();if(text.length>maxBytes)throw new AppError('Réponse fal trop volumineuse.',502);return text;
}

/** Price a list of models from fal's pricing API and the BEAC reference rate. */
export async function priceModels(key:string,items:Pick<ApprovedModel,'id'|'unit'|'maxUnits'>[],now=Date.now()){
 if(!items.length)return new Map<string,z.infer<typeof quoteSchema>>();
 const url=new URL(FAL_PRICE_URL);for(const item of items)url.searchParams.append('endpoint_id',item.id);
 const [priceText,fxText]=await Promise.all([readText(url.href,{Authorization:'Key '+key},262144),readText(FX_REFERENCE_URL,{Accept:'text/html'})]);
 const raw=JSON.parse(priceText) as unknown,rows=z.array(z.object({endpoint_id:z.string(),unit_price:z.number().finite().positive(),unit:z.string(),currency:z.string()})).parse(Array.isArray(raw)?raw:(raw as {prices?:unknown}).prices);
 const fx=parseBEACReference(fxText,now) as {usdXaf:number;fxValueDate:string};
 if(!Number.isFinite(fx.usdXaf)||fx.usdXaf<50||fx.usdXaf>5000)throw new AppError('Taux de change invalide.',502);
 const quotes=new Map<string,z.infer<typeof quoteSchema>>();
 for(const item of items){
  const row=rows.find(r=>r.endpoint_id===item.id);if(!row||row.currency!=='USD')continue;
  if(['megapixels','seconds','1000 characters'].includes(item.unit)&&row.unit!==item.unit)continue;
  const cost=row.unit_price*item.maxUnits*fx.usdXaf,credits=Math.max(1,Math.ceil(cost/4));
  if(!Number.isFinite(cost)||credits>1000)continue;
  quotes.set(item.id,{credits,costCeilingXaf:cost,unitPrice:row.unit_price,verifiedAt:new Date(now).toISOString(),fxValueDate:fx.fxValueDate});
 }
 return quotes;
}

async function load(env:Bindings){const saved=await env.BUCKET?.get(STORE);if(!saved||saved.size>262144)return [] as ApprovedModel[];return storeSchema.parse(JSON.parse(await saved.text())).items;}
async function store(env:Bindings,items:ApprovedModel[]){if(!env.BUCKET)throw new AppError('Stockage indisponible.',503);await env.BUCKET.put(STORE,JSON.stringify({version:1,items}));cache={items,loadedAt:Date.now()};}

/** Load approved models and refresh stale prices. Never throws into the request path. */
export async function ensureApprovedFalModels(env:Bindings,now=Date.now()){
 if(cache.inFlight){await cache.inFlight;return;}
 const stale=cache.items.some(item=>!item.quote||now-Date.parse(item.quote.verifiedAt)>REPRICE);
 if(now-cache.loadedAt<RELOAD&&!stale)return;
 cache.inFlight=(async()=>{
  try{
   const items=await load(env);cache={items,loadedAt:now};
   const toPrice=items.filter(item=>!item.quote||now-Date.parse(item.quote.verifiedAt)>REPRICE);
   if(toPrice.length&&env.FAL_KEY){const quotes=await priceModels(String(env.FAL_KEY),toPrice,now);if(quotes.size){const next=items.map(item=>quotes.has(item.id)?{...item,quote:quotes.get(item.id)}:item);await store(env,next);}}
  }catch{cache.loadedAt=now;/* Stale prices fail closed through approvedCatalogItems. */}
 })().finally(()=>{cache.inFlight=undefined;});
 await cache.inFlight;
}

/** Search fal's public model catalog, with current prices when available. */
export async function searchFalModels(key:string|undefined,query:string,category?:string){
 if(!key)throw new AppError('fal.ai n’est pas configuré.',503,'fal_not_ready');
 const url=new URL(FAL_MODELS_URL);url.searchParams.set('q',query.slice(0,120));url.searchParams.set('limit','12');if(category)url.searchParams.set('category',category);
 const raw=JSON.parse(await readText(url.href,{Authorization:'Key '+key},1000000)) as Record<string,unknown>;
 const list=z.array(z.object({endpoint_id:z.string(),metadata:z.object({display_name:z.string().optional(),category:z.string().optional(),description:z.string().optional(),status:z.string().optional()}).passthrough().optional()}).passthrough()).parse(raw.models??raw.items??[]);
 const models=list.slice(0,12).map(model=>({id:model.endpoint_id,name:model.metadata?.display_name||model.endpoint_id,category:model.metadata?.category,description:(model.metadata?.description||'').slice(0,300),status:model.metadata?.status}));
 let prices:Record<string,{unitPrice:number;unit:string}>={};
 try{
  const priceUrl=new URL(FAL_PRICE_URL);for(const model of models)priceUrl.searchParams.append('endpoint_id',model.id);
  const priced=JSON.parse(await readText(priceUrl.href,{Authorization:'Key '+key},262144)) as unknown;
  const rows=z.array(z.object({endpoint_id:z.string(),unit_price:z.number(),unit:z.string()}).passthrough()).parse(Array.isArray(priced)?priced:(priced as {prices?:unknown}).prices);
  prices=Object.fromEntries(rows.map(row=>[row.endpoint_id,{unitPrice:row.unit_price,unit:row.unit}]));
 }catch{/* Prices are informative here; approval reprices. */}
 const approved=new Set(cache.items.map(item=>item.id));
 return models.map(model=>({...model,priceUsd:prices[model.id]?.unitPrice,priceUnit:prices[model.id]?.unit,approved:approved.has(model.id)}));
}

/** Administrator approval: price immediately and store. */
export async function approveFalModel(env:Bindings,adminId:string,raw:unknown){
 const item=approvedModelSchema.omit({approvedAt:true,approvedBy:true,quote:true}).parse(raw);
 if(!env.FAL_KEY)throw new AppError('fal.ai n’est pas configuré.',503);
 const quote=(await priceModels(String(env.FAL_KEY),[item])).get(item.id);
 if(!quote)throw new AppError('Prix introuvable ou unité différente chez fal pour ce modèle. Vérifiez l’unité et le maximum.',409,'fal_price_unavailable');
 const items=(await load(env)).filter(existing=>existing.id!==item.id);
 if(items.length>=40)throw new AppError('Catalogue complet (40 modèles). Retirez un modèle d’abord.',409);
 const approved={...item,approvedAt:new Date().toISOString(),approvedBy:adminId,quote};
 await store(env,[...items,approved]);return approved;
}
export async function removeFalModel(env:Bindings,id:string){const items=await load(env);await store(env,items.filter(item=>item.id!==id));}
