// Real SQLite + Web Crypto. Only the email provider is simulated.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
const outfile=path.join(project,'.local-build/auth-runtime-test.mjs');
mkdirSync(path.dirname(outfile),{recursive:true});
await build({entryPoints:['lib/auth-runtime.ts'],outfile,bundle:true,platform:'node',format:'esm'});
const auth=await import(pathToFileURL(outfile));
const workerFile=path.join(project,'.local-build/auth-worker-test.mjs');
await build({entryPoints:['build/worker.ts'],outfile:workerFile,bundle:true,platform:'node',format:'esm',define:{'import.meta.env.DEV':'false'},plugins:[{name:'isolated-worker-dependencies',setup(builder){
 builder.onResolve({filter:/^(vinext\/server\/fetch-handler|\.\.\/lib\/(operations|browser-session-do))$/},args=>({path:args.path,namespace:'worker-fixture'}));
 builder.onLoad({filter:/.*/,namespace:'worker-fixture'},args=>({loader:'js',contents:args.path==='vinext/server/fetch-handler'?'export default {fetch:async request=>Response.json({id:request.headers.get("x-braand-identity-id"),email:request.headers.get("x-braand-identity-email"),legacy:request.headers.get("oai-authenticated-user-id")})}':args.path.endsWith('operations')?'export async function raiseOperationalAlert(){}':'export class BrowserSession{}'}));
}}]});
const worker=(await import(pathToFileURL(workerFile))).default;
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
function statement(query,args=[]){return {bind(...values){return statement(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};}};}
const env={DB:{prepare:query=>statement(query),async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}},APP_ENV:'test',APP_ORIGIN:'https://braand.test',AUTH_ENABLED:'true',AUTH_HASH_SECRET:'offline-auth-fixture-'.repeat(3),RESEND_MODE:'sandbox',RESEND_FROM:'sender@braand.test',RESEND_TEST_RECIPIENT:'owner@braand.test',RESEND_API_KEY:'offline-email-key'};
const now=Date.now();
let checks=0;
const check=async(name,fn)=>{await fn();console.log('PASS '+name);checks++;};
const req=(path,body,cookie='',extra={})=>new Request('https://braand.test'+path,{method:body?'POST':'GET',headers:{...(body?{origin:'https://braand.test','Content-Type':'application/x-www-form-urlencoded'}:{}),cookie,...extra},...(body?{body:new URLSearchParams(body).toString()}:{})});
const originalFetch=globalThis.fetch;const mails=[];let fail=false;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');if(fail)throw new Error('provider-secret-that-must-stay-private');mails.push(JSON.parse(options.body));return Response.json({id:'offline-mail'});};
let loginCookie,browser,link,sessionCookie;
try {
 await check('disabled auth ignores both legacy and spoofed identity headers',async()=>{const r=await auth.authenticatedRequest(req('/',null,'',{'x-braand-identity-id':'victim','x-braand-identity-email':'victim@braand.test','oai-authenticated-user-id':'victim'}),{...env,AUTH_ENABLED:'false'});assert.equal(r.headers.get('x-braand-identity-id'),null);assert.equal(r.headers.get('oai-authenticated-user-id'),null);});
 await check('unknown auth configuration fails closed without an email',async()=>{assert.equal((await auth.handleAuth(req('/auth/sign-in'),{...env,AUTH_HASH_SECRET:''},now)).status,503);assert.equal(mails.length,0);});
 await check('legacy sign-in opens the Braand dialog rather than a separate login page',async()=>{const r=await auth.handleAuth(req('/auth/sign-in?return_to=%2F%3Fsettings%3Dbilling'),env,now);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?auth=sign-in&return_to=%2F%3Fsettings%3Dbilling');assert.equal(await r.text(),'');assert.equal(mails.length,0);});
 await check('dialog initialization uses a private secure same-site cookie without sending email',async()=>{const r=await auth.handleAuth(req('/auth/form?return_to=%2F%3Fview%3Dbilling'),env,now);assert.equal(r.status,200);loginCookie=r.headers.get('set-cookie').split(';')[0];browser=loginCookie.split('=')[1];assert.match(r.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(await r.json(),{authenticated:false,browser,returnTo:'/?view=billing'});assert.equal(mails.length,0);});
 await check('refreshing sign-in or opening another tab preserves the pending email browser binding',async()=>{const r=await auth.handleAuth(req('/auth/form',null,loginCookie),env,now);assert.equal(r.status,200);assert.equal(r.headers.getSetCookie().find(value=>value.startsWith('__Host-braand_login=')).split(';')[0],loginCookie);assert.equal(mails.length,0);});
 await check('cross-origin login and wrong CSRF browser nonce are refused',async()=>{assert.equal((await auth.handleAuth(req('/auth/request',{email:'owner@braand.test',browser},loginCookie,{origin:'https://evil.test'}),env,now)).status,400);assert.equal((await auth.handleAuth(req('/auth/request',{email:'owner@braand.test',browser:'wrong'},loginCookie),env,now)).status,400);assert.equal(mails.length,0);});
 await check('oversized chunked forms are rejected before parsing or sending email',async()=>{const request=new Request('https://braand.test/auth/request',{method:'POST',headers:{origin:env.APP_ORIGIN,'content-type':'application/x-www-form-urlencoded',cookie:loginCookie},body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('email='+ 'a'.repeat(5000)));controller.close();}}),duplex:'half'});assert.equal((await auth.handleAuth(request,env,now)).status,400);assert.equal(mails.length,0);});
 await check('sandbox cannot send to arbitrary accounts or reveal registration state',async()=>{const r=await auth.handleAuth(req('/auth/request',{email:'other@braand.test',browser},loginCookie,{accept:'application/json'}),env,now);assert.equal(r.status,200);assert.equal((await r.json()).title,'Consultez votre messagerie');assert.equal(mails.length,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_users').get().n,0);});
 await check('only a token hash is stored; canonical links are sent once with no response leak',async()=>{const r=await auth.handleAuth(req('/auth/request',{email:'OWNER@braand.test',browser,return_to:'/?view=billing'},loginCookie,{accept:'application/json'}),env,now);assert.equal(r.status,200);assert.equal(mails.length,1);link=new URL(mails[0].text.match(/https:\/\/[^\s]+/)[0]);assert.equal(link.origin,'https://braand.test');const row=sql.prepare('SELECT * FROM auth_challenges').get();assert.notEqual(row.token_hash,link.searchParams.get('token'));assert.notEqual(row.browser_hash,browser);assert.doesNotMatch(await r.text(),new RegExp(link.searchParams.get('token')));});
 await check('email cooldown prevents double submits and duplicate sends',async()=>{const r=await auth.handleAuth(req('/auth/request',{email:'owner@braand.test',browser},loginCookie),env,now);assert.equal(r.status,200);assert.equal(mails.length,1);});
 await check('dialog reinitialization after sending preserves the pending link',async()=>{const r=await auth.handleAuth(req('/auth/form',null,loginCookie),env,now);assert.equal((await r.json()).browser,browser);assert.equal((await auth.handleAuth(req(link.pathname+link.search,null,loginCookie),env,now)).status,200);assert.equal(mails.length,1);});
 await check('link scanners never consume a login, and another browser is refused',async()=>{let r=await auth.handleAuth(req(link.pathname+link.search,null,loginCookie),env,now);assert.equal(r.status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);r=await auth.handleAuth(req(link.pathname+link.search),env,now);assert.equal(r.status,400);});
 await check('expired challenge cannot create a session even with the matching browser',async()=>{assert.equal((await auth.handleAuth(req('/auth/verify',Object.fromEntries(link.searchParams),loginCookie),env,now+600001)).status,400);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);});
 await check('single-use verification rejects double-click races atomically',async()=>{const form=Object.fromEntries(link.searchParams);const results=await Promise.all([auth.handleAuth(req('/auth/verify',form,loginCookie),env,now),auth.handleAuth(req('/auth/verify',form,loginCookie),env,now)]);assert.deepEqual(results.map(r=>r.status).sort(),[303,400]);const success=results.find(r=>r.status===303);assert.equal(success.headers.get('location'),'/?view=billing');sessionCookie=success.headers.getSetCookie().find(c=>c.startsWith('__Host-braand_session=')).split(';')[0];assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,1);});
 await check('an existing session skips the sign-in form, preserves its cookies and uses only a safe return path',async()=>{for(const [destination,expected] of [['/?settings=billing','/?settings=billing'],['https://evil.test/','/'],['/auth/sign-in','/'],['/?auth=sign-in&return_to=%2F','/']]){const r=await auth.handleAuth(req('/auth/sign-in?return_to='+encodeURIComponent(destination),null,sessionCookie),env,now);assert.equal(r.status,303);assert.equal(r.headers.get('location'),expected);assert.equal(r.headers.getSetCookie().length,0);assert.equal(await r.text(),'');}assert.equal(mails.length,1);});
 await check('an authenticated dialog returns the safe destination without resetting login cookies',async()=>{const r=await auth.handleAuth(req('/auth/form?return_to=%2F%3Fsettings%3Dbilling',null,sessionCookie),env,now);assert.deepEqual(await r.json(),{authenticated:true,returnTo:'/?settings=billing'});assert.equal(r.headers.getSetCookie().length,0);});
 await check('reopening the dialog after an email keeps the same link valid',async()=>{const r=await auth.handleAuth(req('/auth/form',null,loginCookie),env,now);assert.equal((await r.json()).browser,browser);});
 await check('verified signup automatically grants exactly 15 credits for seven days with personal ownership',async()=>{
  const user=sql.prepare('SELECT id FROM auth_users').get(),lot=sql.prepare("SELECT * FROM credit_lots WHERE id=?").get('free:'+user.id);
  assert.equal(lot.organization_id,user.id);assert.equal(lot.source_id,user.id);assert.equal(lot.granted,1500);assert.equal(lot.balance,1500);assert.equal(lot.starts_at,now);assert.equal(lot.expires_at,now+7*86400000);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM billing_claims').get().n,1);
  assert.equal(sql.prepare('SELECT role FROM organization_members WHERE organization_id=? AND user_id=?').get(user.id,user.id).role,'owner');
  assert.equal(sql.prepare('SELECT organization_id FROM workspaces WHERE id=?').get(user.id).organization_id,user.id);
 });
 await check('reconnecting after consumption or expiration cannot replenish or extend the welcome grant',async()=>{
  const before=sql.prepare('SELECT * FROM credit_lots').get();sql.prepare('UPDATE credit_lots SET balance=0 WHERE id=?').run(before.id);
  const later=now+8*86400000;
  await auth.handleAuth(req('/auth/request',{email:'owner@braand.test',browser},loginCookie),env,later);
  const nextLink=new URL(mails.at(-1).text.match(/https:\/\/[^\s]+/)[0]);
  assert.equal((await auth.handleAuth(req('/auth/verify',Object.fromEntries(nextLink.searchParams),loginCookie),env,later)).status,303);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_users').get().n,1);
  assert.deepEqual({...sql.prepare('SELECT * FROM credit_lots').get()},{...before,balance:0});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM billing_claims').get().n,1);
 });
 await check('private session overrides spoofed headers and preserves a stable user',async()=>{const user=await auth.sessionIdentity(new Headers({cookie:sessionCookie}),env,now);assert.equal(user.email,'owner@braand.test');const r=await auth.authenticatedRequest(req('/',null,sessionCookie,{'x-braand-identity-id':'victim','oai-authenticated-user-email':'victim@braand.test'}),env);assert.equal(r.headers.get('x-braand-identity-id'),user.userId);assert.equal(r.headers.get('oai-authenticated-user-email'),null);});
 await check('legacy authenticated sessions remain usable during cookie migration',async()=>{const token=sessionCookie.slice(sessionCookie.indexOf('=')+1),legacyName='__Host-'+['ai','ra'].join('')+'_session',legacyCookie=legacyName+'='+token;const user=await auth.sessionIdentity(new Headers({cookie:legacyCookie}),env,now);assert.equal(user.email,'owner@braand.test');const request=await auth.authenticatedRequest(req('/',null,legacyCookie),env);assert.equal(request.headers.get('x-braand-identity-id'),user.userId);});
 await check('production Worker authenticates before routing and strips every supplied identity',async()=>{const extra={'x-braand-identity-id':'victim','x-braand-identity-email':'victim@braand.test','oai-authenticated-user-id':'victim'};let response=await worker.fetch(req('/api/workspace',null,'',extra),env,{});assert.deepEqual(await response.json(),{id:null,email:null,legacy:null});response=await worker.fetch(req('/api/workspace',null,sessionCookie,extra),env,{});assert.deepEqual(await response.json(),{id:sql.prepare('SELECT id FROM auth_users').get().id,email:'owner@braand.test',legacy:null});response=await worker.fetch(req('/api/workspace',null,sessionCookie,extra),{...env,DB:{prepare(){throw new Error('private-db-details');}}},{});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-db-details|victim/);});
 await check('duplicate session cookies and expired sessions are unauthenticated',async()=>{assert.equal(await auth.sessionIdentity(new Headers({cookie:sessionCookie+'; '+sessionCookie}),env,now),null);assert.equal(await auth.sessionIdentity(new Headers({cookie:sessionCookie}),env,now+604800001),null);});
 await check('logout requires confirmation POST and revokes the server-side session',async()=>{assert.equal((await auth.handleAuth(req('/auth/sign-out',null,sessionCookie),env,now)).status,200);assert.ok(await auth.sessionIdentity(new Headers({cookie:sessionCookie}),env,now));assert.equal((await auth.handleAuth(req('/auth/sign-out',{confirm:'yes'},sessionCookie,{origin:'https://evil.test'}),env,now)).status,400);assert.equal((await auth.handleAuth(req('/auth/sign-out',{confirm:'yes'},sessionCookie),env,now)).status,303);assert.equal(await auth.sessionIdentity(new Headers({cookie:sessionCookie}),env,now),null);});
 await check('open redirects and host-header poisoning are blocked',async()=>{for(const value of ['//evil.test','https://evil.test','/\\evil.test','/auth/verify'])assert.equal(auth.safeAuthReturn(value),'/');const poisoned=new Request('https://evil.test/auth/sign-in');assert.equal((await auth.handleAuth(poisoned,env,now)).status,403);});
 await check('failed email invalidates the link and never leaks provider errors',async()=>{fail=true;const r=await auth.handleAuth(req('/auth/request',{email:'owner@braand.test',browser},loginCookie),env,now+60001);assert.equal(r.status,503);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);assert.doesNotMatch(await r.text(),/provider-secret/);});
 await check('expired auth metadata is removed, verified accounts are retained',async()=>{await auth.cleanupAuth(env,now+9*86400000);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_rate_limits').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_users').get().n,1);});
 const register=async(email,at)=>{
  env.RESEND_TEST_RECIPIENT=email;
  const start=await auth.handleAuth(req('/auth/form'),env,at),cookie=start.headers.get('set-cookie').split(';')[0],nonce=cookie.split('=')[1];
  await auth.handleAuth(req('/auth/request',{email,browser:nonce},cookie),env,at);
  const sent=new URL(mails.at(-1).text.match(/https:\/\/[^\s]+/)[0]);
  return auth.handleAuth(req('/auth/verify',Object.fromEntries(sent.searchParams),cookie),env,at);
 };
 await check('every new verified user receives a separate grant even when manual discovery is disabled',async()=>{
  fail=false;env.FREE_DAILY_CREDITS='0';
  for(const [index,email] of ['second@braand.test','third@braand.test'].entries()){
   const at=now+(10+index)*86400000;
   assert.equal((await register(email,at)).status,303);
   const user=sql.prepare('SELECT id FROM auth_users WHERE email=?').get(email),lots=sql.prepare('SELECT * FROM credit_lots WHERE source_id=?').all(user.id);
   assert.equal(lots.length,1);assert.equal(lots[0].balance,1500);assert.equal(lots[0].expires_at,at+7*86400000);
  }
 });
 await check('a failed wallet insertion rolls back account creation and can be retried with a new link',async()=>{
  const before=sql.prepare('SELECT COUNT(*) n FROM auth_users').get().n;
  sql.exec("CREATE TRIGGER fixture_fail_welcome BEFORE INSERT ON credit_lots BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
  await assert.rejects(()=>register('retry@braand.test',now+12*86400000));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_users').get().n,before);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM billing_claims WHERE user_id NOT IN (SELECT id FROM auth_users)").get().n,0);
  sql.exec('DROP TRIGGER fixture_fail_welcome');
  assert.equal((await register('retry@braand.test',now+12*86400000+60001)).status,303);
  const user=sql.prepare('SELECT id FROM auth_users WHERE email=?').get('retry@braand.test');
  assert.equal(sql.prepare('SELECT balance FROM credit_lots WHERE source_id=?').get(user.id).balance,1500);
 });
 await check('existing email accounts can set a password only after verification and sign in without sending another email',async()=>{
  const email='owner@braand.test',password='fixture-long-password-123',at=now+20*86400000;env.RESEND_TEST_RECIPIENT=email;
  const original=sql.prepare('SELECT id FROM auth_users WHERE email=?').get(email),beforeGrant=sql.prepare('SELECT * FROM credit_lots WHERE source_id=?').get(original.id);
  const start=await auth.handleAuth(req('/auth/form?return_to=%2F%3Fview%3Dprojects'),env,at),cookie=start.headers.get('set-cookie').split(';')[0],nonce=cookie.split('=')[1];
  const created=await auth.handleAuth(req('/auth/request',{email,browser:nonce,new_password:password,return_to:'/?view=projects'},cookie,{accept:'application/json'}),env,at);assert.equal(created.status,200);
  const pending=sql.prepare('SELECT * FROM auth_pending_passwords').get();assert.ok(pending);assert.ok(!JSON.stringify(pending).includes(password));assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_passwords WHERE user_id=?').get(original.id).n,0);
  const verification=new URL(mails.at(-1).text.match(/https:\/\/[^\s]+/)[0]);const scan=await auth.handleAuth(req(verification.pathname+verification.search),env,at);assert.equal(scan.status,400);
  const preview=await auth.handleAuth(req(verification.pathname+verification.search,null,cookie),env,at);assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/script-src 'nonce-/);assert.match(await preview.text(),/requestSubmit/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_passwords WHERE user_id=?').get(original.id).n,0);
  const verified=await auth.handleAuth(req('/auth/verify',Object.fromEntries(verification.searchParams),cookie),env,at);assert.equal(verified.status,303);assert.equal(verified.headers.get('location'),'/?view=projects');
  const saved=sql.prepare('SELECT * FROM auth_passwords WHERE user_id=?').get(original.id);assert.equal(saved.iterations,32768);assert.notEqual(saved.digest,password);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_pending_passwords').get().n,0);
  assert.deepEqual({...sql.prepare('SELECT * FROM credit_lots WHERE source_id=?').get(original.id)},{...beforeGrant});
  const second=await auth.handleAuth(req('/auth/form'),env,at+1000),secondCookie=second.headers.get('set-cookie').split(';')[0],secondNonce=secondCookie.split('=')[1],mailCount=mails.length;
  const wrong=await auth.handleAuth(req('/auth/password',{email,password:'wrong-password',browser:secondNonce},secondCookie,{accept:'application/json'}),env,at+1000);assert.equal(wrong.status,401);
  const unknown=await auth.handleAuth(req('/auth/password',{email:'unknown@braand.test',password:'wrong-password',browser:secondNonce},secondCookie,{accept:'application/json'}),env,at+1000);assert.equal(unknown.status,401);assert.deepEqual(await wrong.json(),await unknown.json());
  const login=await auth.handleAuth(req('/auth/password',{email,password,browser:secondNonce,return_to:'/?view=library'},secondCookie,{accept:'application/json'}),env,at+1000);assert.equal(login.status,200);assert.equal((await login.json()).message,'/?view=library');assert.equal(mails.length,mailCount);
  const session=login.headers.getSetCookie().find(value=>value.startsWith('__Host-braand_session=')).split(';')[0];assert.equal((await auth.sessionIdentity(new Headers({cookie:session}),env,at+1000)).userId,original.id);
 });
 await check('password registration validates length and refuses cross-origin or incorrect browser proof',async()=>{
  const at=now+21*86400000,form=await auth.handleAuth(req('/auth/form'),env,at),cookie=form.headers.get('set-cookie').split(';')[0],nonce=cookie.split('=')[1],count=mails.length;
  assert.equal((await auth.handleAuth(req('/auth/request',{email:'owner@braand.test',new_password:'short',browser:nonce},cookie),env,at)).status,400);
  assert.equal((await auth.handleAuth(req('/auth/password',{email:'owner@braand.test',password:'bad',browser:'wrong'},cookie),env,at)).status,400);
  assert.equal((await auth.handleAuth(req('/auth/password',{email:'owner@braand.test',password:'bad',browser:nonce},cookie,{origin:'https://evil.test'}),env,at)).status,400);assert.equal(mails.length,count);
 });

 await check('an active session slides once a day, stays capped at 90 days and every device can be signed out at once',async()=>{
  const user=sql.prepare("SELECT id FROM auth_users ORDER BY created_at LIMIT 1").get();assert.ok(user);
  const b64=bytes=>Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AUTH_HASH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mint=async (created,expires=created+auth.SESSION_TTL)=>{const token=b64(crypto.getRandomValues(new Uint8Array(32)));const tokenHash=b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('session:'+token))));sql.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(tokenHash,user.id,expires,created);return '__Host-braand_session='+token;};
  const first=await mint(now),second=await mint(now);
  const fresh=await auth.authenticateRequest(req('/api/workspace',null,first),env,now+1000);assert.equal(fresh.request.headers.get('x-braand-identity-id'),user.id);assert.equal(fresh.setCookie,null,'no renewal within the first day');
  const later=now+2*86400000,renewed=await auth.authenticateRequest(req('/api/workspace',null,first),env,later);assert.match(renewed.setCookie,/^__Host-braand_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800$/);
  const again=await auth.authenticateRequest(req('/api/workspace',null,first),env,later+1000);assert.equal(again.setCookie,null,'renewed at most once a day');
  const old=await mint(now-89*86400000-3600000,now+3600000);
  const capped=await auth.authenticateRequest(req('/api/workspace',null,old),env,now);assert.ok(capped.setCookie);assert.ok(Number(capped.setCookie.match(/Max-Age=(\d+)/)[1])<=86400,'never beyond 90 days after sign-in');
  const out=await auth.handleAuth(req('/auth/sign-out',{confirm:'yes',scope:'all'},first),env,now);assert.equal(out.status,303);
  for(const token of [first,second,old])assert.equal((await auth.authenticateRequest(req('/api/workspace',null,token),env,now+1000)).request.headers.get('x-braand-identity-id'),null);
 });
} finally {globalThis.fetch=originalFetch;sql.close();}
console.log(`${checks} independent authentication checks passed; zero real emails or payments.`);
