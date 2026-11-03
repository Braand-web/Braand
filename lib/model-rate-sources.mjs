export const MODEL_PRICING_URL = 'https://openrouter.ai/api/v1/models';
export const FX_REFERENCE_URL = 'https://www.beac.int/';

export function parseBEACReference(html, now = Date.now()) {
 const row = html.match(/USD\/XAF<\/span>[\s\S]{0,500}<div id="middle"[^>]*>\s*([0-9.]+)\s*<\/div>\s*<div id="right"[^>]*>\s*([0-9.]+)\s*<\/div>/);
 const date = html.match(/Date de valeur\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
 if (!row || !date) throw new Error('fx_reference_invalid');
 const valueDate = `${date[3]}-${date[2]}-${date[1]}`, timestamp = Date.parse(valueDate), age = now - timestamp;
 const buy = Number(row[1]), sell = Number(row[2]);
 // The official reference keeps its value date over weekends and bank holidays.
 if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000 || new Date(timestamp).toISOString().slice(0,10) !== valueDate || !Number.isFinite(sell) || buy <= 0 || buy > sell || sell < 50 || sell > 5000) throw new Error('fx_reference_invalid');
 return {usdXaf:sell, fxSource:FX_REFERENCE_URL, fxValueDate:valueDate, conversionBasis:'beac_sell_reference'};
}

export function refreshOpenRouterRate(model, previous, limits, fx, now = Date.now()) {
 if (!model || model.id !== previous.model || !Array.isArray(model.supported_parameters) || !model.supported_parameters.includes('tools')) throw new Error('model_reference_invalid');
 const price = name => {
  const raw = model.pricing?.[name];
  if (typeof raw !== 'string' || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error('model_price_invalid');
  const value = Number((Number(raw) * 1000000).toPrecision(15));
  if (!Number.isFinite(value) || value > 1000000) throw new Error('model_price_invalid');
  return value;
 };
 let maxInputTokens = Math.min(limits.maxInputTokens, model.context_length, model.top_provider?.context_length ?? model.context_length);
 const maxOutputTokens = Math.min(limits.maxOutputTokens, model.top_provider?.max_completion_tokens ?? limits.maxOutputTokens);
 // A lower context threshold must never silently admit a more expensive tier.
 if (model.pricing.overrides !== undefined && !Array.isArray(model.pricing.overrides)) throw new Error('model_tier_invalid');
 for (const tier of model.pricing.overrides ?? []) {
  if (!Number.isSafeInteger(tier.min_prompt_tokens) || tier.min_prompt_tokens <= 0) throw new Error('model_tier_invalid');
  maxInputTokens = Math.min(maxInputTokens, tier.min_prompt_tokens - 1);
 }
 if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 128) throw new Error('model_limits_invalid');
 const cacheWrite = price('input_cache_write');
 const cacheWriteHour = model.pricing.input_cache_write_1h === undefined && model.id.startsWith('openai/') ? undefined : price('input_cache_write_1h');
 if (model.pricing.request !== undefined && Number(model.pricing.request) !== 0) throw new Error('model_request_price_unverified');
 return {maxInputTokens,maxOutputTokens,rate:{...previous,input:price('prompt'),output:price('completion'),cacheRead:price('input_cache_read'),cacheWrite,cacheWriteHour,...fx,provider:'openrouter',pricingSource:MODEL_PRICING_URL,verifiedAt:new Date(now).toISOString(),maxInputTokens}};
}
