// Public sites Worker. It runs on its own registrable domain, holds no secret,
// sets no cookie and can only read published files, draft previews by
// short-lived token, and append contact requests.
import {SITES_HOST_PATTERN,SITES_SCHEMA,siteCandidates,siteHeaders,siteMime,withBadge} from '../../lib/site-files.mjs';

const notFound = () => new Response('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Site introuvable</title><p style="font-family:system-ui;padding:40px">Ce site n’existe pas ou n’est plus en ligne.</p></html>', {status: 404, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
const text = (body, status) => new Response(body, {status, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

async function serveFile(env, prefix, rest, {badge = false, preview = false} = {}) {
  for (const candidate of siteCandidates(rest)) {
    if (candidate.split('/').some(part => part === '..' || part.startsWith('.'))) return notFound();
    const object = await env.BUCKET.get(prefix + candidate);
    if (!object) continue;
    const headers = siteHeaders(candidate, {preview});
    if (badge && /^text\/html/.test(siteMime(candidate))) return new Response(withBadge(await object.text()), {headers});
    return new Response(object.body, {headers});
  }
  return notFound();
}

async function contact(request, env, publication) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return text('Format de formulaire invalide.', 415);
  const raw = await request.text();
  if (raw.length > 8192) return text('Formulaire trop volumineux.', 413);
  const form = new URLSearchParams(raw);
  if (form.get('website')) return text('Envoi refusé.', 400);
  const name = (form.get('name') || '').trim().slice(0, 160), email = (form.get('email') || '').trim().slice(0, 254), message = (form.get('message') || '').trim().slice(0, 3000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) return text('Merci d’indiquer votre nom, une adresse e-mail valide et un message.', 400);
  const address = request.headers.get('cf-connecting-ip') || 'unknown', now = Date.now(), bucket = Math.floor(now / 3600000);
  const key = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(publication.id + ':' + address)));
  const limited = await env.DB.prepare('INSERT INTO site_form_limits(key,bucket,count) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 WHERE count<5').bind(key, bucket).run();
  if (!limited.meta.changes) return text('Trop de demandes. Réessayez plus tard.', 429);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO site_leads(id,publication_id,workspace_id,name,email,message,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), publication.id, publication.workspace_id, name, email, message, now),
    env.DB.prepare('DELETE FROM site_form_limits WHERE bucket<?').bind(bucket - 48),
  ]);
  const back = form.get('redirect');
  if (back && /^[A-Za-z0-9._\-/]{1,160}$/.test(back)) return Response.redirect(new URL(`/${publication.slug}/${back.replace(/^\/+/, '')}`, request.url).href, 303);
  return new Response('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Message envoyé</title><p style="font-family:system-ui;padding:40px">Merci, votre message a bien été envoyé.</p></html>', {status: 201, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

const sitesWorker = {
  async fetch(request, env) {
    try {return await route(request, env);} catch {return notFound();}
  },
};
async function route(request, env) {
  {
    const url = new URL(request.url);
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return text('Méthode non autorisée.', 405);
    // Deploy check: create the tables and record this address so the app can show public links.
    if (url.pathname === '/__braand-sites-ready') {
      if (!SITES_HOST_PATTERN.test(url.hostname)) return notFound();
      await env.DB.batch(SITES_SCHEMA.map(sql => env.DB.prepare(sql)));
      await env.DB.prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES ('sites_origin',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(url.origin, Date.now()).run();
      return text('ok', 200);
    }
    if (url.pathname === '/' ) return Response.redirect('https://braand.fun/', 302);
    const preview = url.pathname.match(/^\/__preview\/([a-f0-9]{48})\/(.*)$/);
    if (preview) {
      if (request.method === 'POST') return text('L’aperçu n’envoie pas de formulaire.', 405);
      const row = await env.DB.prepare('SELECT resource_id,workspace_id FROM site_preview_tokens WHERE token=? AND expires_at>?').bind(preview[1], Date.now()).first();
      if (!row) return text('Cet aperçu a expiré. Rouvrez-le depuis Braand.', 410);
      return serveFile(env, `sites/${row.workspace_id}/${row.resource_id}/draft/`, preview[2], {preview: true});
    }
    const site = url.pathname.match(/^\/([a-z0-9][a-z0-9-]{1,39})(\/.*)?$/);
    if (!site) return notFound();
    // Unknown or offline names answer 404 before any redirect.
    const publication = await env.DB.prepare("SELECT id,workspace_id,slug,live_digest,badge FROM site_publications WHERE slug=? AND status='published' AND live_digest IS NOT NULL").bind(site[1]).first();
    if (!publication) return notFound();
    if (!site[2]) return Response.redirect(new URL(`/${site[1]}/`, request.url).href, 301);
    const rest = site[2].slice(1);
    if (rest === '__contact') return request.method === 'POST' ? contact(request, env, publication) : notFound();
    if (request.method === 'POST') return text('Méthode non autorisée.', 405);
    return serveFile(env, `sites-public/${publication.slug}/${publication.live_digest}/`, rest, {badge: !!publication.badge});
  }
}
export default sitesWorker;
