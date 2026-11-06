// Traffic measured by Braand itself, as daily totals. Pure helpers: classify a
// request into counters, keep only coarse values (page shape, source name,
// country, device, status class, latency band). No IP and no full URL is kept.

export const TRAFFIC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS traffic_daily(day TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,dim TEXT NOT NULL,value TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,scope,key,dim,value))`,
  `CREATE TABLE IF NOT EXISTS traffic_visitors(day TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(day,scope,key,hash))`,
];

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|go-http|httpclient|axios|node-fetch/i;
const STATIC = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|txt|xml|json|webmanifest|mp4|webm|mp3|pdf|zip)$/i;
const SOURCES = [
  [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook'], [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp'], [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'LinkedIn'],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'X'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram'],
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)$/, 'Assistant IA'],
];
const LATENCY = [[200, '< 200 ms'], [1000, '< 1 s'], [3000, '< 3 s'], [10000, '< 10 s']];

export function latencyBand(ms) { for (const [limit, label] of LATENCY) if (ms < limit) return label; return '≥ 10 s'; }
export function deviceOf(ua = '') { return /ipad|tablet|kindle|silk/i.test(ua) ? 'Tablette' : /mobi|android|iphone|ipod/i.test(ua) ? 'Téléphone' : 'Ordinateur'; }
export function isBot(ua = '') { return !ua || BOT.test(ua); }

/** A page shape without identifiers or parameters: /s/abc/x → /:slug/x, ids → :id. */
export function pageShape(pathname) {
  const parts = pathname.split('/').filter(Boolean).slice(0, 3).map(part => {
    let value = part;
    try { value = decodeURIComponent(part); } catch { /* keep raw */ }
    return /^[0-9a-f-]{16,}$/i.test(value) || /\d{3,}/.test(value) || value.length > 32 ? ':id' : value.toLowerCase();
  });
  return '/' + parts.join('/');
}

/** Where the visit comes from: utm_source first, then the referring site's name; null for an internal link. */
/** @param {URL} url @param {string|null} referer @param {string[]} [ownHosts] */
export function sourceOf(url, referer, ownHosts = []) {
  const utm = url.searchParams.get('utm_source');
  if (utm && /^[\w .-]{1,40}$/.test(utm)) return utm.trim().toLowerCase().replace(/^\w/, c => c.toUpperCase());
  if (!referer) return 'Lien direct';
  let host;
  try { host = new URL(referer).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'Lien direct'; }
  if (host === url.hostname.replace(/^www\./, '') || ownHosts.includes(host)) return null;
  for (const [pattern, name] of SOURCES) if (pattern.test(host)) return name;
  return host.slice(0, 60);
}

/** API route group: identifiers become :id, at most three segments. */
export function apiGroup(pathname) {
  return '/' + pathname.split('/').filter(Boolean).slice(0, 4).map(part => /^[0-9a-f-]{8,}$/i.test(part) || /\d{3,}/.test(part) || part.length > 32 ? ':id' : part).slice(0, 4).join('/');
}

/**
 * The counters one request adds, or [] when it is not counted. kind: 'app' for
 * braand.fun, 'site' for a published site (slug given). Visitors are handled
 * separately with a daily salted hash.
 */
/**
 * @param {{method:string,url:URL,status:number,ms:number,headers:Headers,kind:'app'|'site',slug?:string,contentType?:string|null,country?:string,ownHosts?:string[]}} input
 * @returns {{counters:{day:string,scope:string,key:string,dim:string,value:string,n:number}[],visitor?:{day:string,scope:string,key:string,ua:string}}}
 */
export function classify({method, url, status, ms, headers, kind, slug = '', contentType, country, ownHosts = []}) {
  const day = new Date().toISOString().slice(0, 10);
  if (kind === 'app' && url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/internal/')) return {counters: []};
    const key = apiGroup(url.pathname);
    return {counters: [
      ['api', key, 'requests', method], ['api', key, 'status', `${Math.floor(status / 100)}xx`],
      ['api', key, 'latency', latencyBand(ms)], ['api', key, 'ms_total', '', Math.max(0, Math.round(ms))],
    ].map(([scope, k, dim, value, n = 1]) => ({day, scope, key: k, dim, value, n}))};
  }
  const ua = headers.get('user-agent') || '';
  const page = (method === 'GET' || method === 'HEAD') && (status < 400 || status === 401) && !STATIC.test(url.pathname) && /text\/html/i.test(contentType || '') && headers.get('sec-fetch-dest') !== 'iframe';
  if (!page || (kind === 'site' && status !== 200)) return {counters: []};
  const scope = kind === 'site' ? 'site' : 'app', key = kind === 'site' ? slug : '';
  if (isBot(ua)) return {counters: [{day, scope, key, dim: 'bot', value: '', n: 1}]};
  const source = sourceOf(url, headers.get('referer'), ownHosts);
  if (source === null && kind === 'app') return {counters: [{day, scope, key, dim: 'internal', value: '', n: 1}]};
  const counters = [
    {day, scope, key, dim: 'views', value: '', n: 1},
    {day, scope, key, dim: 'page', value: kind === 'site' ? pageShape(url.pathname.replace(/^\/[^/]+/, '') || '/') : pageShape(url.pathname), n: 1},
    {day, scope, key, dim: 'source', value: source ?? 'Lien interne', n: 1},
    {day, scope, key, dim: 'device', value: deviceOf(ua), n: 1},
  ];
  if (country && /^[A-Z]{2}$/.test(country)) counters.push({day, scope, key, dim: 'country', value: country, n: 1});
  return {counters, visitor: {day, scope, key, ua}};
}

/** Adds counters into a map keyed by their identity (in-memory aggregation). */
export function addCounters(map, counters) {
  for (const c of counters) {
    const id = [c.day, c.scope, c.key, c.dim, c.value].join('\u0001');
    const current = map.get(id);
    if (current) current.n += c.n; else map.set(id, {...c});
  }
  return map;
}
