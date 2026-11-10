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
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {ConnectorActionCard,BrowserActionApproval,SocialBatchCard,SocialReplyCard} from "./components/approval-card";import {MediaPlanView} from "./components/media-plan-view";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
const later=Date.now()+600000;const plan={id:"plan-ui",kind:"proposal",title:"Kit de lancement",version:1,status:"awaiting_approval",data:{kind:"media_plan",rationale:"Créer deux visuels de test.",maxCredits:10,payload:{expectedCredits:6,quotes:[{stepId:"a",model:"fixture",credits:3},{stepId:"b",model:"fixture",credits:3}],steps:[{id:"a",label:"Visuel carré",task:"image"},{id:"b",label:"Story",task:"image"}]}}};
const comment={id:"act-1",kind:"connector_action",title:"facebook · FACEBOOK_CREATE_COMMENT",status:"pending",version:1,data:{toolkit:"facebook",toolSlug:"FACEBOOK_CREATE_COMMENT",mode:"connected",status:"pending",expiresAt:later,description:"Publier l’offre de formation sous votre dernière publication Facebook.",arguments:{object_id:"122117877435491185",message:"Formation Excel + IA + Power BI — 4 900 FCFA au lieu de 15 000 FCFA : https://exemple.shop/formation"}}};
const reply={...comment,id:"act-2",data:{...comment.data,toolSlug:"FACEBOOK_REPLY_TO_COMMENT",description:"Répondre au commentaire de Awa."}};
const expired={...comment,id:"act-3",data:{...comment.data,expiresAt:Date.now()-1000}};
const blocked={...comment,id:"act-4",data:{...comment.data,arguments:undefined}};
const priced={...comment,id:"act-price",data:{...comment.data,mode:"instant",priceUsd:0.1,maxCredits:3,arguments:{to:"client@example.test",message:"Message de test"}}};
const session={id:"s1",version:3,status:"awaiting_approval",control:"agent",objective:"Envoyer le formulaire de contact",title:"Contact · Exemple",url:"https://example.com/contact",observation:{elements:[{ref:"e7",role:"button",name:"Envoyer"}]}};
const action={id:"a1",version:2,status:"pending",description:"Envoyer le formulaire de contact rempli avec votre message.",expiresAt:later,command:{kind:"click",targetRef:"e7"}};
createRoot(document.getElementById("root")).render(<main style={{maxWidth:720,margin:"24px auto",padding:"0 16px",display:"grid",gap:8}}><ConnectorActionCard resource={comment}/><ConnectorActionCard resource={reply}/><ConnectorActionCard resource={expired}/><ConnectorActionCard resource={blocked}/><BrowserActionApproval session={session} action={action} onDecided={()=>{window.decided=(window.decided||0)+1;}}/><SocialBatchCard batchId="b1"/><SocialReplyCard replyId="rep1"/><ConnectorActionCard resource={priced}/><MediaPlanView proposal={plan} onApprove={()=>{window.planApprovals=(window.planApprovals||0)+1;}} busy={false}/></main>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
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
 if(p==='/api/social/batches/b1'&&req.method==='GET')return json(res,{id:'b1',title:'Lancement de la formation',version:3,digest:'d'.repeat(64),expiresAt:null,posts:[{id:'post-1',status:'draft',text:'La formation commence lundi !',scheduledAt:Date.UTC(2026,10,9,8),format:'image'},{id:'post-2',status:'draft',text:'Dernières places disponibles.',scheduledAt:Date.UTC(2026,10,10,8),format:'text'}]});
 if(p==='/api/social/batches/b1/decision')return json(res,{id:'b1',title:'Lancement de la formation',version:4,digest:'e'.repeat(64),expiresAt:null,posts:[{id:'post-1',status:'approved',text:'La formation commence lundi !',scheduledAt:Date.UTC(2026,10,9,8),format:'image'},{id:'post-2',status:'approved',text:'Dernières places disponibles.',scheduledAt:Date.UTC(2026,10,10,8),format:'text'}]});
 if(p==='/api/social/replies/rep1'&&req.method==='GET')return json(res,{id:'rep1',text:'Merci Awa ! Le lien est en description.',version:2,status:'draft',digest:'f'.repeat(64),comment:{text:'Où trouver le lien ?',author:'Awa'},account:{label:'Page Formation',network:'facebook'}});
 if(p==='/api/social/replies/rep1/decision')return json(res,{id:'rep1',status:'rejected'});
 json(res,{error:'absent'},404);
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1100,height:1500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 const card=page.getByRole('region',{name:'Autoriser Braand à publier ce commentaire sur Facebook ?'}).first();await card.waitFor();
 assert.equal(await card.locator('.approval-details').count(),0);assert.match(await card.innerText(),/Publication\s*122117877435491185/);
 assert.ok(await card.evaluate(el=>el.getBoundingClientRect().height)<=84,'one compact row at desktop size');
 assert.equal(await page.getByRole('region',{name:'Autoriser Braand à publier cette réponse sur Facebook ?'}).count(),2,'the connector reply and the comment reply');
 await card.screenshot({path:path.join(output,'compact-approval.png')});await page.screenshot({path:path.join(output,'desktop-dark.png'),fullPage:true});
 pass('approvals start compact, with the action and destination visible and no repeated explanation');
 const toggle=card.getByRole('button',{name:'Détails de la demande'});assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await card.locator('.approval-content p',{hasText:'Formation Excel + IA + Power BI — 4 900 FCFA au lieu de 15 000 FCFA : https://exemple.shop/formation'}).waitFor();assert.match(await card.innerText(),/Publier l’offre de formation/);
 assert.equal(await card.locator('#'+(await toggle.getAttribute('aria-controls')).replaceAll(':','\\:')).count(),1);
 await toggle.click();assert.equal(await card.locator('.approval-content').count(),0);await toggle.click();pass('keyboard and pointer reveal the exact content only on request');
 await card.getByRole('button',{name:'Autoriser',exact:true}).dblclick();
 await card.getByText('Autorisé · Action effectuée').waitFor();
 assert.equal(calls.filter(c=>c.path==='/api/connectors/approvals/act-1').length,1,'a double click sends one decision');
 assert.deepEqual(calls.find(c=>c.path==='/api/connectors/approvals/act-1').body,{decision:'approve'});
 assert.equal(await card.getByRole('button',{name:'Autoriser',exact:true}).count(),0);
 assert.equal(await card.locator('.approval-details').count(),0);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await toggle.click();assert.equal(await card.locator('.approval-details').count(),1);await toggle.click();
 pass('a decision executes once, folds the details and keeps an inspectable result');
 const second=page.getByRole('region',{name:'Autoriser Braand à publier cette réponse sur Facebook ?'}).first();
 await second.getByRole('button',{name:'Refuser',exact:true}).click();await second.getByText('Refusé',{exact:true}).waitFor();
 assert.deepEqual(calls.find(c=>c.path==='/api/connectors/approvals/act-2').body,{decision:'reject'});
 pass('Refuser records a refusal');
 const regions=page.locator('.approval-card');
 await regions.nth(2).getByText('Demande expirée',{exact:true}).waitFor();assert.equal(await regions.nth(2).getByRole('button',{name:'Autoriser',exact:true}).count(),0);
 assert.equal(await regions.nth(3).getByRole('button',{name:'Autoriser',exact:true}).isDisabled(),true);await regions.nth(3).getByText('Approbation bloquée : les paramètres exacts sont manquants.').waitFor();
 pass('an expired request cannot be approved and a request without exact parameters is blocked');
 const step=page.getByRole('region',{name:'Autoriser Braand à faire cette action dans le navigateur ?'});
 await step.getByRole('button',{name:'Détails de la demande'}).click();
 assert.match(await step.innerText(),/Cliquer[\s\S]*Contact · Exemple[\s\S]*Envoyer/);
 await step.getByRole('button',{name:'Autoriser',exact:true}).click();await step.getByText('Autorisé',{exact:true}).waitFor();
 assert.deepEqual(calls.find(c=>c.path==='/api/browser/sessions/s1/actions/a1').body,{decision:'approve',version:2,approved:true});assert.equal(await page.evaluate(()=>window.decided),1);
 pass('a browser step is decided in the conversation with the action version');
 const batch=page.getByRole('region',{name:'Autoriser Braand à programmer 2 publications ?'});await batch.waitFor();
 assert.equal(await batch.locator('.approval-details').count(),0);await batch.getByRole('button',{name:'Détails de la demande'}).click();
 assert.match(await batch.innerText(),/1\. La formation commence lundi ![\s\S]*2\. Dernières places disponibles\./);
 await batch.getByRole('button',{name:'Autoriser',exact:true}).click();await batch.getByText('Autorisé · Programmé',{exact:true}).waitFor();
 assert.deepEqual(calls.find(c=>c.path==='/api/social/batches/b1/decision').body,{version:3,digest:'d'.repeat(64),decision:'approve',postIds:['post-1','post-2']});
 pass('publications prepared by Braand are scheduled from the conversation, with the reviewed version and fingerprint');
 const reply=page.getByRole('region',{name:'Autoriser Braand à publier cette réponse sur Facebook ?'}).last();
 assert.match(await reply.innerText(),/Page Formation/);await reply.getByRole('button',{name:'Détails de la demande'}).click();
 assert.match(await reply.innerText(),/En réponse à Awa : « Où trouver le lien \? »[\s\S]*Merci Awa ! Le lien est en description\./);
 await reply.getByRole('button',{name:'Refuser',exact:true}).click();await reply.getByText('Refusé',{exact:true}).waitFor();
 assert.deepEqual(calls.find(c=>c.path==='/api/social/replies/rep1/decision').body,{version:2,digest:'f'.repeat(64),decision:'reject'});
 pass('a reply to a comment shows the comment and the exact answer, and is decided in the conversation');
 const priced=page.getByRole('region',{name:'Autoriser Braand à publier ce commentaire sur Facebook ?'}).last();
 assert.match(await priced.innerText(),/client@example.test[\s\S]*Plafond\s*3 crédits/);assert.equal(await priced.locator('.approval-details').count(),0);pass('the destination and credit ceiling remain visible while technical parameters are folded');
 const plan=page.getByRole('region',{name:'Autoriser le plan de création « Kit de lancement » ?'});await plan.waitFor();assert.match(await plan.innerText(),/Plafond\s*10 crédits maximum/);assert.equal(await plan.locator('.plan-steps').count(),0);await plan.getByRole('button',{name:'Détails de la demande'}).click();assert.match(await plan.innerText(),/Estimation\s*6 crédits/);assert.equal(await plan.locator('.plan-step').count(),2);assert.equal(await page.evaluate(()=>window.planApprovals||0),0);pass('a whole media plan uses the same compact approval without generating or losing its cost details');
 assert.deepEqual(errors,[]);await page.close();
 for(const [name,options] of [['light',{viewport:{width:1100,height:1400},colorScheme:'light'}],['mobile',{viewport:{width:390,height:844},deviceScaleFactor:2}]]){
  const view=await browser.newPage({...options,reducedMotion:'reduce'});await view.goto(origin);await view.locator('.approval-card').first().waitFor();
  if(name==='light')await view.evaluate(()=>document.documentElement.classList.add('light'));
  assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no side scroll');
  if(name==='mobile')assert.ok(await view.locator('.approval-card').first().locator('button').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().height>=44)),'44px touch targets');
  await view.screenshot({path:path.join(output,name+'.png'),fullPage:name==='light'});await view.close();
 }
 pass('light theme and phone layouts stay within the screen');
 console.log(`${checks} approval card checks passed; no real action or network call.`);
}finally{await browser.close();server.close();}
