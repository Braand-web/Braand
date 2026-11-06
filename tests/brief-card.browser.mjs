// The questions card in a real browser against a local API: one question at a
// time, a single choice moves on by itself, a multiple choice waits, « Autre
// chose… » with Entrée, a required question cannot be skipped, one save even on
// a double click, the answers continue the conversation once, a saved card
// reads back as a summary, light/dark, phone and reduced motion.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/brief-card');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import BriefCard from "./components/brief-card";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
const questions=[{q:"Combien de saveurs lancer ?",type:"radio",options:["Trois (gamme de base)","Cinq (gamme complète)","Une seule vedette"],optional:false},{q:"Quels ingrédients ajouter ?",type:"check",options:["Pépites de chocolat","Éclats de gaufre","Vermicelles"],optional:true},{q:"Quel marché viser d’abord ?",type:"radio",options:["Food trucks","Supermarchés","Glaciers"],optional:false}];
const waiting={id:"brief-1",kind:"brief",title:"Lancement des glaces",status:"waiting_input",version:1,data:{summary:"Trois précisions avant de préparer le plan.",questions}};
const saved={...waiting,id:"brief-2",status:"saved",version:2,data:{...waiting.data,answers:[{selected:[1],custom:"",skipped:false},{selected:[],custom:"",skipped:true},{selected:[],custom:"Marchés de nuit",skipped:false}]}};
window.continued=0;window.savedEvents=0;
createRoot(document.getElementById("root")).render(<main style={{maxWidth:720,margin:"24px auto",padding:"0 16px",display:"grid",gap:16}}><BriefCard inline resource={waiting} onSaved={()=>{window.savedEvents++;}} onContinue={()=>{window.continued++;}}/><BriefCard inline resource={{...saved,status:"waiting_input",version:1}} onSaved={()=>{}} onContinue={()=>{}}/></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const calls=[];
const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const questions=[{q:'Combien de saveurs lancer ?',type:'radio',options:['Trois (gamme de base)','Cinq (gamme complète)','Une seule vedette'],optional:false},{q:'Quels ingrédients ajouter ?',type:'check',options:['Pépites de chocolat','Éclats de gaufre','Vermicelles'],optional:true},{q:'Quel marché viser d’abord ?',type:'radio',options:['Food trucks','Supermarchés','Glaciers'],optional:false}];
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname;let body='';for await(const c of req)body+=c;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(p.startsWith('/fonts/')){try{const font=await readFile(path.join(root,'public',path.normalize(p).replace(/^(\.\.[/\\])+/,'')));res.writeHead(200,{'content-type':'font/'+path.extname(p).slice(1)});return res.end(font);}catch{res.writeHead(404);return res.end();}}
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p.startsWith('/api/'))calls.push({path:p,method:req.method,body:body?JSON.parse(body):null});
 // The card restored from history reads its current state: brief-2 was answered meanwhile.
 if(p==='/api/resources/brief-1')return json(res,{id:'brief-1',kind:'brief',title:'Lancement des glaces',status:'waiting_input',version:1,data:{summary:'Trois précisions avant de préparer le plan.',questions}});
 if(p==='/api/resources/brief-2')return json(res,{id:'brief-2',kind:'brief',title:'Lancement des glaces',status:'saved',version:2,data:{summary:'',questions,answers:[{selected:[1],custom:'',skipped:false},{selected:[],custom:'',skipped:true},{selected:[],custom:'Marchés de nuit',skipped:false}]}});
 if(p==='/api/brief/brief-1'){await new Promise(resolve=>setTimeout(resolve,300));const sent=JSON.parse(body);return json(res,{id:'brief-1',kind:'brief',title:'Lancement des glaces',status:'saved',version:2,data:{summary:'',questions,answers:sent.answers}});}
 json(res,{error:'absent'},404);
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1100,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
 await page.goto(origin);
 const card=page.locator('.qcard').first();await card.getByRole('radio').first().waitFor();await card.waitFor();
 const counter=card.getByLabel(/Question \d sur 3/);
 assert.equal(await counter.getAttribute('aria-label'),'Question 1 sur 3');
 assert.equal(await card.getByRole('button',{name:'Passer'}).count(),0,'a required question has no Passer');
 assert.equal(await card.getByRole('button',{name:'Continuer'}).isDisabled(),true);
 assert.equal(await card.getByRole('radio',{name:'Trois (gamme de base)'}).isVisible(),true);
 pass('one question at a time; a required question cannot be skipped or continued empty');
 await card.getByRole('radio',{name:'Cinq (gamme complète)'}).click();
 await page.waitForFunction(()=>document.querySelector('.qcard-steps span[aria-label]')?.getAttribute('aria-label')==='Question 2 sur 3');
 assert.equal(await card.locator('.qcard-option',{hasText:'Cinq (gamme complète)'}).getAttribute('aria-checked'),'true');assert.equal(await card.getByRole('radio',{name:'Cinq (gamme complète)'}).count(),0,'a question left behind is out of reach');
 pass('a single choice is marked and moves on to the next question by itself');
 await card.getByRole('checkbox',{name:'Pépites de chocolat'}).click();await card.getByRole('checkbox',{name:'Vermicelles'}).click();
 await page.waitForTimeout(700);assert.equal(await counter.getAttribute('aria-label'),'Question 2 sur 3','a multiple choice waits');
 await card.getByRole('checkbox',{name:'Vermicelles'}).click();assert.equal(await card.getByRole('checkbox',{name:'Vermicelles'}).getAttribute('aria-checked'),'false');
 await card.getByRole('button',{name:'Continuer'}).click();await page.waitForFunction(()=>document.querySelector('.qcard-steps span[aria-label]')?.getAttribute('aria-label')==='Question 3 sur 3');
 pass('a multiple choice toggles and waits for Continuer');
 await card.getByRole('button',{name:'Question précédente'}).click();await page.waitForFunction(()=>document.querySelector('.qcard-steps span[aria-label]')?.getAttribute('aria-label')==='Question 2 sur 3');
 assert.equal(await card.getByRole('checkbox',{name:'Pépites de chocolat'}).getAttribute('aria-checked'),'true','answers are kept when going back');
 await card.getByRole('button',{name:'Question suivante'}).click();await page.waitForFunction(()=>document.querySelector('.qcard-steps span[aria-label]')?.getAttribute('aria-label')==='Question 3 sur 3');
 assert.equal(await card.getByRole('button',{name:'Envoyer'}).isDisabled(),true);
 pass('going back keeps the answers; the last step offers Envoyer');
 await page.waitForTimeout(500);await page.screenshot({path:path.join(output,'desktop-dark.png'),fullPage:true});
 const other=card.getByRole('textbox',{name:'Autre réponse'}).last();await other.fill('Marchés de nuit');
 await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Envoyer');b.click();b.click();});
 await other.press('Enter').catch(()=>{});
 await card.getByText('Réponses envoyées').waitFor();
 const posts=calls.filter(c=>c.path==='/api/brief/brief-1');
 assert.equal(posts.length,1,'a double click and Entrée save once');
 assert.deepEqual(posts[0].body,{version:1,answers:[{selected:[1],custom:'',skipped:false},{selected:[0],custom:'',skipped:false},{selected:[],custom:'Marchés de nuit',skipped:false}]});
 assert.equal(await page.evaluate(()=>window.continued),1,'the conversation continues once');
 assert.match(await card.innerText(),/Combien de saveurs lancer \?\s*Cinq \(gamme complète\)[\s\S]*Pépites de chocolat[\s\S]*Marchés de nuit[\s\S]*aucun accord de dépense ou de publication/);
 pass('« Autre chose… » is sent with the exact choices, saved once, and the conversation continues once');
 const restored=page.locator('.qcard-done').nth(1);await restored.waitFor();
 assert.match(await restored.innerText(),/Cinq \(gamme complète\)[\s\S]*Passée[\s\S]*Marchés de nuit/);
 pass('a card restored from history reads its current state and shows the saved answers');
 assert.deepEqual(errors,[]);await page.close();
 for(const [name,options] of [['light',{viewport:{width:1100,height:900},colorScheme:'light'}],['mobile',{viewport:{width:360,height:780},deviceScaleFactor:2}],['reduced',{viewport:{width:800,height:800},reducedMotion:'reduce'}]]){
  const view=await browser.newPage(options),viewErrors=[];view.on('pageerror',e=>viewErrors.push(e.message));await view.goto(origin);if(name==='light')await view.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';});
  const first=view.getByRole('region',{name:'Lancement des glaces'}).first();await first.waitFor();
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  if(name==='reduced'){await first.getByRole('radio',{name:'Trois (gamme de base)'}).click();await view.waitForFunction(()=>document.querySelector('.qcard-steps span[aria-label]')?.getAttribute('aria-label')==='Question 2 sur 3');assert.ok(parseFloat(await view.evaluate(()=>getComputedStyle(document.querySelector('.qcard-track')).transitionDuration))<0.01,'no slide when motion is reduced');}
  await view.waitForTimeout(500);await view.screenshot({path:path.join(output,name+'.png'),fullPage:name!=='mobile'});assert.deepEqual(viewErrors,[]);await view.close();
 }
 pass('light theme, phone and reduced motion stay within the screen, without animation when reduced');
 console.log(`${checks} questions card checks passed; no real action or network call.`);
}finally{await browser.close();server.close();}
