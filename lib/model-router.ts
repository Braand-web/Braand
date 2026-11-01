import {z} from 'zod';
import {currentPricingRate} from './model-pricing';
import {modelRateEnvironment} from './model-rate-refresh';
import {AppError} from './core.mjs';
import {modelRateSchema,type ModelRate} from './model-protocol';

export const MODEL_TASKS=['conversation','orchestration','creative','campaigns','extraction','analysis','review','browser','video_motion'] as const;
export type ModelTask=typeof MODEL_TASKS[number];
export const MODEL_TIERS=['light','standard','advanced'] as const;
export type ModelTier=typeof MODEL_TIERS[number];
export type RoutingRequest={task:ModelTask;tier?:ModelTier;escalation?:{reason:'validation_failed'|'contradictory_evidence'|'incomplete_result';attempt:1}};
export const REASONING_MODELS={
 sol:{provider:'openai',model:'gpt-6.1-sol'},
 haiku:{provider:'anthropic',model:'claude-haiku-5-5'},
 sonnet:{provider:'anthropic',model:'claude-sonnet-5-5'},
 astra:{provider:'openai',model:'gpt-6-astra'},
 opus:{provider:'anthropic',model:'claude-opus-5-5'},
} as const;
type ModelKey=keyof typeof REASONING_MODELS;
const taskModel:Record<ModelTask,ModelKey>={conversation:'sol',orchestration:'sol',creative:'sonnet',campaigns:'sonnet',extraction:'haiku',analysis:'astra',review:'opus',browser:'sonnet',video_motion:'opus'};
const adaptiveTaskModel:Record<ModelTask,ModelKey>={conversation:'haiku',orchestration:'sonnet',creative:'sonnet',campaigns:'sonnet',extraction:'haiku',analysis:'opus',review:'opus',browser:'sonnet',video_motion:'opus'};
const tierModel:Record<ModelTier,ModelKey>={light:'haiku',standard:'sonnet',advanced:'opus'};
const openRouterModels:Partial<Record<ModelKey,string>>={haiku:'anthropic/claude-haiku-5.5',sonnet:'anthropic/claude-sonnet-5.5',opus:'anthropic/claude-opus-5.5'};
const routingSchema=z.object({task:z.enum(MODEL_TASKS),tier:z.enum(MODEL_TIERS).optional(),escalation:z.object({reason:z.enum(['validation_failed','contradictory_evidence','incomplete_result']),attempt:z.literal(1)}).strict().optional()}).strict();
const entrySchema=z.object({enabled:z.literal(true),transport:z.enum(['openai','anthropic','openrouter']).optional(),rate:modelRateSchema,maxInputTokens:z.number().int().min(1).max(100000),maxOutputTokens:z.number().int().min(128).max(32768)}).strict();
export type RoutedModel={key:ModelKey;provider:'openai'|'anthropic'|'openrouter';model:string;rate:ModelRate;maxInputTokens:number;maxOutputTokens:number;apiKey:string;url:string;headers:Record<string,string>;routing:RoutingRequest};
export function routingEnabled(env:Record<string,string|undefined>){return env.MODEL_ROUTING_ENABLED==='true';}
export function routingReadiness(env:Record<string,string|undefined>){
 const enabled=routingEnabled(env),adaptive=enabled&&env.MODEL_ROUTING_POLICY==='adaptive';
 const tiers=Object.fromEntries(MODEL_TIERS.map(tier=>{if(!adaptive)return [tier,false];try{routedModel(env,{task:'conversation',tier});return [tier,true];}catch{return [tier,false];}}));
 return {enabled,policy:adaptive?'adaptive':enabled?'task':'default',tiers};
}
// Selection accepts a server-owned task, never user text, a model name, URL or key.
// One identified validation problem permits one higher-capability attempt. It is
// not an automatic retry policy, especially after a tool has changed a service.
export function routedModel(env:Record<string,string|undefined>,request:RoutingRequest={task:'conversation'},now=Date.now()):RoutedModel{
 env=modelRateEnvironment(env,now);
 const decision=routingSchema.safeParse(request);if(!decision.success)throw new AppError('Contexte de routage invalide.',400,'model_route_invalid');
 const adaptive=env.MODEL_ROUTING_POLICY==='adaptive';
 const {task,tier,escalation}=decision.data;let key=task==='video_motion'?'opus':adaptive&&tier?tierModel[tier]:(adaptive?adaptiveTaskModel:taskModel)[task];
 if(escalation){if(key==='astra'||key==='opus')throw new AppError('La limite de montée en gamme est atteinte.',409,'model_escalation_limit');key=adaptive?(key==='haiku'?'sonnet':'opus'):'astra';}
 let catalog:unknown;try{catalog=JSON.parse(env.MODEL_ROUTING_CATALOG_JSON||'{}');}catch{throw new AppError('Catalogue IA invalide.',503,'model_not_configured');}
 const entries=z.record(z.unknown()).safeParse(catalog),parsed=entrySchema.safeParse(entries.success?entries.data[key]:undefined);
 if(!parsed.success)throw new AppError('Le modèle requis et son tarif doivent être configurés.',503,'rate_unverified');
 const definition=REASONING_MODELS[key],entry=parsed.data,provider=entry.transport||definition.provider,model=provider==='openrouter'?openRouterModels[key]:definition.model;
 if(model)entry.rate=currentPricingRate(model,provider,now)||entry.rate;
 const age=now-Date.parse(entry.rate.verifiedAt);
 if(!model||provider!=='openrouter'&&provider!==definition.provider||entry.rate.model!==model||entry.rate.provider&&entry.rate.provider!==provider||!Number.isFinite(age)||age<0||age>86400000||provider==='openrouter'&&(typeof entry.rate.fundingFeeBps!=='number'||!Number.isFinite(entry.rate.fundingFeeBps)||entry.rate.fundingFeeBps<0||entry.rate.fundingFeeBps>10000))throw new AppError('Le tarif exact du modèle et le taux de change doivent être vérifiés.',503,'rate_unverified');
 const apiKey=env[provider==='openrouter'?'OPENROUTER_API_KEY':provider==='openai'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY']?.trim();if(!apiKey)throw new AppError('Le fournisseur IA requis n’est pas configuré sur le serveur.',503,'model_not_configured');
 const headers:Record<string,string>=provider==='openai'?{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'}:provider==='openrouter'?{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json','X-OpenRouter-Metadata':'enabled'}:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json'};
 return {key,provider,model,rate:{...entry.rate,provider},maxInputTokens:Math.min(entry.maxInputTokens,typeof entry.rate.maxInputTokens==='number'?entry.rate.maxInputTokens:entry.maxInputTokens),maxOutputTokens:entry.maxOutputTokens,apiKey,url:provider==='openai'?'https://api.openai.com/v1/responses':provider==='openrouter'?'https://openrouter.ai/api/v1/messages':'https://api.anthropic.com/v1/messages',headers,routing:decision.data};
}
