// Braand never tells its users which suppliers power it. Messages that reach
// a user (errors, tool errors the agent may repeat, stream errors) name the
// kind of service instead. Model identifiers such as "fal-ai/flux/dev" are
// left intact: they are technical parameters, not prose.
const RULES = [
  [/\bfal(?:\.ai)?(?![-\w]*\/)\b/gi, 'le service de création'],
  [/\bopen\s?router\b/gi, 'le service d’IA'],
  [/\banthropic\b/gi, 'le service d’IA'],
  [/\bclaude\b(?![-\w]*\/)/gi, 'l’IA de Braand'],
  [/\bsas\s?pay\b/gi, 'le service de paiement'],
  [/\bcomposio\b/gi, 'le service de connexion'],
  [/\bbrowserbase\b/gi, 'le service de navigateur'],
  [/\bcloudflare\b/gi, 'l’hébergement'],
  [/\beleven\s?labs\b/gi, 'le service de voix'],
  [/\breplicate\b(?=\s|[.,;:!?)]|$)/g, 'le service de création'],
];
export const SUPPLIER_PATTERN = /\b(fal(\.ai)?|open\s?router|anthropic|claude|sas\s?pay|composio|browserbase|cloudflare|eleven\s?labs)\b/i;

/** @param {string} text */
export function withoutSupplierNames(text) {
  if (typeof text !== 'string' || !SUPPLIER_PATTERN.test(text)) return text;
  let out = text;
  for (const [pattern, name] of RULES) out = out.replace(pattern, name);
  // "chez le service…", "sur le service…" read fine; tidy doubled articles.
  return out.replace(/\b(de|du) le service/gi, 'du service').replace(/\bà le service/gi, 'au service');
}
