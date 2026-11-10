// Actual React component and browser interactions, controlled API fixtures only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/agent-operations-ui');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AgentOperationCard} from './components/agents/operation-card';import './app/globals.css';import './app/tokens.css';
const items=await fetch('/fixtures').then(r=>r.json());
createRoot(document.getElementById('root')).render(<main style={{maxWidth:700,margin:'24px auto',padding:16,display:'grid',gap:16}}>{items.map(resource=><AgentOperationCard key={resource.id} resource={resource} conversationId="chat-1" onAsk={text=>window.lastAsk=text} onOpen={r=>window.opened=r.id}/>)}</main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',target:'es2022',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
let workflow={id:'flow-1',title:'Résumé des dépenses',kind:'workflow',version:1,status:'draft',data:{digest:'d'.repeat(64)}};
const event={id:'event-1',title:'Import de tableaux',kind:'event_subscription',version:1,status:'draft',data:{maxEvents:3,expiresAt:Date.now()+86400000}};
const hostile={id:'profile-1',title:'<img src=x onerror="window.attacked=true">',kind:'agent_profile',version:1,status:'ready',data:{objective:'Lire uniquement les sources autorisées.'}};
const result={id:'run-1',title:'Données calculées',kind:'workflow_run',version:2,status:'completed',data:{rows:[{count:2}],rowCount:20}};
const calls=[];
const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://x').pathname;let body='';for await(const chunk of req)body+=chunk;
 if(p==='/')return res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p==='/fixtures')return json(res,[workflow,event,hostile,result]);
 if(p==='/api/agent-operations'&&req.method==='GET')return json(res,{items:[workflow,event,hostile,result]});
 if(p==='/api/agent-operations'){
  const command=JSON.parse(body);calls.push(command);await new Promise(r=>setTimeout(r,200));
  if(command.id===event.id)return json(res,{error:'Autorisation retirée.',code:'forbidden'},403);
  if(command.version!==workflow.version)return json(res,{error:'Version périmée.'},409);
  workflow={...workflow,version:workflow.version+1,status:command.action==='test'?'tested':command.action==='activate'?'active':'disabled',data:{...workflow.data,test:{passed:true}}};return json(res,workflow);
 }
 return json(res,{error:'Absent'},404);
}).listen(0);
const require=createRequire(import.meta.url),modulePath=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:require.resolve('playwright'));
const browser=await chromium.launch(),origin='http://127.0.0.1:'+server.address().port;let checks=0;
const pass=name=>{checks++;console.log('PASS '+name);};
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 const card=page.getByRole('region',{name:'Résumé des dépenses'});await card.waitFor();
 await card.getByRole('button',{name:'Tester l’exemple'}).dblclick();await card.getByRole('button',{name:'Activer le workflow'}).waitFor();assert.equal(calls.length,1);assert.equal(calls[0].conversationId,'chat-1');assert.equal(calls[0].version,1);pass('double click tests the exact version once');
 await card.getByRole('button',{name:'Activer le workflow'}).click();await card.getByText('Activation confirmée.').waitFor();assert.equal(calls[1].digest,'d'.repeat(64));assert.equal(calls[1].confirmed,true);assert.equal(calls[1].version,2);pass('activation follows a passing test and binds the reviewed version');
 await page.reload();await card.getByRole('button',{name:'Désactiver',exact:true}).waitFor();assert.match(await card.innerText(),/Version 3/);assert.equal(calls.length,2);pass('reloading restores state without repeating a command');
 const denied=page.getByRole('region',{name:'Import de tableaux'});await denied.getByRole('button',{name:'Activer le webhook'}).click();await denied.getByRole('alert').waitFor();assert.match(await denied.innerText(),/Autorisation retirée/);assert.equal(await denied.getByRole('button',{name:'Activer le webhook'}).count(),1);assert.match(await denied.innerText(),/Brouillon/);pass('server refusal preserves the actual inactive status');
 await card.getByRole('button',{name:'Modifier avec Braand'}).click();assert.match(await page.evaluate(()=>window.lastAsk),/flow-1, version 3/);await card.getByRole('button',{name:'Voir les détails'}).click();assert.equal(await page.evaluate(()=>window.opened),'flow-1');
 assert.match(await page.getByRole('region',{name:'Données calculées'}).getByRole('link').getAttribute('href'),/conversationId=chat-1&id=run-1&format=csv/);pass('edit, details and export retain object and conversation identity');
 assert.equal(await page.locator('.agent-operation-card img').count(),0);assert.equal(await page.evaluate(()=>window.attacked),undefined);assert.deepEqual(errors,[]);pass('untrusted labels remain text with no generated execution');
 await card.getByRole('button',{name:'Désactiver',exact:true}).focus();await page.keyboard.press('Enter');await card.getByText('Désactivation confirmée.').waitFor();pass('commands can be used with the keyboard');
 for(const [name,options] of [['desktop-dark',{viewport:{width:1100,height:1000},colorScheme:'dark'}],['mobile-light',{viewport:{width:390,height:844},colorScheme:'light',reducedMotion:'reduce'}]]){
  const view=await browser.newPage(options);await view.goto(origin);await view.evaluate(light=>document.documentElement.classList.toggle('light',light),name.includes('light'));await view.locator('.agent-operation-card').first().waitFor();assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await view.screenshot({path:path.join(output,name+'.png'),fullPage:true});await view.close();
 }
 pass('phone and desktop layouts fit the viewport with light/dark and reduced motion');
 console.log(checks+' operation UI checks passed; fixture data, no provider calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
