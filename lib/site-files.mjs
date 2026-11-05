// Pure rules shared by the app (drafts, checks) and the public sites Worker.
// A published site runs its author's JavaScript, so it is only ever served from
// a separate registrable domain, never from braand.fun.

export const SITE_LIMITS = Object.freeze({files: 60, fileBytes: 512 * 1024, totalBytes: 3 * 1024 * 1024, pagesChecked: 8, freeSites: 1, paidSites: 10});

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
  webmanifest: 'application/manifest+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', ico: 'image/x-icon', woff2: 'font/woff2', mp4: 'video/mp4', webm: 'video/webm',
};
export const TEXT_EXTENSIONS = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'xml', 'webmanifest']);
export const BINARY_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'woff2', 'mp4', 'webm']);

export function siteExtension(path) {return (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();}
export function siteMime(path) {return TYPES[siteExtension(path)] || 'application/octet-stream';}

/** A safe relative file path: no traversal, no hidden files, known extension. */
export function normalizeSitePath(value) {
  if (typeof value !== 'string') throw new RangeError('Chemin de fichier invalide.');
  const path = value.trim().replace(/^\.?\/+/, '');
  if (!path || path.length > 160 || !/^[A-Za-z0-9._\-/]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))
    throw new RangeError('Chemin de fichier invalide : utilisez des lettres, chiffres, tirets et « / », par exemple « index.html » ou « assets/style.css ».');
  const extension = siteExtension(path);
  if (!TEXT_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension)) throw new RangeError(`Le type « .${extension || '?'} » n’est pas accepté dans un site.`);
  return path;
}

/** Public address part: lowercase letters, digits and dashes. */
export function siteSlug(value) {
  const slug = String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (slug.length < 3) throw new RangeError('Le nom du site doit contenir au moins 3 lettres ou chiffres.');
  if (/^(?:api|admin|auth|www|app|braand|preview|static|assets|login|support|help)$/.test(slug) || slug.startsWith('__')) throw new RangeError('Ce nom de site est réservé. Choisissez-en un autre.');
  return slug;
}

/** Which file answers a public path: exact file, then .html, then folder index. */
export function siteCandidates(requestPath) {
  const clean = decodeURIComponent(requestPath).replace(/^\/+/, '');
  if (!clean || clean.endsWith('/')) return [clean + 'index.html'];
  if (siteExtension(clean)) return [clean];
  return [clean + '.html', clean + '/index.html'];
}

const BADGE = '<a href="https://braand.fun/?ref=site" target="_blank" rel="noopener" style="position:fixed;right:12px;bottom:12px;z-index:2147483647;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#111;color:#fff;font:600 12px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25)">Fait avec Braand</a>';
export function withBadge(html) {return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, BADGE + '</body>') : html + BADGE;}

/** Strict headers for a published or previewed site file. */
export function siteHeaders(path, {preview = false} = {}) {
  const html = /^text\/html/.test(siteMime(path));
  const headers = {
    'Content-Type': siteMime(path),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cache-Control': preview ? 'no-store' : 'public, max-age=60',
  };
  if (html) {
    // Own files only; images may also come from https (e.g. a map tile or a CDN image).
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; media-src 'self' https:; connect-src 'self'; form-action 'self'; frame-ancestors " + (preview ? 'https://braand.fun' : "'none'") + "; base-uri 'self'; object-src 'none'";
    if (!preview) headers['X-Frame-Options'] = 'DENY';
  }
  if (preview) headers['X-Robots-Tag'] = 'noindex, nofollow';
  return headers;
}

/** Internal links and assets referenced by an HTML page, relative to its folder. */
export function siteReferences(html, fromPath) {
  const folder = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  const refs = [];
  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
    const value = match[1].trim();
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|data:|mailto:|tel:|javascript:)/i.test(value)) continue;
    const joined = (value.startsWith('/') ? value.slice(1) : folder + value).split('/');
    const parts = [];
    for (const part of joined) {if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);}
    refs.push({raw: value, path: parts.join('/') + (value.endsWith('/') ? '/' : '')});
  }
  return refs;
}
