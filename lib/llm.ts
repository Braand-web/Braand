import {config} from './server';
import {AppError} from './core.mjs';
import {z} from 'zod';
import {modelRateSchema,type ModelRate,type ModelCostRow} from './model-protocol';
export function modelConnection(){
 const c=config(),provider=c.LLM_PROVIDER||(c.OPENROUTER_API_KEY?'openrouter':'anthropic');
 if(provider!=='anthropic'&&provider!=='openrouter')throw new AppError('Fournisseur IA invalide.',503,'model_not_configured');
 const openrouter=provider==='openrouter',key=(openrouter?c.OPENROUTER_API_KEY:c.ANTHROPIC_API_KEY)?.trim();
 const headers:Record<string,string>=openrouter?{'Authorization':'Bearer '+(key||''),'Content-Type':'application/json','X-OpenRouter-Metadata':'enabled'}:{'x-api-key':key||'','anthropic-version':'2023-06-01','Content-Type':'application/json'};
 return {provider,model:openrouter?(c.OPENROUTER_MODEL||'anthropic/claude-opus-5.5'):(c.ANTHROPIC_MODEL||'claude-opus-5-5'),key,
  url:openrouter?'https://openrouter.ai/api/v1/messages':'https://api.anthropic.com/v1/messages',
  headers,
  rateKey:openrouter?'OPENROUTER_RATE_JSON':'ANTHROPIC_RATE_JSON'};
}
export function requireModel(){const model=modelConnection();if(!model.key)throw new AppError('Ajoutez la clé '+(model.provider==='openrouter'?'OpenRouter':'Anthropic')+' dans les secrets de l’hébergement pour activer Braand. Votre brouillon est conservé.',503,'model_not_configured');return model;}
export function modelRequest(body:Record<string,unknown>,signal:AbortSignal){
 const m=requireModel();return {url:m.url,init:{method:'POST',headers:m.headers,body:JSON.stringify({...body,model:m.model,...(m.provider==='openrouter'?{provider:{require_parameters:true,allow_fallbacks:false}}:{})}),signal} satisfies RequestInit};
}
// OpenRouter has no documented Anthropic count_tokens endpoint. Use a generous
// byte-based estimate plus separate headroom in metering; this is not a vendor quote.
export function estimateInputTokens(body:Record<string,unknown>){
 const copy=structuredClone({messages:body.messages,system:body.system,tools:body.tools});let images=0;
 const visit=(value:unknown):unknown=>{if(Array.isArray(value))return value.map(visit);if(value&&typeof value==='object'){
  if('type' in value&&value.type==='image'){images++;return {type:'image',source:'[image counted separately]'};}
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)]));}return value;};
 return Math.ceil(new TextEncoder().encode(JSON.stringify(visit(copy))).length/2)+512+images*16384;
}
export function requestCostUnits(row:ModelCostRow,rate:ModelRate,usageUnits:(usage:unknown,rate:ModelRate)=>{units:number}){
 // A shared hold may contain several models. Never value a prior call using the
 // model selected for the next call, browser session or reconciliation worker.
 if(row.rate)rate=modelRateSchema.parse(JSON.parse(row.rate));
 if(rate.provider&&rate.provider!==row.provider)throw new AppError('Le tarif enregistré ne correspond pas au fournisseur.',409,'usage_unknown');
 if(row.provider==='openrouter'){
  if(row.status==='estimated')return Math.ceil(usageUnits(JSON.parse(row.usage||'null'),rate).units*(1+Number(rate.fundingFeeBps)/10000));
  if(typeof row.cost_xaf!=='number'||!Number.isFinite(row.cost_xaf)||row.cost_xaf<0)throw new AppError('Coût OpenRouter à rapprocher.',409,'usage_unknown');
  return Math.ceil(row.cost_xaf/4*100);
 }
 return usageUnits(JSON.parse(row.usage||'null'),rate).units;
}
export async function generationCost(id:string,rate:ModelRate,options?:{requireFinal?:boolean}){
 const key=config().OPENROUTER_API_KEY;if(!key||!/^gen-[a-zA-Z0-9_-]+$/.test(id))throw new AppError('Identifiant OpenRouter manquant.',409,'usage_unknown');
 const response=await fetch('https://openrouter.ai/api/v1/generation?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(8000)});
 if(!response.ok){await response.body?.cancel().catch(()=>undefined);throw new AppError('Coût OpenRouter temporairement indisponible.',409,'usage_unknown');}
 const receipt=z.object({data:z.object({id:z.string(),total_cost:z.number().finite().nonnegative(),provider_name:z.string().nullable().optional()}).passthrough()}).safeParse(await response.json());
 if(!receipt.success||receipt.data.data.id!==id)throw new AppError('Coût OpenRouter non confirmé.',409,'usage_unknown');
 const {data}=receipt.data;
 if(options?.requireFinal&&data.cancelled!==true&&(typeof data.finish_reason!=='string'||!data.finish_reason.trim()))throw new AppError('Le reçu fournisseur n’est pas encore final.',409,'usage_unknown');
 return {usd:data.total_cost,xaf:data.total_cost*rate.usdXaf*(1+Number(rate.fundingFeeBps)/10000)+rate.overheadXaf,provider:data.provider_name||null};
}
