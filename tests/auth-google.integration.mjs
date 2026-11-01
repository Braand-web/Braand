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
 await check('signed Google identity verifies PKCE, creates one workspace and returns to the original route',async()=>{
  const flow=await begin();token=await signed(flow.state);const callback='/auth/google/callback?code=fixture-code&state='+encodeURIComponent(flow.state);
  assert.equal((await auth.handleAuth(req(callback),env,now)).status,400);const result=await auth.handleAuth(req(callback,flow.cookie),env,now);assert.equal(result.status,303);assert.equal(result.headers.get('location'),'/?view=projects');
  const cookie=result.headers.getSetCookie().find(v=>v.startsWith('__Host-braand_session=')).split(';')[0],user=await auth.sessionIdentity(new Headers({cookie}),env,now);assert.equal(user.email,'owner@gmail.com');assert.equal(sql.prepare('SELECT COUNT(*) n FROM credit_lots WHERE source_id=?').get(user.userId).n,1);
  assert.equal((await auth.handleAuth(req(callback,flow.cookie),env,now)).status,400);assert.equal(calls,1);
 });
 await check('unverified email, wrong nonce and wrong audience cannot create an account or session',async()=>{
  for(const wrong of [{email_verified:false},{nonce:'wrong-nonce'},{aud:'other-client'}]){const before=sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,flow=await begin();token=await signed(flow.state,wrong);const response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);assert.equal(response.status,503);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,before);}
 });
 await check('a verified non-Google address cannot silently take over an existing account',async()=>{
  sql.prepare('INSERT INTO auth_users(id,email,verified_at,created_at) VALUES (?,?,?,?)').run('existing-user','member@example.org',now,now);
  const flow=await begin('https://evil.test/');token=await signed(flow.state,{email:'member@example.org',sub:'different-google-subject'});const response=await auth.handleAuth(req('/auth/google/callback?code=fixture-code&state='+flow.state,flow.cookie),env,now);assert.equal(response.status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_google_identities WHERE user_id=?').get('existing-user').n,0);
 });
}finally{globalThis.fetch=originalFetch;sql.close();}
console.log(`${checks} Google authentication checks passed; no external provider requests.`);
