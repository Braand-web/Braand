// Adaptive "brain" enabled by default, without extra Worker variables (the
// Worker is at its 64-variable limit). The catalog is derived from the current
// OpenRouter tariff: same Braand fees and sources, one entry per level —
// light Haiku 5.5, standard Sonnet 5.5, advanced Opus 5.5 and an optional
// read-only Fable 5.2 advisor. Sonnet, Opus and Fable
// start with an expired verification date, so they can never be billed before
// the live OpenRouter price refresh confirms their real cost. Explicit
// MODEL_ROUTING_* variables always win (rollback without code).
import {modelRateSchema} from './model-protocol';

export const ADAPTIVE_BRAIN_DEFAULT=true;
const LEVELS={haiku:'anthropic/claude-haiku-5.5',sonnet:'anthropic/claude-sonnet-5.5',opus:'anthropic/claude-opus-5.5',fable52:'anthropic/claude-fable-5.2'} as const;
const cache=new Map<string,string>();

export function withRoutingDefaults<T extends object>(env:T):T{
 const values=env as Record<string,unknown>;
 if(!ADAPTIVE_BRAIN_DEFAULT||values.MODEL_ROUTING_ENABLED!==undefined||typeof values.OPENROUTER_API_KEY!=='string'||!values.OPENROUTER_API_KEY||typeof values.OPENROUTER_RATE_JSON!=='string')return env;
 if(values.LLM_PROVIDER&&values.LLM_PROVIDER!=='openrouter')return env;
 const raw=values.OPENROUTER_RATE_JSON;let catalog=cache.get(raw);
 if(!catalog){
  const parsed=modelRateSchema.safeParse((()=>{try{return JSON.parse(raw);}catch{return null;}})());
  if(!parsed.success||parsed.data.provider&&parsed.data.provider!=='openrouter')return env;
  const base=parsed.data,maxInputTokens=Math.min(100000,typeof base.maxInputTokens==='number'?base.maxInputTokens:90000);
  catalog=JSON.stringify(Object.fromEntries(Object.entries(LEVELS).map(([key,model])=>[key,{enabled:true,transport:'openrouter',maxInputTokens,maxOutputTokens:8192,
   rate:model===base.model?base:{...base,model,verifiedAt:'1970-01-01T00:00:00.000Z'}}])));
  cache.set(raw,catalog);
 }
 return {...env,MODEL_ROUTING_ENABLED:'true',MODEL_ROUTING_POLICY:typeof values.MODEL_ROUTING_POLICY==='string'?values.MODEL_ROUTING_POLICY:'adaptive',MODEL_ROUTING_CATALOG_JSON:catalog} as T;
}
