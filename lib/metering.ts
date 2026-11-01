import {db,config,uid,authorize} from './server';
import {AppError,parseSSE} from './core.mjs';
import {reserve,settleHold,type BillingIdentity} from './billing';
import {usageUnits} from './billing-core.mjs';
import {modelConnection,modelRequest,estimateInputTokens,requestCostUnits,generationCost} from './llm';
import {modelRateSchema,modelRecordSchema,modelEventSchema,type ModelRate,type ModelCostRow,type ModelUsage} from './model-protocol';
import {routingEnabled,routedModel,REASONING_MODELS,type RoutingRequest,type RoutedModel} from './model-router';
import {routedRequest,normalizedResponses,anthropicBody} from './model-client';
import {ensureModelPricing,currentPricingRate} from './model-pricing';
import {toolUsage} from './tool-usage';
export type {ModelRate} from './model-protocol';
export type RunBudget={who:BillingIdentity;holdId:string;limit:number;runId:string;rate:ModelRate;videoMotionPreferred?:boolean;workId?:string;workStepId?:string;workContext?:string;beforeTool?:()=>Promise<void>;beforeModel?:()=>Promise<void>};
export type RunSettlementBudget=Pick<RunBudget,'runId'|'holdId'>&{rate?:ModelRate};
type ReconciliationUsage=ModelCostRow&{id:string;rate:string;request_id:string;run_id:string;hold_id:string};
type ModelRateIssue='missing_rate'|'invalid_rate'|'invalid_verified_at'|'future_rate'|'stale_rate'|'model_mismatch'|'funding_fee_unverified';
const rateIssueMessages:Record<ModelRateIssue,string>={
 missing_rate:'La configuration des coûts de Braand est incomplète. Votre demande est conservée ; réessayez après sa vérification.',
 invalid_rate:'La configuration des coûts de Braand est invalide. Votre demande est conservée ; réessayez après sa correction.',
 invalid_verified_at:'La date de vérification des coûts est invalide. Votre demande est conservée ; une nouvelle vérification est nécessaire.',
 future_rate:'La date de vérification des coûts est incohérente. Votre demande est conservée ; une nouvelle vérification est nécessaire.',
 stale_rate:'La vérification des tarifs et du taux de change a expiré. Votre demande est conservée ; réessayez après leur actualisation.',
 model_mismatch:'La configuration des coûts ne correspond pas au modèle actif. Votre demande est conservée ; une vérification est nécessaire.',
 funding_fee_unverified:'Les frais liés au modèle ne sont pas vérifiés. Votre demande est conservée ; une vérification est nécessaire.'
};
function inspectConfiguredRate(connection:ReturnType<typeof modelConnection>):{rate?:ModelRate;issue?:ModelRateIssue}{
 const raw=config()[connection.rateKey];if(!raw)return {issue:'missing_rate'};
 let value:unknown;try{value=JSON.parse(raw);}catch{return {issue:'invalid_rate'};}
 const parsed=modelRateSchema.safeParse(value);if(!parsed.success)return {issue:'invalid_rate'};
 const rate=parsed.data,verifiedAt=Date.parse(rate.verifiedAt),age=Date.now()-verifiedAt;
 if(!Number.isFinite(verifiedAt))return {issue:'invalid_verified_at'};
 if(age<0)return {issue:'future_rate'};
 if(age>86400000)return {issue:'stale_rate'};
 if(rate.model!==connection.model)return {issue:'model_mismatch'};
 if(connection.provider==='openrouter'&&(typeof rate.fundingFeeBps!=='number'||!Number.isFinite(rate.fundingFeeBps)||rate.fundingFeeBps<0||rate.fundingFeeBps>10000))return {issue:'funding_fee_unverified'};
 return {rate:{...rate,provider:connection.provider}};
}
export function modelRate(routing:RoutingRequest={task:'conversation'}){
 if(routingEnabled(config()))return routedModel(config(),routing).rate;
 const connection=modelConnection(),current=currentPricingRate(connection.model,connection.provider);if(current)return current;
 const result=inspectConfiguredRate(connection);
 if(result.issue)throw new AppError(rateIssueMessages[result.issue],503,'rate_unverified');
 return result.rate!;
}
export function modelReadiness(){
 if(routingEnabled(config())){try{modelRate();return {ready:true,reason:null,detail:null};}catch(error){return {ready:false,reason:error instanceof AppError&&error.code==='model_not_configured'?'missing_key':'rate_unverified',detail:'routing_catalog'};}}
 const connection=modelConnection();
 if(!connection.key)return {ready:false,reason:'missing_key',detail:null};
 try{if(currentPricingRate(connection.model,connection.provider))return {ready:true,reason:null,detail:null};}catch{return {ready:false,reason:'rate_unverified',detail:'snapshot_unavailable'};}
 const result=inspectConfiguredRate(connection);
 return result.issue?{ready:false,reason:result.issue==='invalid_rate'?'rate_invalid':'rate_unverified',detail:result.issue}:{ready:true,reason:null,detail:null};
}
export async function startRunBudget(who:BillingIdentity,runId:string,credits:number):Promise<RunBudget>{
 await ensureModelPricing();
 await reconcileOpenRouterUsage(who.organization,5);
 const rate=modelRate();const hold=await reserve(who,'chat:'+runId,Math.round(credits*100),{upToAvailable:true});return {who,holdId:hold.id,limit:hold.units,runId,rate};
}
export async function finishRunBudget(b:RunSettlementBudget){
 const auxiliary=await toolUsage(b.holdId);
 const browser=await (await import('./browser')).browserUsageUnits(b.holdId);
 if(browser.active)return;
 const run=await db().prepare('SELECT status,conversation_id,created_at FROM runs WHERE id=?').bind(b.runId).first<{status:string;conversation_id:string;created_at:number}>();
 const rows=await db().prepare('SELECT usage,status,provider,cost_xaf,rate FROM provider_usage WHERE run_id=? AND hold_id=?').bind(b.runId,b.holdId).all<ModelCostRow>();
 const delivered=run&&await db().prepare("SELECT 1 delivered FROM messages m,json_each(m.content) block WHERE m.conversation_id=? AND m.role='assistant' AND m.created_at>=? AND json_extract(block.value,'$.type')='text' AND length(trim(COALESCE(json_extract(block.value,'$.text'),'')))>0 UNION ALL SELECT 1 FROM events WHERE run_id=? AND type='tool_result' AND json_extract(data,'$.result.id') IS NOT NULL AND json_extract(data,'$.result.kind') IS NOT NULL UNION ALL SELECT 1 FROM events WHERE run_id=? AND type='text_delta' AND length(trim(COALESCE(json_extract(data,'$.text'),'')))>0 LIMIT 1").bind(run.conversation_id,run.created_at,b.runId,b.runId).first();
 const unresolved=auxiliary.unresolved||browser.unresolved||rows.results.some(r=>['pending','unknown','estimated'].includes(r.status));
 if(run?.status==='failed'&&!delivered&&!unresolved&&browser.units===0&&auxiliary.units===0){await settleHold(b.holdId,0);return;}
 if(unresolved){await db().prepare("UPDATE credit_holds SET status='needs_reconciliation' WHERE id=? AND status='reserved'").bind(b.holdId).run();return;}
 let units=browser.units+auxiliary.units;for(const row of rows.results)if(row.status==='complete'){const rate=row.rate?modelRateSchema.parse(JSON.parse(row.rate)):b.rate;if(!rate)throw new AppError('Le tarif enregistré est nécessaire au rapprochement.',409,'rate_missing');units+=requestCostUnits(row,rate,usageUnits);}
 await settleHold(b.holdId,units);
}
export async function meteredMessage(b:RunBudget,role:string,body:Record<string,unknown>,signal:AbortSignal,routing:RoutingRequest={task:'conversation'}){
 await b.beforeModel?.();
 await ensureModelPricing();
 if(routingEnabled(config())){const selected=routedModel(config(),routing),request=routedRequest(selected,body,signal);return meteredModel(b,role,request.url,request.init,selected,body);}
 const request=modelRequest(body,signal);return meteredModel(b,role,request.url,request.init);
}
export async function reconcileOpenRouterUsage(organization?:string,limit=10){
 await (await import('./openrouter-research')).reconcileResearchUsage(organization,Math.min(limit,5));
 const rows=await db().prepare("SELECT p.* FROM provider_usage p WHERE p.provider='openrouter' AND (p.status IN ('estimated','unknown') OR (p.status='pending' AND EXISTS(SELECT 1 FROM runs r WHERE r.id=p.run_id AND r.status IN ('failed','partial','cancelled','completed')))) AND p.request_id IS NOT NULL"+(organization?' AND p.organization_id=?':'')+' ORDER BY p.created_at LIMIT ?').bind(...(organization?[organization,limit]:[limit])).all<ReconciliationUsage>();
 for(const row of rows.results){try{
  const previousUsage=modelRecordSchema.parse(JSON.parse(row.usage||'{}'));
  const rate=modelRateSchema.parse(JSON.parse(row.rate)),actual=await generationCost(row.request_id,rate,{requireFinal:row.status==='pending'||previousUsage.stream_complete!==true}),usage={...previousUsage,openrouter_cost_usd:actual.usd,routed_provider:actual.provider,cost_source:'generation'};
  await db().prepare("UPDATE provider_usage SET cost_xaf=?,usage=?,status='complete' WHERE id=? AND (status IN ('estimated','unknown') OR (status='pending' AND EXISTS(SELECT 1 FROM runs r WHERE r.id=provider_usage.run_id AND r.status IN ('failed','partial','cancelled','completed'))))").bind(actual.xaf,JSON.stringify(usage),row.id).run();
  const run=await db().prepare('SELECT status FROM runs WHERE id=?').bind(row.run_id).first<{status:string}>();
  if(run&&run.status!=='streaming')await finishRunBudget({runId:row.run_id,holdId:row.hold_id,rate});
 }catch{/* The real cost stays unresolved; never resubmit a generation. */}}
 // A worker can stop after recording the receipt, or after marking a run
 // cancelled, before its finally block settles the hold. Retry terminal holds
 // independently of whether a provider receipt still needs reconciliation.
 const stranded=await db().prepare("SELECT h.id,h.reference FROM credit_holds h LEFT JOIN runs r ON h.reference='chat:'||r.id WHERE h.reference LIKE 'chat:%' AND h.status IN ('reserved','needs_reconciliation') AND ((r.status IN ('failed','partial','cancelled','completed') AND r.updated_at<?) OR (r.id IS NULL AND h.created_at<?))"+(organization?' AND h.organization_id=?':'')+' ORDER BY h.created_at LIMIT ?').bind(...(organization?[Date.now()-30000,Date.now()-300000,organization,limit]:[Date.now()-30000,Date.now()-300000,limit])).all<{id:string;reference:string}>();
 for(const hold of stranded.results)try{await finishRunBudget({runId:hold.reference.slice(5),holdId:hold.id});}catch{/* Keep an unconfirmed cost reserved; the next tick retries without rerunning the agent. */}
 // A cancelled stream can outlive its finally block. Repair only old locks
 // with terminal runs; an active/new request must never be unlocked here.
 await db().prepare("UPDATE resources SET status='saved',updated_at=? WHERE id IN (SELECT c.id FROM resources c WHERE c.kind='conversation' AND c.status='streaming' AND c.updated_at<? AND EXISTS(SELECT 1 FROM runs r WHERE r.conversation_id=c.id AND r.workspace_id=c.workspace_id AND r.status IN ('completed','failed','partial','cancelled')) AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.conversation_id=c.id AND r.workspace_id=c.workspace_id AND r.status='streaming') LIMIT 50)").bind(Date.now(),Date.now()-300000).run();
 return {checked:rows.results.length};
}
export async function meteredModel(b:RunBudget,role:string,url:string,init:RequestInit,selected?:RoutedModel,originalBody?:Record<string,unknown>){
 const auxiliary=await toolUsage(b.holdId);
 if(auxiliary.unresolved)throw new AppError('Un coût d’outil attend un rapprochement.',409,'tool_usage_unknown');
 await authorize(b.who.tenant,b.who.user.userId,'write');
 const connection=selected||modelConnection(),rate=selected?.rate||b.rate,body=selected?(selected.provider!=='openai'?anthropicBody(originalBody||{},selected):{...originalBody,model:selected.model,stream:true}):modelRecordSchema.parse(JSON.parse(String(init.body))),countBody={model:body.model,messages:body.messages,system:body.system,tools:body.tools};
 if(url!==connection.url||body.model!==connection.model||!selected&&rate.provider&&rate.provider!==connection.provider)throw new AppError('Le fournisseur ou le modèle a changé. Relancez la demande.',409);
 let inputTokens:number;
 if(connection.provider==='openrouter'||connection.provider==='openai')inputTokens=estimateInputTokens(body);
 else{
  const counter=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',headers:init.headers,body:JSON.stringify(countBody),signal:init.signal});
  if(!counter.ok)throw new AppError('Impossible de vérifier le budget de contexte.',503);
  const count=modelRecordSchema.parse(await counter.json());if(typeof count.input_tokens!=='number'||!Number.isSafeInteger(count.input_tokens)||count.input_tokens<0)throw new AppError('Estimation du contexte indisponible.',503);inputTokens=count.input_tokens;
 }
 const maxInputTokens=selected?.maxInputTokens??(typeof rate.maxInputTokens==='number'?rate.maxInputTokens:undefined);
 if(maxInputTokens!==undefined&&Math.ceil(inputTokens*1.2)>maxInputTokens)throw new AppError('Le contexte dépasse le plafond vérifié du modèle. Réduisez le contexte avant de continuer.',402,'model_context_limit');
 const used=await db().prepare('SELECT usage,status,provider,cost_xaf,rate FROM provider_usage WHERE hold_id=?').bind(b.holdId).all<ModelCostRow>();
 if(selected?.routing.escalation&&used.results.some(row=>row.rate&&modelRecordSchema.parse(JSON.parse(row.rate)).escalation))throw new AppError('La montée en gamme a déjà été utilisée pour ce budget.',409,'model_escalation_limit');
 const browser=await (await import('./browser')).browserUsageUnits(b.holdId);
 if(browser.unresolved)throw new AppError('Un coût navigateur reste à rapprocher.',409,'browser_usage_unknown');
 if(used.results.some(x=>['pending','unknown'].includes(x.status)))throw new AppError('Un coût fournisseur reste à rapprocher.',409);
 const consumed=used.results.reduce((n,r)=>n+(['complete','estimated'].includes(r.status)?requestCostUnits(r,r.rate?modelRateSchema.parse(JSON.parse(r.rate)):b.rate,usageUnits):0),0);
 const funding=connection.provider==='openrouter'?1+Number(rate.fundingFeeBps)/10000:1;
 const requestedOutputTokens=Math.min(typeof body.max_tokens==='number'&&Number.isSafeInteger(body.max_tokens)&&body.max_tokens>0?body.max_tokens:4096,selected?.maxOutputTokens||32768);
 const ceilingFor=(tokens:number)=>Math.ceil(((Math.ceil(inputTokens*1.2)*Math.max(rate.input,rate.cacheWrite,rate.cacheWriteHour||0)+tokens*rate.output)/1e6*rate.usdXaf*funding+rate.overheadXaf)/4*100);
 const available=b.limit-consumed-browser.units-browser.reservedUnits-auxiliary.units;
 if(ceilingFor(1)>available)throw new AppError('Le plafond accepté ne couvre pas le contexte de cette demande. Réduisez le contexte ou augmentez le plafond avant de continuer.',402,'budget_exhausted');
 let low=1,high=requestedOutputTokens;
 while(low<high){const mid=Math.ceil((low+high)/2);if(ceilingFor(mid)<=available)low=mid;else high=mid-1;}
 if(low<Math.min(128,requestedOutputTokens))throw new AppError('Le plafond accepté est trop bas pour produire une réponse utile. Augmentez-le avant de continuer.',402,'budget_exhausted');
 body.max_tokens=low;
 const controller=new AbortController(),signal=init.signal?AbortSignal.any([init.signal,controller.signal,AbortSignal.timeout(120000)]):AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]);
 init=selected?routedRequest(selected,body,signal).init:{...init,body:JSON.stringify(body),signal};
 const id=uid(),claimed=await db().prepare("INSERT INTO provider_usage(id,organization_id,workspace_id,run_id,hold_id,provider,role,rate,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM provider_usage WHERE hold_id=? AND status IN ('pending','unknown')) AND (SELECT COUNT(*) FROM provider_usage WHERE hold_id=?)=? AND NOT EXISTS(SELECT 1 FROM agent_tool_usage WHERE hold_id=? AND status IN ('pending','unknown'))").bind(id,b.who.organization,b.who.tenant,b.runId,b.holdId,connection.provider,role,JSON.stringify({...rate,inputEstimate:inputTokens,inputMethod:connection.provider==='anthropic'?'anthropic_count_tokens':'conservative_estimate',...(selected?{routingTask:selected.routing.task,escalation:selected.routing.escalation}:{} )}),Date.now(),b.holdId,b.holdId,used.results.length,b.holdId).run();
 if(!claimed.meta.changes)throw new AppError('Le budget est utilisé par un autre appel ou attend un rapprochement.',409,'model_budget_busy');
 let response:Response;try{response=await fetch(url,init);}catch(error){await db().prepare("UPDATE provider_usage SET status='unknown' WHERE id=?").bind(id).run();throw error;}
 if(!response.ok||!response.body){await db().prepare("UPDATE provider_usage SET status=? WHERE id=?").bind(response.status>=500?'unknown':'rejected',id).run();return response;}
 let generationId=response.headers.get('x-generation-id');
 await db().prepare('UPDATE provider_usage SET request_id=? WHERE id=?').bind(connection.provider==='openrouter'?generationId:response.headers.get(connection.provider==='openai'?'x-request-id':'request-id'),id).run();
 const iterator=(selected?.provider==='openai'?normalizedResponses(response.body,selected):parseSSE(response.body))[Symbol.asyncIterator](),encoder=new TextEncoder();let usage:ModelUsage={},complete=false,finished=false;
 const save=async()=>{if(finished)return;finished=true;let cost:number|null=null,estimated=false;const streamComplete=complete;
 if(connection.provider==='openrouter'){
  try{const actual=await generationCost(generationId||'',rate,{requireFinal:!streamComplete});cost=actual.xaf;usage={...usage,openrouter_cost_usd:actual.usd,routed_provider:actual.provider,stream_complete:streamComplete,cost_source:'generation'};complete=true;}catch{complete=false;if(streamComplete)try{usageUnits(usage,rate);estimated=true;usage={...usage,stream_complete:true,cost_source:'rate_estimate'};}catch{}}
 }else try{if(complete){if(selected&&Number(usage.input_tokens||0)+Number(usage.cache_creation_input_tokens||0)+Number(usage.cache_read_input_tokens||0)>selected.maxInputTokens)throw new AppError('Le contexte dépasse le tarif autorisé.',409,'usage_unknown');cost=usageUnits(usage,rate).xaf;}}catch{complete=false;}
  await db().prepare('UPDATE provider_usage SET usage=?,cost_xaf=?,status=? WHERE id=?').bind(JSON.stringify(usage),cost,complete?'complete':estimated?'estimated':'unknown',id).run();};
 const stream=new ReadableStream({async pull(controller){try{
  const item=await iterator.next();if(item.done){await save();controller.close();return;}
  const event=modelEventSchema.parse(item.value.data);
 if(event.type==='message_start'){const message=event.message===undefined?{}:modelRecordSchema.parse(event.message);if(selected&&message.model!==selected.model&&!(selected.provider==='openrouter'&&message.model===REASONING_MODELS[selected.key].model))throw new AppError('Le modèle fournisseur ne correspond pas au tarif autorisé.',409,'usage_unknown');if(connection.provider==='openrouter'&&typeof message.id==='string'&&/^gen-[a-zA-Z0-9_-]+$/.test(message.id)){if(generationId&&generationId!==message.id)throw new AppError('Identifiant de consommation incohérent.',409,'usage_unknown');generationId=message.id;await db().prepare('UPDATE provider_usage SET request_id=? WHERE id=?').bind(generationId,id).run();}usage={...(message.usage===undefined?{}:modelRecordSchema.parse(message.usage))};}
  if(event.type==='message_delta'&&event.usage)usage={...usage,...modelRecordSchema.parse(event.usage)};
  if(event.type==='message_stop'){complete=true;await save();}
  controller.enqueue(encoder.encode('event: '+(item.value.event||event.type)+'\ndata: '+JSON.stringify(event)+'\n\n'));
 }catch(error){await save();controller.error(error);}},async cancel(){controller.abort();await save();await iterator.return?.();}});
 return new Response(stream,{status:response.status,headers:response.headers});
}
