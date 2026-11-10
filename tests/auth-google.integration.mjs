// Signed provider responses, isolated SQLite and a simulated Google boundary.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/auth-google-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({entryPoints:['lib/auth-runtime.ts'],outfile:out,bundle:true,platform:'node',format:'esm'});
const auth=await import(pathToFileURL(out));
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
function statement(query,args=[]){return {bind(...values){return statement(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};}};}
const env={DB:{prepare:q=>statement(q),async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}},APP_ENV:'test',APP_ORIGIN:'https://braand.test',AUTH_ENABLED:'true',AUTH_HASH_SECRET:'auth-google-fixture-secret-'.repeat(3),AUTH_GOOGLE_CLIENT_ID:'fixture-client',AUTH_GOOGLE_CLIENT_SECRET:'fixture-private-secret'};
const {publicKey,privateKey}=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};
const now=Date.now(),originalFetch=globalThis.fetch;let token='',expectedChallenge='',calls=0;
const req=(url,cookie='')=>new Request('https://braand.test'+url,{headers:{cookie}});
globalThis.fetch=async(url,init={})=>{
 const target=String(url);if(target==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
 assert.equal(target,'https://oauth2.googleapis.com/token');calls++;const form=new URLSearchParams(init.body);assert.equal(form.get('client_id'),env.AUTH_GOOGLE_CLIENT_ID);assert.equal(form.get('redirect_uri'),env.APP_ORIGIN+'/auth/google/callback');
 const verifier=form.get('code_verifier');assert.ok(verifier);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));assert.equal(Buffer.from(digest).toString('base64url'),expectedChallenge);return Response.json({id_token:token});
};
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
async function begin(returnTo='/?view=projects'){
 const response=await auth.handleAuth(req('/auth/form?return_to='+encodeURIComponent(returnTo)),env,now),body=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(body.googleAvailable,true);
 const start=await auth.handleAuth(req('/auth/google?return_to='+encodeURIComponent(returnTo),cookie),env,now);assert.equal(start.status,303);const google=new URL(start.headers.get('location'));assert.equal(google.origin,'https://accounts.google.com');assert.equal(google.searchParams.get('code_challenge_method'),'S256');expectedChallenge=google.searchParams.get('code_challenge');
 return {cookie,state:google.searchParams.get('state'),url:google};
}
async function signed(state,overrides={}){const {aud='fixture-client',sub='fixture-google-subject',...extra}=overrides;const claims={email:'owner@gmail.com',email_verified:true,nonce:state,...extra};return new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).setIssuer('https://accounts.google.com').setAudience(aud).setSubject(sub).setIssuedAt(Math.floor(now/1000)).setExpirationTime(Math.floor(now/1000)+300).sign(privateKey);}
try{
 await check('Google is hidden and unavailable until both server credentials are configured',async()=>{const disabled={...env,AUTH_GOOGLE_CLIENT_SECRET:''},form=await auth.handleAuth(req('/auth/form'),disabled,now);assert.equal((await form.json()).googleAvailable,undefined);assert.equal((await auth.handleAuth(req('/auth/google'),disabled,now)).status,503);});
 await check('one encrypted configuration enables Google and malformed configuration fails closed',async()=>{const broken={...env,AUTH_GOOGLE_CONFIG:'not-json'},form=await auth.handleAuth(req('/auth/form'),broken,now);assert.equal((await form.json()).googleAvailable,undefined);env.AUTH_GOOGLE_CONFIG=JSON.stringify({clientId:env.AUTH_GOOGLE_CLIENT_ID,clientSecret:env.AUTH_GOOGLE_CLIENT_SECRET});const ready=await auth.handleAuth(req('/auth/form'),env,now);assert.equal((await ready.json()).googleAvailable,true);});
 await check('signed Google identity verifies PKCE, creates one workspace and returns to the original route',async()=>{
  const flow=await begin();token=await signed(flow.state);const callback='/auth/google/callback?code=fixture-code&state='+encodeURIComponent(flow.state);
  assert.equal((await auth.handleAuth(req(callback),env,now)).status,400);const result=await auth.handleAuth(req(callback,flow.cookie),env,now);assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/?view=projects&accueil=nouveau');
  const known=result.headers.getSetCookie().find(v=>v.startsWith('__Host-braand_known=')).split(';')[0];assert.equal((await (await auth.handleAuth(req('/auth/form',known),env,now)).json()).known,true);assert.equal((await (await auth.handleAuth(req('/auth/form'),env,now)).json()).known,undefined);
  const cookie=result.headers.getSetCookie().find(v=>v.startsWith('__Host-braand_session=')).split(';')[0],user=await auth.sessionIdentity(new Headers({cookie}),env,now);assert.equal(user.email,'owner@gmail.com');assert.equal(sql.prepare('SELECT COUNT(*) n FROM credit_lots WHERE source_id=?').get(user.userId).n,1);
  assert.equal((await auth.handleAuth(req(callback,flow.cookie),env,now)).status,400);assert.equal(calls,1);
 });
 await check('a returning Google user is recognized and keeps the same account',async()=>{
  const flow=await begin('/');token=await signed(flow.state);const result=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/?accueil=retour');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM auth_users WHERE email='owner@gmail.com'").get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM credit_lots').get().n,1);
 });
 await check('e-mail links and passwords are retired',async()=>{
  for(const route of ['/auth/request','/auth/password','/auth/verify']){const response=await auth.handleAuth(new Request('https://braand.test'+route,{method:'POST',headers:{origin:'https://braand.test','content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:'email=a%40b.test&password=x'}),env,now);assert.equal(response.status,410);const page=await auth.handleAuth(req(route+'?id=x'),env,now);assert.equal(page.status,303);assert.equal(page.headers.get('location'),'/auth/sign-in');}
 });
 await check('unverified email, wrong nonce and wrong audience cannot create an account or session',async()=>{
  for(const wrong of [{email_verified:false},{nonce:'wrong-nonce'},{aud:'other-client'}]){const before=sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,flow=await begin();token=await signed(flow.state,wrong);const response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);assert.equal(response.status,503);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,before);}
 });
 await check('an account from the former e-mail sign-in is linked once, then a different Google identity is refused',async()=>{
  sql.prepare('INSERT INTO auth_users(id,email,verified_at,created_at) VALUES (?,?,?,?)').run('existing-user','member@example.org',now,now);
  let flow=await begin('/');token=await signed(flow.state,{email:'member@example.org',sub:'member-google-subject'});let response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/?accueil=retour');assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_google_identities WHERE user_id=?').get('existing-user').n,1);
  flow=await begin('https://evil.test/');token=await signed(flow.state,{email:'member@example.org',sub:'different-google-subject'});response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);assert.equal(response.status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_google_identities WHERE user_id=?').get('existing-user').n,1);
 });
 await check('Google sets admin exclusion before returning to the public shell',async()=>{
  const user=sql.prepare("SELECT id FROM auth_users WHERE email='owner@gmail.com'").get();env.OPS_ADMIN_IDS=user.id;
  const flow=await begin('/');token=await signed(flow.state);const response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);
  assert.equal(response.status,303);assert.ok(response.headers.getSetCookie().some(value=>value.startsWith('__Host-braand_internal_traffic=1;')));delete env.OPS_ADMIN_IDS;
 });
 await check('new accounts created from an excluded admin browser do not inflate signup counters',async()=>{
  const count=()=>Number(sql.prepare("SELECT COALESCE(SUM(n),0) n FROM traffic_daily WHERE scope='app' AND key='public-v2' AND dim='signups'").get().n),before=count();
  const flow=await begin('/');token=await signed(flow.state,{email:'internal-signup@braand.test',sub:'internal-signup-subject'});
  const response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie+'; __Host-braand_internal_traffic=1'),env,now);
  assert.equal(response.status,303);assert.equal(count(),before);assert.equal(sql.prepare("SELECT COUNT(*) n FROM auth_users WHERE email='internal-signup@braand.test'").get().n,1);
  assert.ok(response.headers.getSetCookie().some(value=>value.startsWith('__Host-braand_internal_traffic=;')&&value.endsWith('Max-Age=0')),'a verified non-admin clears the exclusion for subsequent visits');
 });
}finally{globalThis.fetch=originalFetch;sql.close();}
console.log(`${checks} Google authentication checks passed; no external provider requests.`);
