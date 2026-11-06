// The project keys form and the pull request approval card in a real browser
// against a local API: keys are sent once and never shown back; the PR card
// shows the exact files, approves once and links to the pull request; light,
// dark and phone layouts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/github-cards');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {EnvKeysCard} from "./components/env-keys-card";import {GithubPrCard} from "./components/github-pr-card";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
const pr={id:"res-1",kind:"github_pr",title:"Ajouter la section Hero",status:"awaiting_approval",version:1,data:{repo:"Awa/boutique",title:"Ajouter la section Hero",description:"Nouvelle bannière d’accueil avec le prix de la formation.",branch:"braand/ajouter-la-section-hero-x1",files:[{path:"src/app/page.tsx",status:"M",added:3,removed:1},{path:"src/components/Hero.tsx",status:"A",added:12,removed:0}]}};
window.sent=[];createRoot(document.getElementById("root")).render(<main style={{maxWidth:760,margin:"24px auto",padding:"0 16px"}}><EnvKeysCard request={{keys:["DATABASE_URL","OPENAI_API_KEY"],known:["DATABASE_URL"],reason:"Le projet a besoin de sa base de données et de sa clé d’IA.",conversationId:"conv-1"}} onSaved={t=>window.sent.push(t)}/><GithubPrCard resource={pr}/></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const calls=[];let pr={id:'res-1',kind:'github_pr',title:'Ajouter la section Hero',status:'awaiting_approval',version:1,data:{repo:'Awa/boutique',title:'Ajouter la section Hero',branch:'braand/ajouter-la-section-hero-x1',files:[{path:'src/app/page.tsx',status:'M',added:3,removed:1},{path:'src/components/Hero.tsx',status:'A',added:12,removed:0}]}};
const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname;let body='';for await(const c of req)body+=c;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/favicon.ico'){res.writeHead(204);return res.end();}
 if(p.startsWith('/fonts/')){try{const font=await readFile(path.join(root,'public/fonts',path.basename(p)));res.writeHead(200,{'content-type':'font/ttf'});return res.end(font);}catch{res.writeHead(404);return res.end();}}
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p.startsWith('/api/'))calls.push({path:p,method:req.method,body:body?JSON.parse(body):null});
 if(p==='/api/code/env')return json(res,{saved:Object.keys(JSON.parse(body).values)});
 if(p==='/api/resources/res-1')return json(res,pr);
 if(p==='/api/github/pr/res-1'){await new Promise(r=>setTimeout(r,300));pr={...pr,status:'completed',version:2,data:{...pr.data,prUrl:'https://github.com/Awa/boutique/pull/7'}};return json(res,pr);}
 json(res,{error:'absent'},404);
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1000,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(origin);
 const form=page.getByRole('form',{name:'Clés du projet'});await form.waitFor();
 assert.equal(await form.locator('input[type=password]').count(),2);assert.match(await form.innerText(),/DATABASE_URL · déjà enregistrée[\s\S]*OPENAI_API_KEY/);
 assert.equal(await form.getByRole('button',{name:'Enregistrer en sécurité'}).isDisabled(),true);
 const prCard=page.getByRole('region',{name:'Autoriser Braand à ouvrir cette pull request sur Awa/boutique ?'});await prCard.waitFor();
 await page.screenshot({path:path.join(output,'desktop-dark.png'),fullPage:true});
 await form.locator('input').nth(1).fill('sk-test-secret');
 await form.getByRole('button',{name:'Enregistrer en sécurité'}).dblclick();
 await page.getByRole('status').filter({hasText:'enregistrée en sécurité'}).waitFor();
 const envCalls=calls.filter(c=>c.path==='/api/code/env');assert.equal(envCalls.length,1);assert.deepEqual(envCalls[0].body,{conversationId:'conv-1',values:{OPENAI_API_KEY:'sk-test-secret'}});
 assert.ok(!(await page.content()).includes('sk-test-secret'),'the value is not shown back');
 assert.match(await page.evaluate(()=>window.sent[0]),/1 clé \(OPENAI_API_KEY\)/);assert.ok(!(await page.evaluate(()=>window.sent[0])).includes('sk-test'),'the follow-up message carries names only');
 pass('keys are typed in password fields, sent once, never shown back, and the conversation continues with their names only');
 assert.match(await prCard.innerText(),/src\/app\/page\.tsx[\s\S]*modifié[\s\S]*\+3[\s\S]*−1[\s\S]*src\/components\/Hero\.tsx[\s\S]*ajouté[\s\S]*\+12/);
 await prCard.getByRole('button',{name:'Autoriser',exact:true}).dblclick();
 await page.getByRole('link',{name:'Voir la pull request'}).waitFor();
 assert.equal(calls.filter(c=>c.path==='/api/github/pr/res-1').length,1,'one decision on a double click');assert.deepEqual(calls.find(c=>c.path==='/api/github/pr/res-1').body,{decision:'approve',version:1});
 assert.equal(await page.getByRole('link',{name:'Voir la pull request'}).getAttribute('href'),'https://github.com/Awa/boutique/pull/7');
 pass('the pull request card shows the exact files, sends one approval with the version and links to the pull request');
 assert.deepEqual(errors,[]);await page.close();
 for(const [name,options] of [['light',{viewport:{width:1000,height:900},colorScheme:'light'}],['mobile',{viewport:{width:360,height:900},deviceScaleFactor:2}]]){
  pr={...pr,status:'awaiting_approval',version:1};const view=await browser.newPage(options);await view.goto(origin);await view.locator('.github-pr-card').waitFor();
  if(name==='light')await view.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';});
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  await view.waitForTimeout(300);await view.screenshot({path:path.join(output,name+'.png'),fullPage:true});await view.close();
 }
 pass('light theme and phone stay within the screen');
 console.log(`${checks} GitHub card checks passed; no real key, push or GitHub call.`);
}finally{await browser.close();server.close();}
