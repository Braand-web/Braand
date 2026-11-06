// "Braand a remarqué" and "Braand apprend votre façon de faire" in a real
// browser against a local API: the watch card asks Braand to analyse (one
// request, then the prompt) or is dismissed; the progress card shows the
// trend and what was learned; light/dark and phone.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/insight-notice');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {InsightNotice} from "./components/insight-notice";import {LearningProgress} from "./components/learning-progress";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
window.prompts=[];createRoot(document.getElementById("root")).render(<main style={{maxWidth:760,margin:"24px auto",padding:"0 16px"}}><LearningProgress/><InsightNotice refreshKey={0} onAnalyze={text=>window.prompts.push(text)}/><div style={{padding:12,border:"1px solid var(--color-border)",borderRadius:12}}>Votre demande à Braand</div></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const patches=[];let insights=[{id:'insight-site_traffic_drop-salon-awa-2026-46',type:'site_traffic_drop',slug:'salon-awa',title:'Les visites de « salon-awa » ont baissé de 68 % sur les 3 derniers jours',status:'open',detectedAt:Date.now()}];
const progress={correctionsPer10:{before:2,after:0.5,trend:'improving'},totals:{answers:40,corrections:5,preferences:1,methodChanges:1},recentLessons:[{kind:'correction',text:'Toujours vouvoyer les clients',at:2}],recentMethodChanges:[{method:'Publications Facebook',reason:'Ajout : vouvoyer les clients',at:1}],note:'Corrections pour 10 réponses : moins il y en a, plus Braand a appris votre façon de faire.'};
const json=(res,body)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname;let body='';for await(const c of req)body+=c;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(p.startsWith('/fonts/')){try{const font=await readFile(path.join(root,'public/fonts',path.basename(p)));res.writeHead(200,{'content-type':'font/ttf'});return res.end(font);}catch{res.writeHead(404);return res.end();}}
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p==='/api/learning')return json(res,progress);
 if(p==='/api/insights'&&req.method==='GET')return json(res,{insights});
 if(p==='/api/insights'&&req.method==='PATCH'){const b=JSON.parse(body);patches.push(b);insights=insights.map(i=>i.id===b.id?{...i,status:b.action==='dismiss'?'dismissed':'investigating'}:i);return json(res,{...insights[0]});}
 res.writeHead(404);res.end();
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(origin);
 const learning=page.getByRole('region',{name:'Braand apprend votre façon de faire'});await learning.waitFor();
 assert.match(await learning.innerText(),/Corrections pour 10 réponses\s*2 → 0,5\s*en baisse[\s\S]*Correction retenue : « Toujours vouvoyer les clients »[\s\S]*Publications Facebook/);
 pass('the progress card shows corrections per 10 answers falling and what Braand learned');
 const notice=page.getByRole('status').filter({hasText:'Braand a remarqué'});await notice.waitFor({timeout:5000});
 assert.match(await notice.innerText(),/baissé de 68 %/);
 await page.screenshot({path:path.join(output,'desktop-dark.png')});
 await notice.getByRole('button',{name:'Analyser et corriger'}).dblclick();
 await page.waitForFunction(()=>window.prompts.length===1);await page.waitForTimeout(300);
 assert.equal(patches.length,1,'one request even on a double click');assert.deepEqual(patches[0],{id:insights[0].id,action:'investigate'});
 assert.match(await page.evaluate(()=>window.prompts[0]),/Braand a remarqué : Les visites de « salon-awa »[\s\S]*site_traffic/);
 assert.equal(await page.locator('.credit-notice.insight').count(),0);
 pass('Analyser et corriger marks the signal once and asks Braand to find the cause and propose a fix');
 insights=[{...insights[0],id:'insight-2',status:'open'}];await page.reload();
 const again=page.getByRole('status').filter({hasText:'Braand a remarqué'});await again.waitFor({timeout:5000});
 await again.getByRole('button',{name:'Fermer'}).click();await page.waitForTimeout(300);
 assert.deepEqual(patches.at(-1),{id:'insight-2',action:'dismiss'});assert.equal(await page.locator('.credit-notice.insight').count(),0);
 pass('the small cross dismisses a signal');
 assert.deepEqual(errors,[]);await page.close();
 insights=[{...insights[0],id:'insight-3',status:'open'}];
 for(const [name,options] of [['light',{viewport:{width:1000,height:700},colorScheme:'light'}],['mobile',{viewport:{width:360,height:800},deviceScaleFactor:2}]]){
  const view=await browser.newPage(options);await view.goto(origin);await view.locator('.credit-notice.insight').waitFor({timeout:5000});
  if(name==='light')await view.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';});
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  await view.waitForTimeout(350);await view.screenshot({path:path.join(output,name+'.png'),fullPage:true});await view.close();
 }
 pass('light theme and phone stay within the screen');
 console.log(`${checks} watch and learning card checks passed; no real data.`);
}finally{await browser.close();server.close();}
