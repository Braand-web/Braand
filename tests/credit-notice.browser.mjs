// The low-credit warning in the conversation, in a real browser against a
// local API: nothing when the balance is fine, a warning with the server's
// facts when it gets low, Recharger for the owner only, hidden for the day
// on request (but never when empty), light/dark and phone.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/credit-notice');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {CreditNotice} from "./components/credit-notice";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
window.topUps=0;createRoot(document.getElementById("root")).render(<main style={{maxWidth:760,margin:"24px auto",padding:"0 16px"}}><CreditNotice refreshKey={0} onTopUp={()=>{window.topUps++;}}/><div style={{padding:12,border:"1px solid var(--color-border)",borderRadius:12}}>Votre demande à Braand</div></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
let outlook={level:'ok',summary:'120 crédits disponibles',canTopUp:true},reads=0;
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(p.startsWith('/fonts/')){try{const font=await readFile(path.join(root,'public/fonts',path.basename(p)));res.writeHead(200,{'content-type':'font/ttf'});return res.end(font);}catch{res.writeHead(404);return res.end();}}
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p==='/api/billing/outlook'){reads++;res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(outlook));}
 res.writeHead(404);res.end();
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1000,height:500}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForFunction(()=>document.body.innerText.includes('Votre demande'));await page.waitForTimeout(1900);
 assert.equal(reads,1);assert.equal(await page.locator('.credit-notice').count(),0);
 pass('nothing is shown while the balance is fine');
 outlook={level:'low',summary:'40 crédits disponibles ; environ 8,57 crédits utilisés par jour sur 7 jours, soit environ 4 jours à ce rythme ; 40 crédits expirent le 9 novembre',canTopUp:true};
 await page.reload();const notice=page.getByRole('status').filter({hasText:'Vos crédits baissent'});await notice.waitFor({timeout:5000});
 assert.match(await notice.innerText(),/40 crédits disponibles[\s\S]*environ 4 jours à ce rythme[\s\S]*expirent le 9 novembre/);
 await page.screenshot({path:path.join(output,'low-dark.png')});
 await notice.getByRole('button',{name:'Recharger'}).click();assert.equal(await page.evaluate(()=>window.topUps),1);
 pass('a low balance is announced in advance with the pace, the days left and the expiry, and Recharger opens the top-up');
 await notice.getByRole('button',{name:'Fermer'}).click();assert.equal(await page.locator('.credit-notice').count(),0);
 await page.reload();await page.waitForTimeout(1900);assert.equal(await page.locator('.credit-notice').count(),0,'stays hidden today');
 outlook={...outlook,level:'critical',summary:'4 crédits disponibles'};await page.reload();
 await page.getByRole('status').filter({hasText:'Vos crédits sont presque épuisés'}).waitFor({timeout:5000});
 pass('a hidden warning stays hidden for the day, and a worse level shows again');
 outlook={level:'empty',summary:'0 crédit disponible',canTopUp:false};await page.reload();
 const empty=page.getByRole('status').filter({hasText:'Vos crédits sont épuisés'});await empty.waitFor({timeout:5000});
 assert.equal(await empty.getByRole('button',{name:'Recharger'}).count(),0,'no top-up for a member');assert.match(await empty.innerText(),/Demandez au propriétaire de l’espace de recharger/);
 await empty.getByRole('button',{name:'Fermer'}).click();assert.equal(await page.locator('.credit-notice').count(),0,'even an empty balance can be closed');
 pass('every warning, even an empty balance, closes with the small cross, and a member is told to ask the owner');
 assert.deepEqual(errors,[]);await context.close();
 outlook={level:'critical',summary:'4 crédits disponibles ; environ 3 crédits utilisés par jour sur 7 jours, soit environ 1 jour à ce rythme',canTopUp:true};
 for(const [name,options] of [['light',{viewport:{width:1000,height:400},colorScheme:'light'}],['mobile',{viewport:{width:360,height:640},deviceScaleFactor:2}]]){
  const view=await browser.newPage(options);await view.goto(origin);await view.locator('.credit-notice').waitFor({timeout:5000});
  if(name==='light')await view.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';});
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  await view.waitForTimeout(350);await view.screenshot({path:path.join(output,name+'.png')});await view.close();
 }
 pass('light theme and phone stay within the screen');
 console.log(`${checks} credit warning checks passed; no payment or real balance read.`);
}finally{await browser.close();server.close();}
