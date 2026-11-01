// Isolated browser E2E: actual HTML, SQLite, cookies and Web Crypto; simulated Resend.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/auth-ui');
await mkdir(output,{recursive:true});
await build({external:['/fonts/*'],entryPoints:['lib/auth-runtime.ts'],outfile:path.join(output,'auth.mjs'),bundle:true,platform:'node',format:'esm'});
await build({external:['/fonts/*'],stdin:{contents:`import React,{useEffect,useRef} from "react";import {createRoot} from "react-dom/client";import {X} from "lucide-react";import {EmailSignIn} from "./components/email-sign-in";import "./app/globals.css";import "./app/design-tokens.css";import "./app/design-system.css";import "./app/appearance.css";function Dialog(){const dialog=useRef(null);useEffect(()=>{dialog.current.showModal();},[]);return <dialog ref={dialog} className="modal" data-modal="auth" aria-labelledby="braand-dialog-title"><div className="modal-heading"><h2 id="braand-dialog-title">Bienvenue chez Braand</h2><button className="icon-button" aria-label="Fermer" onClick={()=>dialog.current.close()}><X size={20}/></button></div><EmailSignIn returnTo={new URLSearchParams(location.search).get("return_to")||"/"}/></dialog>;}if(new URLSearchParams(location.search).get("auth")==="sign-in")createRoot(document.getElementById("login")).render(<Dialog/>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'dialog.js'),bundle:true,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const auth=await import(pathToFileURL(path.join(output,'auth.mjs')));
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const sql=new DatabaseSync(':memory:');
for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(await readFile('drizzle/'+file,'utf8'));
function statement(query,args=[]){return {bind(...values){return statement(query,values);},async first(){return sql.prepare(query).get(...args)||null;},async run(){return sql.prepare(query).run(...args);}};}
const env={DB:{prepare:q=>statement(q),batch:async rows=>Promise.all(rows.map(r=>r.run()))},APP_ENV:'test',APP_ORIGIN:'https://braand.test',AUTH_ENABLED:'true',AUTH_HASH_SECRET:'offline-browser-auth-fixture-'.repeat(2),RESEND_MODE:'sandbox',RESEND_FROM:'sender@braand.test',RESEND_TEST_RECIPIENT:'owner@braand.test',RESEND_API_KEY:'offline-only'};
const originalFetch=globalThis.fetch;let link,mailCount=0,checks=0,browser;
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');const mail=JSON.parse(options.body);link=mail.text.match(/https:\/\/[^\s]+/)[0];mailCount++;return Response.json({id:'fixture-mail'});};
const check=(name)=>{console.log('PASS '+name);checks++;};
// Ephemeral local TLS lets the browser exercise Secure cookies and native redirects.
// OpenSSL is present on Linux/macOS and supplied by Git for Windows; no key is committed.
const openssl=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Git/usr/bin/openssl.exe'):'openssl';
const keyFile=path.join(output,'tls-key.pem'),certFile=path.join(output,'tls-cert.pem');
execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
const requestFailures=[];
const server=createServer({key:await readFile(keyFile),cert:await readFile(certFile)},async(req,res)=>{
 try {
  const u=new URL(req.url,env.APP_ORIGIN);
  if(u.pathname==='/fonts/Manrope.ttf'){res.writeHead(200,{'Content-Type':'font/ttf'});res.end(await readFile(path.join(root,'public/fonts/Manrope.ttf')));return;}
  if(u.pathname==='/brand/relais-logo-dark.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await readFile(path.join(root,'public/brand/relais-logo-dark.svg')));return;}
  if(u.pathname==='/auth.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(await readFile('public/auth.css','utf8'));return;}
  if(u.pathname==='/dialog.js'||u.pathname==='/dialog.css'){res.writeHead(200,{'Content-Type':u.pathname.endsWith('.js')?'text/javascript':'text/css'});res.end(await readFile(path.join(output,u.pathname.slice(1))));return;}
  if(u.pathname==='/favicon.svg'){res.writeHead(204);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const request=new Request(u,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  if(req.method==='POST') {
   assert.equal(request.headers.get('origin'),env.APP_ORIGIN,'Browser form preserves the same-origin CSRF proof');
   assert.equal(request.headers.get('referer'),env.APP_ORIGIN+'/','Form requests never leak magic-link paths or tokens');
  }
  const response=await auth.handleAuth(request,env)||new Response('<!doctype html><html lang="fr" data-design-system="muse"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/dialog.css"></head><body><main><h1>Espace Braand</h1><div id="login"></div></main><script type="module" src="/dialog.js"></script></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'strict-origin'}});
  const headers=Object.fromEntries(response.headers),cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
  res.writeHead(response.status,headers);res.end(await response.text());
 } catch {requestFailures.push('HTTPS fixture request failed');res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
env.APP_ORIGIN='https://127.0.0.1:'+server.address().port;
try {
 try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
 const context=await browser.newContext({viewport:{width:1280,height:850},ignoreHTTPSErrors:true}),errors=[];
 let failBootstrap=true;
 await context.route('**/*',async route=>{
  if(new URL(route.request().url()).pathname==='/auth/form'&&failBootstrap){failBootstrap=false;await route.fulfill({status:503,contentType:'application/json',body:'{}'});return;}
  if(new URL(route.request().url()).origin==='https://fonts.googleapis.com'){await route.fulfill({status:200,contentType:'text/css',body:''});return;}
  assert.equal(new URL(route.request().url()).origin,env.APP_ORIGIN,'No external browser requests');await route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(env.APP_ORIGIN+'/auth/sign-in');await page.getByLabel('Adresse e-mail',{exact:true}).waitFor();
 await page.getByRole('dialog',{name:'Bienvenue chez Braand'}).waitFor();
 await page.getByRole('button',{name:'Réessayer',exact:true}).waitFor();
 await page.getByRole('button',{name:'Créer un compte',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Réessayer',exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'Réessayer',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.auth-content').getAttribute('aria-busy')==='false');
 await page.getByRole('button',{name:'Se connecter',exact:true}).click();check('Session preparation errors remain recoverable after changing sign-in intent');
 assert.equal(await page.getByRole('button',{name:'Se connecter',exact:true}).first().getAttribute('aria-pressed'),'true');
 await page.screenshot({path:path.join(output,'desktop.png')});
 await page.getByRole('button',{name:'Créer un compte',exact:true}).click();assert.equal(mailCount,0);
 assert.equal(await page.getByRole('button',{name:'Créer un compte',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth),true);check('The email dialog opens inside Braand with a labeled form and no overflow');
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
 await page.keyboard.press('Tab');
 await page.getByLabel('Adresse e-mail',{exact:true}).focus();assert.equal(await page.getByLabel('Adresse e-mail',{exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 await page.getByLabel('Adresse e-mail',{exact:true}).fill('owner@braand.test');
 await page.screenshot({path:path.join(output,'mobile.png')});check('Mobile layout has no overflow and keyboard focus is visible');
 await page.getByLabel('Adresse e-mail',{exact:true}).fill('owner@braand.test');
 await page.getByLabel('Mot de passe',{exact:true}).fill('fixture-password-2026');
 await page.getByRole('button',{name:'Créer mon compte',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('button[type=submit]').disabled);
 const [mailResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/request'),page.getByRole('button',{name:'Créer mon compte',exact:true}).click()]);
 assert.equal(mailResponse.status(),200,`Email request returned ${mailResponse.status()}: ${await page.locator('h1').textContent()}`);
 await page.getByText('Consultez votre messagerie',{exact:true}).waitFor();assert.equal(mailCount,1);
 assert.equal(new URL(page.url()).pathname,'/');assert.equal(await page.getByRole('dialog').count(),1);
 await page.setViewportSize({width:1280,height:850});await page.screenshot({path:path.join(output,'desktop-confirmation.png')});
 await page.getByRole('button',{name:'Utiliser une autre adresse',exact:true}).click();assert.equal(await page.getByLabel('Adresse e-mail',{exact:true}).inputValue(),'owner@braand.test');assert.equal(mailCount,1);
 await page.getByRole('button',{name:'Se connecter',exact:true}).first().click();assert.equal(await page.getByRole('button',{name:'Recevoir mon lien de connexion',exact:true}).count(),0);
 assert.equal(mailCount,1);check('The dialog requests one email without showing the private token or leaving Braand');
 const verificationResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/verify'&&r.request().method()==='GET');await page.goto(link,{waitUntil:'commit'});const confirmation=await verificationResponse;assert.match(confirmation.headers()['content-security-policy'],/script-src 'nonce-/);check('A verified same-browser email link proceeds automatically');
 await page.getByRole('heading',{name:'Espace Braand'}).waitFor();
 const cookies=await context.cookies(env.APP_ORIGIN),session=cookies.find(c=>c.name==='__Host-braand_session');assert.ok(session?.httpOnly&&session?.secure);assert.ok(await auth.sessionIdentity(new Headers({cookie:session.name+'='+session.value}),env));check('Confirmed login sets a private Secure/HttpOnly cookie and a real revocable session');
 const lot=sql.prepare("SELECT * FROM credit_lots WHERE source='free'").get();assert.equal(lot.balance,1500);assert.equal(lot.expires_at-lot.starts_at,7*86400000);assert.equal(sql.prepare('SELECT count(*) n FROM billing_claims').get().n,1);check('Browser signup automatically receives one 15-credit grant with a seven-day lifetime');
 await page.evaluate(()=>{const form=document.createElement('form');form.method='post';form.action='/auth/sign-out';const input=document.createElement('input');input.name='confirm';input.value='yes';form.append(input);document.body.append(form);form.submit();});await page.getByRole('heading',{name:'Espace Braand'}).waitFor();
 assert.equal(await auth.sessionIdentity(new Headers({cookie:session.name+'='+session.value}),env),null);check('Logout revokes the stored session and removes the browser cookie');
 await page.goto(env.APP_ORIGIN+'/auth/sign-in');await page.getByLabel('Adresse e-mail',{exact:true}).fill('owner@braand.test');await page.getByLabel('Mot de passe',{exact:true}).fill('fixture-password-2026');
 const [direct]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/password'),page.getByRole('button',{name:'Se connecter',exact:true}).last().click()]);assert.equal(direct.status(),200);await page.waitForURL(env.APP_ORIGIN+'/');assert.equal(mailCount,1);check('The existing account signs in directly with a password and no new email');
 assert.deepEqual(errors,[]);assert.deepEqual(requestFailures,[]);assert.equal(mailCount,1);check('No client errors and zero real provider or payment requests');
} finally {globalThis.fetch=originalFetch;await browser?.close();await new Promise(resolve=>server.close(resolve));sql.close();}
console.log(`${checks} independent login browser checks passed.`);
