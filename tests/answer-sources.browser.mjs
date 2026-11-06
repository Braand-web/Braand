// Source chips inside the answer and follow-ups under it, in a real browser:
// a chip sits right after the cited passage and links to the real source only,
// a document source is not a link, unknown numbers show nothing, follow-ups
// send one request per click, light/dark, phone and reduced motion.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/answer-sources');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {StreamingMarkdown} from "./components/agents/streaming-markdown";import {CitationProvider,withCitationMarks} from "./components/agents/citations";import {FollowUps,answerFollowUps} from "./components/agents/follow-ups";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
const sources=[{id:"s1",title:"Rapport des ventes",domain:"stats.example.com",url:"https://www.stats.example.com/ventes"},{id:"s2",title:"Tendances",domain:"tendances.example.org",url:"https://tendances.example.org/fruits"},{id:"s3",title:"Fiche produit.pdf",domain:"Document joint"}];
const text="La pistache est votre saveur qui progresse le plus : **+23 %** ce mois-ci, avec une marge supérieure de 8 points.\\n\\n- Les fruits à noyau suivent la même tendance\\n- Le prix conseillé reste à 1 500 FCFA";
const marked=withCitationMarks(text,[{after:"supérieure de 8 points.",sources:[1]},{after:"la même tendance",sources:[2,1]},{after:"reste à 1 500 FCFA",sources:[3]},{after:"phrase absente",sources:[2]},{after:"La pistache",sources:[7]}],sources.length);
const followUps=answerFollowUps([{version:1,id:"r",messageId:"m",conversationId:"c",workspaceId:"w",projectId:null,retrievedAt:1,objects:[],blocks:[{id:"followups",type:"followups",items:["Quelles saveurs se vendent le mieux en saison sèche ?","Compare les marges du sorbet et de la glace"]}]}]);
window.picked=[];
createRoot(document.getElementById("root")).render(<main style={{maxWidth:720,margin:"24px auto",padding:"0 16px"}}><CitationProvider sources={sources}><StreamingMarkdown text={marked}/></CitationProvider><FollowUps items={followUps} onPick={text=>window.picked.push(text)}/></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const requests=[];
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname;requests.push(p);
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(p.startsWith('/fonts/')){try{const font=await readFile(path.join(root,'public',path.basename(p)==='OFL.txt'?'x':'fonts',path.basename(p)));res.writeHead(200,{'content-type':'font/ttf'});return res.end(font);}catch{res.writeHead(404);return res.end();}}
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 res.writeHead(404);res.end();
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
 await page.goto(origin);await page.locator('.response-citation-chip').first().waitFor();
 const chips=page.locator('.response-citation-chip');
 assert.equal(await chips.count(),3,'one chip per cited passage found; absent passages and unknown numbers show nothing');
 const first=chips.nth(0);
 assert.equal(await first.getAttribute('href'),'https://www.stats.example.com/ventes');assert.equal(await first.getAttribute('target'),'_blank');assert.match(await first.getAttribute('rel'),/noopener/);
 assert.equal((await first.innerText()).trim(),'stats.example.com');
 assert.equal(await page.evaluate(()=>{const p=document.querySelector('.message-text p');const chip=p.querySelector('.response-citation-chip');return chip.previousSibling.textContent.endsWith('supérieure de 8 points.');}),true,'the chip follows the cited sentence');
 pass('a chip sits right after the cited passage and opens the real source in a new tab');
 assert.equal(await chips.nth(1).getAttribute('href'),'https://tendances.example.org/fruits');assert.match(await chips.nth(1).innerText(),/tendances\.example\.org\s*\+1/);
 assert.match(await chips.nth(1).getAttribute('aria-label'),/2\. Tendances · 1\. Rapport des ventes/);
 pass('a passage backed by two sources shows the first site and +1, both named for screen readers');
 assert.equal(await chips.nth(2).evaluate(el=>el.tagName),'SPAN');assert.equal((await chips.nth(2).innerText()).trim(),'Document joint');
 pass('a document source is shown but is not a link');
 const nav=page.getByRole('navigation',{name:'Pour continuer'});
 await nav.getByRole('button',{name:'Compare les marges du sorbet et de la glace'}).click();
 assert.deepEqual(await page.evaluate(()=>window.picked),['Compare les marges du sorbet et de la glace']);
 assert.equal(await nav.getByRole('button').count(),2);
 pass('follow-ups are listed under the answer and one click sends exactly that request');
 assert.ok(requests.every(p=>p==='/'||p==='/app.js'||p==='/app.css'||p.startsWith('/fonts/')||p==='/favicon.ico'),'no request to a cited site');
 await page.screenshot({path:path.join(output,'desktop-dark.png')});
 assert.deepEqual(errors,[]);await page.close();
 for(const [name,options] of [['light',{viewport:{width:1000,height:600},colorScheme:'light'}],['mobile',{viewport:{width:360,height:740},deviceScaleFactor:2}],['reduced',{viewport:{width:800,height:600},reducedMotion:'reduce'}]]){
  const view=await browser.newPage(options);await view.goto(origin);await view.locator('.follow-ups').waitFor();
  if(name==='light')await view.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';});
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  if(name==='reduced')assert.equal(await view.evaluate(()=>getComputedStyle(document.querySelector('.follow-ups li')).animationName),'none');
  await view.waitForTimeout(400);await view.screenshot({path:path.join(output,name+'.png')});await view.close();
 }
 pass('light theme, phone and reduced motion stay within the screen');
 console.log(`${checks} answer source and follow-up checks passed; no network call to a source.`);
}finally{await browser.close();server.close();}
