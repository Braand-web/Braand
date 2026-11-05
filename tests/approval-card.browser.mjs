// Approval cards in a real browser against a local API: a Facebook comment and
// a browser step. Plain question, exact text, one call per decision, folded
// result line, expiry, blocked approval, light/dark and phone layouts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/approval-card');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {ConnectorActionCard,BrowserActionApproval} from "./components/approval-card";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
const later=Date.now()+600000;
const comment={id:"act-1",kind:"connector_action",title:"facebook · FACEBOOK_CREATE_COMMENT",status:"pending",version:1,data:{toolkit:"facebook",toolSlug:"FACEBOOK_CREATE_COMMENT",mode:"connected",status:"pending",expiresAt:later,description:"Publier l’offre de formation sous votre dernière publication Facebook.",arguments:{object_id:"122117877435491185",message:"Formation Excel + IA + Power BI — 4 900 FCFA au lieu de 15 000 FCFA : https://exemple.shop/formation"}}};
const reply={...comment,id:"act-2",data:{...comment.data,toolSlug:"FACEBOOK_REPLY_TO_COMMENT",description:"Répondre au commentaire de Awa."}};
const expired={...comment,id:"act-3",data:{...comment.data,expiresAt:Date.now()-1000}};
const blocked={...comment,id:"act-4",data:{...comment.data,arguments:undefined}};
const session={id:"s1",version:3,status:"awaiting_approval",control:"agent",objective:"Envoyer le formulaire de contact",title:"Contact · Exemple",url:"https://example.com/contact",observation:{elements:[{ref:"e7",role:"button",name:"Envoyer"}]}};
const action={id:"a1",version:2,status:"pending",description:"Envoyer le formulaire de contact rempli avec votre message.",expiresAt:later,command:{kind:"click",targetRef:"e7"}};
createRoot(document.getElementById("root")).render(<main style={{maxWidth:720,margin:"24px auto",padding:"0 16px",display:"grid",gap:8}}><ConnectorActionCard resource={comment}/><ConnectorActionCard resource={reply}/><ConnectorActionCard resource={expired}/><ConnectorActionCard resource={blocked}/><BrowserActionApproval session={session} action={action} onDecided={()=>{window.decided=(window.decided||0)+1;}}/></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const calls=[];
const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x'),p=url.pathname;let body='';for await(const c of req)body+=c;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p.startsWith('/api/'))calls.push({path:p,body:body?JSON.parse(body):null});
 const approval=p.match(/^\/api\/connectors\/approvals\/([\w-]+)$/);
 if(approval){await new Promise(resolve=>setTimeout(resolve,300));const decision=JSON.parse(body).decision;return json(res,{id:approval[1],kind:'connector_action',status:decision==='approve'?'completed':'rejected',version:2,data:{toolkit:'facebook',toolSlug:approval[1]==='act-2'?'FACEBOOK_REPLY_TO_COMMENT':'FACEBOOK_CREATE_COMMENT',status:decision==='approve'?'completed':'rejected',arguments:{message:'x'}}});}
 if(/^\/api\/browser\/sessions\/s1\/actions\/a1$/.test(p))return json(res,{ok:true});
 json(res,{error:'absent'},404);
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1100,height:1500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 const card=page.getByRole('region',{name:'Autoriser Braand à publier ce commentaire sur Facebook ?'}).first();await card.waitFor();
 await card.locator('.approval-content p',{hasText:'Formation Excel + IA + Power BI — 4 900 FCFA au lieu de 15 000 FCFA : https://exemple.shop/formation'}).waitFor();
 assert.match(await card.innerText(),/Publication\s*122117877435491185/);assert.match(await card.innerText(),/Publier l’offre de formation/);
 assert.equal(await page.getByRole('region',{name:'Autoriser Braand à publier cette réponse sur Facebook ?'}).count(),1);
 await page.screenshot({path:path.join(output,'desktop-dark.png'),fullPage:true});
 pass('the card asks a plain question and shows the target and the exact text that will be published');
 const toggle=card.getByRole('button',{name:/Publier l’offre de formation/});assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await card.locator('.approval-content').count(),0);
 await toggle.click();pass('details fold and unfold');
 await card.getByRole('button',{name:'Autoriser',exact:true}).dblclick();
 await card.getByText('Autorisé · Action effectuée').waitFor();
 assert.equal(calls.filter(c=>c.path==='/api/connectors/approvals/act-1').length,1,'a double click sends one decision');
 assert.deepEqual(calls.find(c=>c.path==='/api/connectors/approvals/act-1').body,{decision:'approve'});
 assert.equal(await card.getByRole('button',{name:'Autoriser',exact:true}).count(),0);
 pass('Autoriser sends one decision, then the card folds into a result line without buttons');
 const second=page.getByRole('region',{name:'Autoriser Braand à publier cette réponse sur Facebook ?'});
 await second.getByRole('button',{name:'Refuser',exact:true}).click();await second.getByText('Refusé',{exact:true}).waitFor();
 assert.deepEqual(calls.find(c=>c.path==='/api/connectors/approvals/act-2').body,{decision:'reject'});
 pass('Refuser records a refusal');
 const regions=page.locator('.approval-card');
 await regions.nth(2).getByText('Demande expirée',{exact:true}).waitFor();assert.equal(await regions.nth(2).getByRole('button',{name:'Autoriser',exact:true}).count(),0);
 assert.equal(await regions.nth(3).getByRole('button',{name:'Autoriser',exact:true}).isDisabled(),true);await regions.nth(3).getByText('Approbation bloquée : les paramètres exacts sont manquants.').waitFor();
 pass('an expired request cannot be approved and a request without exact parameters is blocked');
 const step=page.getByRole('region',{name:'Autoriser Braand à faire cette action dans le navigateur ?'});
 assert.match(await step.innerText(),/Cliquer[\s\S]*Contact · Exemple[\s\S]*Envoyer/);
 await step.getByRole('button',{name:'Autoriser',exact:true}).click();await step.getByText('Autorisé',{exact:true}).waitFor();
 assert.deepEqual(calls.find(c=>c.path==='/api/browser/sessions/s1/actions/a1').body,{decision:'approve',version:2,approved:true});assert.equal(await page.evaluate(()=>window.decided),1);
 pass('a browser step is decided in the conversation with the action version');
 assert.deepEqual(errors,[]);await page.close();
 for(const [name,options] of [['light',{viewport:{width:1100,height:1400},colorScheme:'light'}],['mobile',{viewport:{width:390,height:844},deviceScaleFactor:2}]]){
  const view=await browser.newPage(options);await view.goto(origin);await view.locator('.approval-card').first().waitFor();
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  await view.screenshot({path:path.join(output,name+'.png'),fullPage:name==='light'});await view.close();
 }
 pass('light theme and phone layouts stay within the screen');
 console.log(`${checks} approval card checks passed; no real action or network call.`);
}finally{await browser.close();server.close();}
