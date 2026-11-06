// Local demonstration only. This launcher is not imported by the application.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {seedDemo,DEMO_FILES} from './demo/seed.mjs';
import {demoAnalytics,DEMO_AD_ACCOUNT} from './demo/analytics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.BRAAND_DEMO_PORT || 4202);
const backendPort = port + 1;
if (!Number.isInteger(port) || port < 1024 || port > 65533) throw Error('Invalid local demo port.');
const origin = 'http://127.0.0.1:' + port;
const backendOrigin = 'http://127.0.0.1:' + backendPort;
for (const localPort of [port, backendPort]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(localPort, '127.0.0.1', () => probe.close(resolve));
  });
}
const data = path.join(root, '.local-data', 'maison-naya-demo');
const build = path.join(root, '.local-build', 'maison-naya-demo');
await mkdir(data, {recursive:true});
await mkdir(build, {recursive:true});
const sql = new DatabaseSync(path.join(data, 'braand.sqlite'));
sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY)');
for (const migration of (await readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
  if (sql.prepare('SELECT name FROM _local_migrations WHERE name=?').get(migration)) continue;
  sql.exec('BEGIN');
  try {
    sql.exec(await readFile(path.join(root, 'drizzle', migration), 'utf8'));
    sql.prepare('INSERT INTO _local_migrations VALUES (?)').run(migration);
    sql.exec('COMMIT');
  } catch (error) {sql.exec('ROLLBACK'); throw error;}
}
const seeded = seedDemo(sql);
sql.close();
for (const file of DEMO_FILES) {
  const target = path.resolve(data, 'files', file.storageKey);
  if (!target.startsWith(path.resolve(data, 'files') + path.sep)) throw Error('Invalid demo file key.');
  await mkdir(path.dirname(target), {recursive:true});
  await writeFile(target, file.content, 'utf8');
}
const configFile = path.join(data, 'empty-demo.vars');
await writeFile(configFile, '# Explicit empty configuration for an isolated offline demonstration.\n');

// Never inherit provider credentials or the user's .dev.vars file.
const env = {...process.env};
for (const key of Object.keys(env)) {
  if (/^(?:WORK_|RESEARCH_|TAVILY_|SOCIAL_|MEDIA_|BRAAND_|APP_ENV$|BROWSER_|AUTONOMY_|BACKUP_|BILLING_|COMPOSIO_|FAL_|META_|OPENAI_|MODEL_ROUTING_|OPENROUTER_|ANTHROPIC_|SASPAY_|RESEND_|OPS_|TOKEN_ENCRYPTION_KEY$|FILE_|SCHEDULER_SECRET$|PAGE_FORM_SECRET$|LLM_PROVIDER$|FREE_DAILY_CREDITS$|PAGES_ORIGIN$|NODE_OPTIONS$)/u.test(key)) delete env[key];
}
Object.assign(env, {APP_ENV:'development', PORT:String(backendPort), BRAAND_DATA_DIR:data, BRAAND_BUILD_DIR:build, BRAAND_CONFIG_FILE:configFile, FILE_PREVIEW_V1:'true', FILE_URL_SIGNING_SECRET:randomBytes(32).toString('hex'), NODE_OPTIONS:'--max-old-space-size=1536 --max-semi-space-size=8'});
const child = spawn(process.execPath, ['--import', new URL('./demo/offline.mjs', import.meta.url).href, path.join(root, 'scripts', 'dev-local.mjs')], {cwd:root, env, stdio:['ignore','pipe','pipe'], windowsHide:true});
let childExited = false;
child.stdout.on('data', bytes => {if (bytes.toString().includes('Braand local')) console.log('Demo data adapter ready.');});
child.stderr.on('data', bytes => process.stderr.write(bytes));
child.on('exit', code => {childExited = true; if (server.listening) {console.error('Demo adapter stopped:', code); server.close();}});

const toolkits = [
  {slug:'gmail',name:'Gmail',description:'Boîte de réception fictive de Maison Naya. Aucune lecture ni aucun envoi réel.',connected:true,status:'active',accountId:'demo-gmail'},
  {slug:'googledrive',name:'Google Drive',description:'Exemple de dossier de marque connecté. Aucun accès à un compte Google.',connected:true,status:'active',accountId:'demo-drive'},
  {slug:'notion',name:'Notion',description:'Exemple de base de connaissances. Application présentée à titre de démonstration.',connected:false,status:'disconnected'},
  {slug:'instagram',name:'Instagram',description:'Exemple de préparation de contenus. Aucune publication réelle.',connected:false,status:'disconnected'},
  {slug:'metaads',name:'Meta Ads',description:'Les campagnes et résultats présentés dans la démonstration sont fictifs.',connected:false,status:'disconnected'},
];
const banner = `<aside class="demo-notice" aria-label="Espace de démonstration"><strong>Maison Naya · Démonstration</strong><span>Tous les contenus, comptes et chiffres sont fictifs.</span><nav aria-label="Parcours de démonstration"><a href="/?view=creations">Créations</a><a href="/?view=projects">Projets</a><a href="/?view=analytics">Tableau de bord</a><a href="/?settings=billing">Facturation</a></nav></aside>`;
const demoStyle = `<style>.demo-notice{height:36px;display:flex;align-items:center;gap:20px;padding:0 20px;background:#e9d9bd;color:#30291e;font:12px/1.4 Manrope,system-ui,sans-serif;white-space:nowrap}.demo-notice strong{font-weight:700}.demo-notice nav{display:flex;gap:16px;margin-left:auto}.demo-notice a{color:inherit;text-decoration:underline;text-underline-offset:3px}.demo-notice a:focus-visible{outline:2px solid #30291e;outline-offset:3px}.app-shell{height:calc(100dvh - 36px)!important;min-height:calc(100dvh - 36px)!important}.home-footer{bottom:0}@media(max-width:900px){.demo-notice>span{display:none}}@media(max-width:600px){.demo-notice{padding:0 12px;gap:8px;font-size:11px}.demo-notice nav>a:not(:first-child){display:none}}</style>`;
let cookie = '';
const demoSidebarStyle = '<style>.app-shell>.sidebar{height:calc(100dvh - 36px)!important;min-height:0!important}@media(max-width:680px){.app-shell>.sidebar{top:36px!important}}</style>';
const json = (response, status, value) => {response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify(value));};
const server = createServer(async (request, response) => {
  try {
    if (![new URL(origin).host, 'localhost:' + port].includes(request.headers.host)) return json(response, 403, {error:'Cette démonstration est accessible uniquement en local.'});
    const url = new URL(request.url, origin);
    const fileSign = request.method === 'POST' && DEMO_FILES.some(file => url.pathname === '/api/files/' + file.id + '/url');
    if (!['GET','HEAD'].includes(request.method) && !fileSign) return json(response, 403, {error:'Mode démonstration : la consultation est disponible. Les générations, publications, paiements et modifications sont désactivés.'});
    if (fileSign && request.headers.origin !== origin && request.headers.origin !== 'http://localhost:' + port) return json(response, 403, {error:'Ouvrez le fichier depuis la démonstration locale.'});
    if (url.pathname !== '/api/admin/me' && /^\/api\/(?:internal|admin|webhooks)(?:\/|$)/u.test(url.pathname) || url.pathname.endsWith('/connect')) return json(response, 403, {error:'Aucune connexion ou action externe dans cette démonstration.'});
    if (url.pathname === '/api/demo') return json(response, 200, seeded);
    if (url.pathname === '/api/meta') {
      const days=Number(url.searchParams.get('days')||30);
      if(![7,30,90].includes(days))return json(response,400,{error:'Choisissez une période de 7, 30 ou 90 jours.'});
      return json(response,200,url.searchParams.has('accountId')?demoAnalytics(days):{data:[DEMO_AD_ACCOUNT],demonstration:true});
    }
    if (url.pathname === '/api/connectors/toolkits') {
      const search = (url.searchParams.get('search') || '').toLocaleLowerCase('fr');
      const items = toolkits.filter(item => (url.searchParams.get('connected') !== 'true' || item.connected) && item.name.toLocaleLowerCase('fr').includes(search));
      return json(response, 200, {items,nextCursor:null,configured:true,demonstration:true,instant:{enabled:false,monthlyLimitUsd:0,perCallLimitUsd:0,note:'Catalogue fictif · aucune connexion réelle'}});
    }
    if (url.pathname.startsWith('/demo-assets/')) {
      const name = url.pathname.slice('/demo-assets/'.length);
      if (!/^(?:cacao|cafe|hibiscus|collection|story|packaging)\.svg$/u.test(name)) return json(response, 404, {error:'Visuel de démonstration introuvable.'});
      response.writeHead(200, {'Content-Type':'image/svg+xml','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"});
      response.end(await readFile(path.join(root, 'scripts', 'demo', 'assets', name))); return;
    }
    if (url.pathname === '/pricing') {response.writeHead(307, {Location:'/?settings=billing','Cache-Control':'no-store'}); response.end(); return;}
    if (url.pathname.includes('signin') || url.pathname.includes('signout') || url.pathname.startsWith('/auth/')) {response.writeHead(303, {Location:'/?settings=general','Cache-Control':'no-store'}); response.end(); return;}
    const headers = new Headers();
    for (const key of ['accept','content-type','range']) if (request.headers[key]) headers.set(key, request.headers[key]);
    headers.set('cookie', cookie);
    let body;
    if (fileSign) {
      const chunks = []; let size = 0;
      for await (const chunk of request) {size += chunk.length; if (size > 2048) return json(response, 413, {error:'Requête trop volumineuse.'}); chunks.push(chunk);}
      body = Buffer.concat(chunks);
    }
    const upstream = await fetch(backendOrigin + url.pathname + url.search, {method:request.method, headers, body, redirect:'manual'});
    const outgoing = new Headers(upstream.headers);
    outgoing.delete('set-cookie'); outgoing.delete('content-length'); outgoing.delete('content-encoding');
    outgoing.set('Cache-Control','no-store'); outgoing.set('X-Braand-Demonstration','fictitious-data');
    if (url.pathname === '/api/workspace' && upstream.ok) {
      const workspace = await upstream.json();
      workspace.demonstration = true;
      workspace.user.name = 'Camille · Démonstration'; workspace.user.email = 'camille@maison-naya.example';
      workspace.capabilities = {...workspace.capabilities, model:false, modelReady:false, media:false, autonomy:false, publishing:false, billing:false, metaConnected:true};
      response.writeHead(upstream.status, Object.fromEntries(outgoing)); response.end(JSON.stringify(workspace)); return;
    }
    if (fileSign && upstream.ok) {
      const signed = await upstream.json();
      const target = new URL(signed.url);
      if (target.origin !== backendOrigin) throw Error('Unexpected demo file origin.');
      signed.url = origin + target.pathname + target.search;
      response.writeHead(upstream.status, Object.fromEntries(outgoing)); response.end(JSON.stringify(signed)); return;
    }
    if (outgoing.get('content-type')?.includes('text/html') && !url.pathname.startsWith('/api/')) {
      const html = (await upstream.text()).replace('</head>', demoStyle + demoSidebarStyle + '</head>').replace('<body>', '<body>' + banner).replace('Braand · Développement local','Braand · Maison Naya · Démonstration');
      response.writeHead(upstream.status, Object.fromEntries(outgoing)); response.end(html); return;
    }
    response.writeHead(upstream.status, Object.fromEntries(outgoing));
    if (request.method === 'HEAD') {response.end(); return;}
    if (upstream.body) for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch (error) {
    console.error('Demo preview:', error instanceof Error ? error.message : 'request failed');
    if (!response.headersSent) json(response, 500, {error:'La démonstration locale ne répond pas. Relancez son serveur.'}); else response.end();
  }
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (childExited) throw Error('Demo adapter failed to start.');
    try {
      const signIn = await fetch(backendOrigin + '/auth/sign-in', {redirect:'manual'});
      if (signIn.status === 302 && signIn.headers.get('set-cookie')?.startsWith('braand_local_session=')) {cookie = signIn.headers.get('set-cookie').split(';')[0]; ready = true; break;}
    } catch { /* Wait for the local bundle, without using live credentials. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw Error('Demo adapter did not become ready.');
  server.listen(port, '127.0.0.1', () => console.log('Braand · Maison Naya · données fictives\nAperçu : ' + origin + '/?view=creations\nBase isolée : ' + data));
} catch (error) {child.kill(); throw error;}
const stop = () => {child.kill(); server.close();};
server.once('error', error => {child.kill(); console.error('Demo preview:', error.message); process.exitCode = 1;});
process.once('SIGINT', stop); process.once('SIGTERM', stop);
