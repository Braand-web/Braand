import {AppError, validateMediaInput} from './core.mjs';
import {hasCurrentMediaPrice} from './execution-policy.mjs';

// Capability preferences, never availability claims or supplier prices. Only
// administrator-validated catalog entries can become executable proposals.
export const MEDIA_TASKS = Object.freeze({
  audio_speech: ['elevenlabs/tts/eleven-v4'],
  image: ['google/nano-banana-2.1', 'openai/gpt-image-2.5/flare/text-to-image', 'openai/gpt-image-2'],
  image_edit: ['google/nano-banana-2.1/edit', 'openai/gpt-image-2.5/flare/edit', 'openai/gpt-image-2/edit'],
  image_precision: ['openai/gpt-image-2.5/sunburst/text-to-image', 'openai/gpt-image-2.5/flare/text-to-image'],
  image_edit_precision: ['openai/gpt-image-2.5/sunburst/edit', 'openai/gpt-image-2.5/flare/edit'],
  video_short: ['google/gemini-omni-flash', 'bytedance/seedance-2.0/fast/text-to-video'],
  video_narrative: ['bytedance/seedance-2.5/text-to-video', 'bytedance/seedance-2.0/text-to-video'],
  video_reference: ['bytedance/seedance-2.5/reference-to-video', 'google/gemini-omni-flash/reference-to-video'],
  video_from_image: ['bytedance/seedance-2.5/image-to-video', 'kling-video/v2.5-turbo/pro/image-to-video'],
  video_ugc: ['veed/fabric-1.0', 'bytedance/omnihuman/v1.5'],
  image_upscale: ['fal-ai/clarity-upscaler', 'fal-ai/recraft/upscale/crisp'],
  image_background_removal: ['fal-ai/birefnet/v2', 'fal-ai/bria/background/remove'],
  video_upscale: ['fal-ai/topaz/upscale/video'],
});

export function chooseMediaRoute(catalog, task, input, maxCredits, now = Date.now()) {
  if (!Object.hasOwn(MEDIA_TASKS, task)) throw new AppError('Type de création non pris en charge.', 400, 'media_task_invalid');
  if (maxCredits !== undefined && (!Number.isSafeInteger(maxCredits) || maxCredits <= 0)) throw new AppError('Plafond média invalide.', 400);
  const preference = MEDIA_TASKS[task];
  const candidates = catalog.filter(item => (preference.includes(item.id) || item.tasks?.includes(task)) &&
    item.kind === (task.startsWith('video_') ? 'video' : task==='audio_speech'?'audio':'image') &&
    hasCurrentMediaPrice(item, item.credits, now) && (maxCredits === undefined || item.credits <= maxCredits));
  const rank = item => item.priority ?? (preference.includes(item.id) ? preference.indexOf(item.id) + 100 : 1000);
  candidates.sort((a, b) => rank(a) - rank(b) || a.credits - b.credits || a.id.localeCompare(b.id));
  const reasons = [];
  for (const item of candidates) {
    try { validateMediaInput(input, item.inputSchema); return item; }
    catch (error) { if (!(error instanceof AppError)) throw error; reasons.push(item.id + ' : ' + error.message + ' (paramètres acceptés : ' + Object.keys(item.inputSchema?.properties || {}).join(', ') + ' ; ' + item.credits + ' crédits)'); }
  }
  if (reasons.length) throw new AppError('Aucun modèle ne couvre exactement ces paramètres. Corrige l’entrée selon un de ces modèles puis réessaie : ' + reasons.slice(0, 3).join(' | '), 503, 'media_route_unavailable');
  // No submitted generation has occurred: a later quote may choose another
  // validated candidate, but approval never silently switches the model.
  throw new AppError('Aucun modèle validé ne couvre ces paramètres et ce plafond. Ajustez le brief ou faites vérifier le catalogue.', 503, 'media_route_unavailable');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export async function mediaQuoteFingerprint(item, input) {
  const snapshot = canonical({model: item.id, credits: item.credits, costCeilingXaf: item.costCeilingXaf, verifiedAt: item.verifiedAt, inputSchema: item.inputSchema, input});
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
