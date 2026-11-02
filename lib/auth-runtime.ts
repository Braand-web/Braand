// Independent authentication. No trusted identity headers from clients.
import {WELCOME_UNITS, WELCOME_TTL} from './welcome-credits.mjs';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {scryptSync} from 'node:crypto';
type AuthEnv = Pick<Cloudflare.Env, 'DB' | 'APP_ENV' | 'APP_ORIGIN' | 'AUTH_ENABLED' | 'AUTH_HASH_SECRET' | 'AUTH_GOOGLE_CLIENT_ID' | 'AUTH_GOOGLE_CLIENT_SECRET' | 'AUTH_GOOGLE_CONFIG' | 'RESEND_MODE' | 'RESEND_API_KEY' | 'RESEND_FROM' | 'RESEND_TEST_RECIPIENT' | 'RESEND_LIVE_APPROVED'>;
type Challenge = {id: string; email: string; browser_hash: string; return_to: string};
type PendingPassword = {salt:string;digest:string;iterations:number};
export type BraandIdentity = {userId: string; email: string; displayName: string; fullName: null};
const LOGIN_COOKIE = '__Host-braand_login';
const SESSION_COOKIE = '__Host-braand_session';
const LEGACY_PREFIX = ['ai', 'ra'].join('');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const text = new TextEncoder();
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const PASSWORD_ITERATIONS = 32_768; // scrypt N; r=8 and p=3 are fixed for this version.
const validPassword = (password:string) => password.length >= 12 && text.encode(password).length <= 128;
const decode = (value:string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function safeAuthReturn(value: string | null) {
  try {
    const u = new URL(value || '/', 'https://braand.invalid');
    if (!value?.startsWith('/') || u.origin !== 'https://braand.invalid' || u.pathname.startsWith('/auth/') || u.pathname.includes('with-chatgpt')) return '/';
    if (u.searchParams.get('auth') === 'sign-in') {u.searchParams.delete('auth'); u.searchParams.delete('return_to');}
    return u.pathname + u.search + u.hash;
  } catch {return '/';}
}
function cookie(headers: Headers, name: string) {
  const cookieHeader = headers.get('cookie') || '';
  const read = (candidate: string) => {
    const values = cookieHeader.split(';').map(c => c.trim()).filter(c => c.startsWith(candidate + '=')).map(c => c.slice(candidate.length + 1));
    return values.length === 1 && tokenPattern.test(values[0]) ? values[0] : null;
  };
  return read(name) ?? read(name.replace('braand', LEGACY_PREFIX));
}
function setCookie(name: string, value: string, age: number) {return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;}
async function readForm(request: Request) {
  const reader=request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[]=[]; let size=0;
  while (true) {const next=await reader.read(); if (next.done) break; size+=next.value.byteLength; if (size>4096) {await reader.cancel(); return null;} chunks.push(next.value);}
  const bytes=new Uint8Array(size); let offset=0; for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new URLSearchParams(new TextDecoder().decode(bytes));
}
async function hash(value: string, env: AuthEnv) {
  if (!env.AUTH_HASH_SECRET || env.AUTH_HASH_SECRET.length < 32) throw new Error('auth_configuration_missing');
  const key = await crypto.subtle.importKey('raw', text.encode(env.AUTH_HASH_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(value))));
}
async function derivePassword(password:string,salt:string,env:AuthEnv){
  // HMAC keeps a separate server-side pepper; the salted adaptive hash is the only credential stored in D1.
  const peppered=await hash('password:'+password,env);
  return encode(new Uint8Array(scryptSync(peppered,decode(salt),32,{N:PASSWORD_ITERATIONS,r:8,p:3,maxmem:64*1024*1024})));
}
function sameDigest(left:string,right:string){let difference=left.length^right.length;for(let i=0;i<43;i++)difference|=(left.charCodeAt(i)||0)^(right.charCodeAt(i)||0);return difference===0;}
function origin(env: AuthEnv) {
  try {const u = new URL(env.APP_ORIGIN || ''); if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null; return u.origin;} catch {return null;}
}
function configured(env: AuthEnv) {return env.AUTH_ENABLED === 'true' && !!env.DB && !!origin(env) && (env.AUTH_HASH_SECRET?.length || 0) >= 32;}
function googleConfig(env:AuthEnv):{clientId:string;clientSecret:string}|null{
  if(env.AUTH_GOOGLE_CONFIG){try{const value=JSON.parse(env.AUTH_GOOGLE_CONFIG);if(typeof value.clientId==='string'&&value.clientId&&typeof value.clientSecret==='string'&&value.clientSecret)return {clientId:value.clientId,clientSecret:value.clientSecret};}catch{return null;}return null;}
  return env.AUTH_GOOGLE_CLIENT_ID&&env.AUTH_GOOGLE_CLIENT_SECRET?{clientId:env.AUTH_GOOGLE_CLIENT_ID,clientSecret:env.AUTH_GOOGLE_CLIENT_SECRET}:null;
}
function googleReady(env:AuthEnv){return configured(env)&&!!googleConfig(env);}
function emailReady(env: AuthEnv) {
  if (!configured(env) || !env.RESEND_API_KEY || !emailPattern.test(env.RESEND_FROM || '')) return false;
  return env.RESEND_MODE === 'live' ? env.APP_ENV === 'production' && env.RESEND_LIVE_APPROVED === 'true' : env.RESEND_MODE === 'sandbox' && ['test','staging'].includes(env.APP_ENV || '') && emailPattern.test(env.RESEND_TEST_RECIPIENT || '');
}
function page(title: string, body: string, status = 200, cookies?: string, autoVerify = false) {
  // Preserve the POST Origin for CSRF checks without sending magic-link paths.
  const nonce=autoVerify?random():'';
  const headers = new Headers({'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'private, no-store', 'Referrer-Policy':'strict-origin', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"+(nonce?`; script-src 'nonce-${nonce}'`:'')});
  if (cookies) headers.set('Set-Cookie', cookies);
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} · Braand</title><link rel="stylesheet" href="/auth.css"><link rel="icon" href="/favicon.svg?v=relais-1"></head><body><main><a class="brand" href="/"><img src="/brand/relais-logo-dark.svg" alt="Braand" width="126" height="33"></a><h1>${escape(title)}</h1>${body}<a class="back" href="/">Revenir à Braand</a></main>${nonce?`<script nonce="${nonce}">document.getElementById('verify-form').requestSubmit();</script>`:''}</body></html>`, {status, headers});
}
function notice(request: Request, title: string, message: string, status = 200) {
  return request.headers.get('accept')?.includes('application/json')
    ? Response.json({title, message}, {status, headers:{'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'}})
    : page(title, `<p>${escape(message)}</p>`, status);
}
const denied = () => page('Connexion impossible', '<p>Ce lien est expiré, a déjà été utilisé ou appartient à un autre navigateur. Demandez un nouveau lien depuis cet appareil.</p><a class="button" href="/auth/sign-in">Demander un nouveau lien</a>', 400);
function redirect(location: string, cookies?: string) {return new Response(null, {status:303, headers:{Location:location, 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', ...(cookies ? {'Set-Cookie':cookies} : {})}});}
async function rate(env: AuthEnv, category: string, value: string, max: number, period: number, now: number) {
  const slot = Math.floor(now / period), bucket = await hash(`rate:${category}:${slot}:${value}`, env);
  const row = await env.DB!.prepare('INSERT INTO auth_rate_limits(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(bucket, (slot+1)*period, max).first<{count:number}>();
  return !!row;
}
async function ensureUser(env:AuthEnv,email:string,now:number,pending?:PendingPassword|null){
 const userId=crypto.randomUUID();
 await env.DB!.batch([
  env.DB!.prepare('INSERT INTO auth_users(id,email,verified_at,created_at) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(userId,email,now,now),
  env.DB!.prepare("INSERT OR IGNORE INTO organizations(id,name,owner_id,created_at) SELECT id,'Mon entreprise',id,created_at FROM auth_users WHERE id=?").bind(userId),
  env.DB!.prepare("INSERT OR IGNORE INTO organization_members(organization_id,user_id,role) SELECT id,id,'owner' FROM auth_users WHERE id=?").bind(userId),
  env.DB!.prepare("INSERT OR IGNORE INTO workspaces(id,name,created_at,organization_id) SELECT id,'Mon entreprise',created_at,id FROM auth_users WHERE id=?").bind(userId),
  env.DB!.prepare("INSERT OR IGNORE INTO members(id,workspace_id,user_id,role) SELECT id,id,id,'owner' FROM auth_users WHERE id=?").bind(userId),
  env.DB!.prepare('INSERT OR IGNORE INTO billing_claims(user_id,organization_id,day,units,created_at) SELECT id,id,?,?,created_at FROM auth_users WHERE id=?').bind(new Date(now).toISOString().slice(0,10),WELCOME_UNITS,userId),
  env.DB!.prepare("INSERT OR IGNORE INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,expires_at,created_at) SELECT 'free:'||user_id,organization_id,'free',user_id,units,units,created_at,created_at+?,created_at FROM billing_claims WHERE user_id=?").bind(WELCOME_TTL,userId),
  ...(pending?[env.DB!.prepare('INSERT INTO auth_passwords(user_id,salt,digest,iterations,updated_at) SELECT id,?,?,?,? FROM auth_users WHERE email=? ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,digest=excluded.digest,iterations=excluded.iterations,updated_at=excluded.updated_at').bind(pending.salt,pending.digest,pending.iterations,now,email),env.DB!.prepare('DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM auth_users WHERE email=?)').bind(email)]:[])
 ]);
 return env.DB!.prepare('SELECT id FROM auth_users WHERE email=?').bind(email).first<{id:string}>();
}
async function issueSession(env:AuthEnv,userId:string,now:number){const session=random();await env.DB!.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash('session:'+session,env),userId,now+604_800_000,now).run();return session;}
export async function sessionIdentity(headers: Headers, env: AuthEnv, now = Date.now()): Promise<BraandIdentity | null> {
  if (!configured(env)) return null;
  const token = cookie(headers, SESSION_COOKIE); if (!token) return null;
  const row = await env.DB!.prepare('SELECT u.id,u.email FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash('session:' + token, env), now).first<{id:string; email:string}>();
  return row ? {userId:row.id, email:row.email, displayName:row.email, fullName:null} : null;
}
export async function authenticatedRequest(request: Request, env: AuthEnv) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-user-') || name.startsWith('x-braand-identity-')) headers.delete(name);
  const user = await sessionIdentity(headers, env);
  if (user) {headers.set('x-braand-identity-id', user.userId); headers.set('x-braand-identity-email', user.email);}
  return new Request(request, {headers});
}
export async function cleanupAuth(env: AuthEnv, now = Date.now()) {
  if (!env.DB) return;
  await env.DB.batch(['auth_challenges','auth_sessions','auth_rate_limits','auth_google_states'].map(table => env.DB!.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(now)));
}
export async function handleAuth(request: Request, env: AuthEnv, now = Date.now()): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith('/auth/') && !['/signin-with-chatgpt','/signout-with-chatgpt'].includes(path)) return null;
  if (path.includes('with-chatgpt')) return redirect(path.startsWith('/signin') ? '/auth/sign-in' : '/auth/sign-out');
  if (!configured(env)) return page('Connexion bientôt disponible', '<p>La connexion Braand attend la configuration sécurisée du serveur. Votre brouillon reste sur cet appareil.</p>', 503);
  if (url.origin !== origin(env)) return page('Adresse non autorisée', '<p>Utilisez l’adresse officielle de Braand.</p>', 403);
  if (!['GET','POST'].includes(request.method)) return new Response(null, {status:405, headers:{Allow:'GET, POST'}});
  if (request.method === 'POST' && (request.headers.get('origin') !== origin(env) || request.headers.get('sec-fetch-site') === 'cross-site')) return denied();
  if (request.method === 'POST' && !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return denied();
  // This bound applies to chunked requests too, including logout requests.
  let form: URLSearchParams | null = null;
  if (request.method === 'POST') {form=await readForm(request); if (!form) return denied();}
  if ((path === '/auth/sign-in' || path === '/auth/form') && request.method === 'GET') {
    const returnTo = safeAuthReturn(url.searchParams.get('return_to'));
    const authenticated = Boolean(await sessionIdentity(request.headers, env, now));
    if (path === '/auth/sign-in') return redirect(authenticated ? returnTo : '/?auth=sign-in&return_to=' + encodeURIComponent(returnTo));
    const headers = new Headers({'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'});
    if (authenticated) return Response.json({authenticated:true, returnTo}, {headers});
    // Refreshes and other tabs must not invalidate a link that was already sent.
    const browser = cookie(request.headers, LOGIN_COOKIE) || random();
    headers.set('Set-Cookie', setCookie(LOGIN_COOKIE, browser, 600));
    return Response.json({authenticated:false, browser, returnTo,...(googleReady(env)?{googleAvailable:true}:{})}, {headers});
  }
  if (path === '/auth/sign-out') {
    if (request.method === 'GET') return page('Se déconnecter', '<p>Votre travail enregistré restera disponible lors de votre prochaine connexion.</p><form method="post" action="/auth/sign-out"><button type="submit">Confirmer la déconnexion</button></form>');
    const token = cookie(request.headers, SESSION_COOKIE);
    if (token) await env.DB!.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash('session:' + token, env)).run();
    const response = redirect('/', setCookie(SESSION_COOKIE, '', 0));
    response.headers.append('Set-Cookie', setCookie(SESSION_COOKIE.replace('braand', LEGACY_PREFIX), '', 0));
    response.headers.set('Clear-Site-Data','"storage"');
    return response;
  }
  if(path==='/auth/google'&&request.method==='GET'){
    const browser=cookie(request.headers,LOGIN_COOKIE),ip=request.headers.get('cf-connecting-ip'),credentials=googleConfig(env);
    if(!googleReady(env)||!credentials||!browser||!ip&&env.APP_ENV!=='test')return page('Connexion Google indisponible','<p>Réessayez depuis la fenêtre de connexion Braand.</p>',503);
    if(!await rate(env,'google-ip',ip||'offline-fixture',20,600_000,now))return page('Patientez un instant','<p>Trop de tentatives. Réessayez dans quelques minutes.</p>',429);
    const state=random(),verifier=await hash('google-pkce:'+state+':'+browser,env);
    const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',text.encode(verifier))));
    await env.DB!.prepare('INSERT INTO auth_google_states(state_hash,browser_hash,return_to,expires_at) VALUES (?,?,?,?)').bind(await hash('google-state:'+state,env),await hash('browser:'+browser,env),safeAuthReturn(url.searchParams.get('return_to')),now+600_000).run();
    const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for(const [key,value] of Object.entries({client_id:credentials.clientId,redirect_uri:origin(env)+'/auth/google/callback',response_type:'code',scope:'openid email profile',state,nonce:state,code_challenge:challenge,code_challenge_method:'S256'}))google.searchParams.set(key,value);
    return redirect(google.href);
  }
  if(path==='/auth/google/callback'&&request.method==='GET'){
    const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'',browser=cookie(request.headers,LOGIN_COOKIE),credentials=googleConfig(env);
    if(!googleReady(env)||!credentials||!browser||!tokenPattern.test(state)||!code||code.length>2048)return denied();
    const saved=await env.DB!.prepare('DELETE FROM auth_google_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING return_to').bind(await hash('google-state:'+state,env),await hash('browser:'+browser,env),now).first<{return_to:string}>();
    if(!saved)return denied();
    try{
      const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:credentials.clientId,client_secret:credentials.clientSecret,redirect_uri:origin(env)+'/auth/google/callback',grant_type:'authorization_code',code_verifier:await hash('google-pkce:'+state+':'+browser,env)}),signal:AbortSignal.timeout(8000)});
      if(!tokenResponse.ok)throw new Error('google_token_unavailable');
      const payload=await tokenResponse.json() as {id_token?:unknown};if(typeof payload.id_token!=='string'||payload.id_token.length>16000)throw new Error('google_token_invalid');
      const verified=await jwtVerify(payload.id_token,googleKeys,{algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:credentials.clientId,currentDate:new Date(now),clockTolerance:5});
      const claims=verified.payload,email=typeof claims.email==='string'?claims.email.trim().toLowerCase():'',subject=claims.sub||'';
      if(claims.nonce!==state||claims.email_verified!==true||!emailPattern.test(email)||email.length>254||!subject||subject.length>255)throw new Error('google_identity_invalid');
      const linked=await env.DB!.prepare('SELECT user_id FROM auth_google_identities WHERE subject=?').bind(subject).first<{user_id:string}>();
      let userId=linked?.user_id;
      if(!userId){
        const existing=await env.DB!.prepare('SELECT id FROM auth_users WHERE email=?').bind(email).first<{id:string}>(),current=await sessionIdentity(request.headers,env,now);
        // Google is authoritative for Gmail and verified Workspace addresses.
        // Other providers can recycle addresses after Google verified them.
        const domain=email.split('@')[1],authoritative=domain==='gmail.com'||typeof claims.hd==='string'&&claims.hd.toLowerCase()===domain;
        if(existing&&!authoritative&&current?.userId!==existing.id)return page('Association nécessaire','<p>Utilisez votre adresse e-mail et votre mot de passe pour vous connecter à ce compte.</p>',409);
        userId=existing?.id||(await ensureUser(env,email,now))?.id;if(!userId)throw new Error('google_account_unavailable');
        await env.DB!.prepare('INSERT OR IGNORE INTO auth_google_identities(subject,user_id,created_at) VALUES (?,?,?)').bind(subject,userId,now).run();
        const identity=await env.DB!.prepare('SELECT user_id FROM auth_google_identities WHERE subject=?').bind(subject).first<{user_id:string}>();
        if(identity?.user_id!==userId)throw new Error('google_identity_conflict');
      }
      const session=await issueSession(env,userId,now),response=redirect(safeAuthReturn(saved.return_to),setCookie(SESSION_COOKIE,session,604800));
      response.headers.append('Set-Cookie',setCookie(LOGIN_COOKIE,'',0));return response;
    }catch{return page('Connexion Google impossible','<p>La connexion n’a pas pu être vérifiée. Réessayez ou utilisez votre adresse e-mail.</p>',503);}
  }
  // Bound bodies before parsing; never log addresses, links or provider payloads.
  if (Number(request.headers.get('content-length') || 0) > 4096) return denied();
  if (path === '/auth/request' && form) {
    if (!emailReady(env)) return notice(request, 'Connexion indisponible', 'L’envoi du lien n’est pas encore configuré. Réessayez plus tard.', 503);
    const email = (form.get('email') || '').trim().toLowerCase(), browser = cookie(request.headers, LOGIN_COOKIE), password=form.get('new_password');
    if (!browser || form.get('browser') !== browser || email.length > 254 || !emailPattern.test(email)) return denied();
    if (password!==null&&!validPassword(password)) return notice(request,'Mot de passe invalide','Choisissez au moins 12 caractères et au plus 128 octets.',400);
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip && env.APP_ENV !== 'test') return notice(request, 'Connexion indisponible', 'Réessayez depuis l’adresse officielle de Braand.', 503);
    if (!await rate(env, 'ip', ip || 'offline-fixture', 10, 600_000, now) || !await rate(env, 'global', 'mail', 100, 600_000, now)) return notice(request, 'Patientez un instant', 'Trop de demandes. Réessayez dans quelques minutes.', 429);
    const generic = () => notice(request, 'Consultez votre messagerie', 'Si cette adresse est autorisée, un lien valable dix minutes vous sera envoyé. Ouvrez le lien dans ce navigateur.');
    if (env.RESEND_MODE === 'sandbox' && email !== env.RESEND_TEST_RECIPIENT?.toLowerCase()) return generic();
    if (!await rate(env, 'email', email, 1, 60_000, now)) return generic();
    const token = random(), id = crypto.randomUUID();
    await env.DB!.prepare('INSERT INTO auth_challenges(id,email,token_hash,browser_hash,expires_at,return_to,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, email, await hash('challenge:' + token, env), await hash('browser:' + browser, env), now+600_000, safeAuthReturn(form.get('return_to')), now).run();
    const link = `${origin(env)}/auth/verify?id=${id}&token=${token}`;
    try {
      if(password!==null){const salt=encode(crypto.getRandomValues(new Uint8Array(16))),digest=await derivePassword(password,salt,env);await env.DB!.prepare('INSERT INTO auth_pending_passwords(challenge_id,salt,digest,iterations) VALUES (?,?,?,?)').bind(id,salt,digest,PASSWORD_ITERATIONS).run();}
      const response = await fetch('https://api.resend.com/emails', {method:'POST', headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':`braand-auth/${id}`}, body:JSON.stringify({from:env.RESEND_FROM, to:[email], subject:'Votre lien de connexion Braand', text:`Pour retrouver votre espace Braand, ouvrez ce lien dans le navigateur où vous avez demandé la connexion :\n${link}\nCe lien expire dans dix minutes et ne peut être utilisé qu’une fois. Si vous n’avez rien demandé, ignorez ce message.`}), signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error('email_rejected');
    } catch {
      // Invalidate even an uncertain send. Never resend authentication links blindly.
      await env.DB!.prepare('DELETE FROM auth_challenges WHERE id=?').bind(id).run();
      return notice(request, 'Envoi impossible', 'Le lien n’a pas pu être envoyé. Réessayez dans une minute.', 503);
    }
    return generic();
  }
  if(path==='/auth/password'&&form){
    const email=(form.get('email')||'').trim().toLowerCase(),password=form.get('password')||'',browser=cookie(request.headers,LOGIN_COOKIE),ip=request.headers.get('cf-connecting-ip');
    if(!browser||form.get('browser')!==browser||email.length>254||!emailPattern.test(email)||text.encode(password).length>128||!ip&&env.APP_ENV!=='test')return denied();
    if(!await rate(env,'password-ip',ip||'offline-fixture',30,600_000,now)||!await rate(env,'password-email',email,8,600_000,now))return notice(request,'Patientez un instant','Trop de tentatives. Réessayez dans quelques minutes.',429);
    const row=await env.DB!.prepare('SELECT u.id,p.salt,p.digest,p.iterations FROM auth_users u JOIN auth_passwords p ON p.user_id=u.id WHERE u.email=?').bind(email).first<{id:string;salt:string;digest:string;iterations:number}>();
    const validRow=!!row&&/^[A-Za-z0-9_-]{22}$/.test(row.salt)&&tokenPattern.test(row.digest)&&row.iterations===PASSWORD_ITERATIONS;
    const actual=await derivePassword(password,validRow?row!.salt:'AAAAAAAAAAAAAAAAAAAAAA',env);
    const matched=sameDigest(actual,validRow?row!.digest:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if(!validRow||!matched)return notice(request,'Connexion impossible','Adresse e-mail ou mot de passe incorrect.',401);
    const session=await issueSession(env,row!.id,now);
    const response=notice(request,'Connexion réussie',safeAuthReturn(form.get('return_to')));
    response.headers.append('Set-Cookie',setCookie(SESSION_COOKIE,session,604800));response.headers.append('Set-Cookie',setCookie(LOGIN_COOKIE,'',0));return response;
  }
  if (path === '/auth/verify') {
    const id = form?.get('id') || url.searchParams.get('id') || '', token = form?.get('token') || url.searchParams.get('token') || '', browser = cookie(request.headers, LOGIN_COOKIE);
    if (!/^[a-f0-9-]{36}$/.test(id) || !tokenPattern.test(token) || !browser) return denied();
    const tokenHash = await hash('challenge:' + token, env), browserHash = await hash('browser:' + browser, env);
    if (request.method === 'GET') {
      // Link scanners cannot consume a challenge or create a session.
      const row = await env.DB!.prepare('SELECT id FROM auth_challenges WHERE id=? AND token_hash=? AND browser_hash=? AND expires_at>?').bind(id,tokenHash,browserHash,now).first();
      return row ? page('Vérification en cours', `<p>Vous allez retrouver votre espace Braand.</p><form id="verify-form" method="post" action="/auth/verify"><input type="hidden" name="id" value="${id}"><input type="hidden" name="token" value="${token}"><noscript><button type="submit">Continuer</button></noscript></form>`,200,undefined,true) : denied();
    }
    // Atomic consume: concurrent clicks can produce only one authenticated session.
    const pending=await env.DB!.prepare('SELECT p.salt,p.digest,p.iterations FROM auth_pending_passwords p JOIN auth_challenges c ON c.id=p.challenge_id WHERE c.id=? AND c.token_hash=? AND c.browser_hash=? AND c.expires_at>?').bind(id,tokenHash,browserHash,now).first<{salt:string;digest:string;iterations:number}>();
    const challenge = await env.DB!.prepare('DELETE FROM auth_challenges WHERE id=? AND token_hash=? AND browser_hash=? AND expires_at>? RETURNING id,email,browser_hash,return_to').bind(id,tokenHash,browserHash,now).first<Challenge>();
    if (!challenge) return denied();
    // The candidate ID scopes welcome credits to newly created accounts only.
    const user=await ensureUser(env,challenge.email,now,pending);
    if (!user) return denied();
    const session=await issueSession(env,user.id,now);
    const response = redirect(safeAuthReturn(challenge.return_to), setCookie(SESSION_COOKIE, session, 604800));
    response.headers.append('Set-Cookie', setCookie(LOGIN_COOKIE, '', 0)); return response;
  }
  return page('Page introuvable', '<p>Cette page de connexion n’existe pas.</p>', 404);
}
