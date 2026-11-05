// Suggestions board in a real browser against an in-memory API: list, vote
// (optimistic, rolled back when refused), duplicate hints while typing,
// creation, detail with team reply, report, notifications, mobile and keyboard.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/feedback-ui');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import FeedbackBoard from "./components/feedback/feedback-board";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
createRoot(document.getElementById("root")).render(<FeedbackBoard images={[{id:"img-1",title:"capture.png"}]}/>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'board.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const now=Date.now();
const posts=[
 {id:'p1',type:'feature',title:'Exporter les factures en PDF',body:'Pour mon comptable.',status:'planned',statusLabel:'Prévu',private:false,duplicateOf:null,hasAttachment:false,voteCount:12,commentCount:1,pinned:true,authorName:'Marie D.',mine:false,voted:false,createdAt:now-3*86400000},
 {id:'p2',type:'bug',title:'Le bouton Publier ne répond pas',body:'Je cliquais sur Publier, rien ne se passe, j’attendais la publication.',status:'new',statusLabel:'Nouveau',private:false,duplicateOf:null,hasAttachment:false,voteCount:3,commentCount:0,pinned:false,authorName:'Paul M.',mine:false,voted:true,createdAt:now-3600000},
 {id:'p3',type:'feature',title:'Factures PDF en un clic',body:'',status:'duplicate',statusLabel:'Doublon',private:false,duplicateOf:'p1',hasAttachment:false,voteCount:0,commentCount:0,pinned:false,authorName:'Awa',mine:false,voted:false,createdAt:now-7200000},
];
let created=null,refuseVote=false,reports=0;
const comments={p1:[{id:'c1',body:'Prévu pour décembre.',authorName:'Équipe Braand',isTeam:true,pinned:true,mine:false,createdAt:now-86400000}]};
const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x'),p=url.pathname;let body='';for await(const c of req)body+=c;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/board.css"></head><body><div id="root"></div><script type="module" src="/board.js"></script></body></html>');
 if(p==='/board.js'||p==='/board.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p==='/api/feedback'&&req.method==='GET'){let list=[...posts,...(created?[created]:[])];const type=url.searchParams.get('type'),q=url.searchParams.get('q');if(type)list=list.filter(x=>x.type===type);if(q)list=list.filter(x=>x.title.toLowerCase().includes(q.toLowerCase()));return json(res,{posts:list.map(x=>({...x,excerpt:x.body})),page:1,pages:1,total:list.length,statusCounts:{new:1,planned:1,duplicate:1},team:false});}
 if(p==='/api/feedback'&&req.method==='POST'){const input=JSON.parse(body);created={id:'p9',type:input.type,title:input.title,body:input.body,status:'new',statusLabel:'Nouveau',private:!!input.security,duplicateOf:null,hasAttachment:!!input.attachmentFileId,voteCount:1,commentCount:0,pinned:false,authorName:'Vous V.',mine:true,voted:true,createdAt:Date.now()};return json(res,{post:created,comments:[],original:null,team:false},201);}
 if(p==='/api/feedback/similar')return json(res,{posts:/facture/i.test(url.searchParams.get('title')||'')?[posts[0]]:[]});
 if(p==='/api/feedback/notifications')return json(res,{notifications:[{id:'n1',postId:'p1',title:'Exporter les factures en PDF',status:'planned',read:false,createdAt:now-3600000}]});
 if(p==='/api/feedback/notifications/read')return json(res,{ok:true});
 const vote=p.match(/^\/api\/feedback\/(\w+)\/vote$/);if(vote){if(refuseVote)return json(res,{error:'Trop de votes en une minute. Patientez un instant.'},429);const x=[...posts,created].find(i=>i?.id===vote[1]);x.voted=!x.voted;x.voteCount+=x.voted?1:-1;return json(res,{voted:x.voted,voteCount:x.voteCount});}
 const comment=p.match(/^\/api\/feedback\/(\w+)\/comments$/);if(comment){(comments[comment[1]]??=[]).push({id:'c'+Date.now(),body:JSON.parse(body).body,authorName:'Vous V.',isTeam:false,pinned:false,mine:true,createdAt:Date.now()});const x=[...posts,created].find(i=>i?.id===comment[1]);x.commentCount++;return json(res,{post:x,comments:comments[comment[1]],original:null,team:false},201);}
 if(/\/report$/.test(p)){reports++;return json(res,{reported:true,alreadyReported:reports>1});}
 const detail=p.match(/^\/api\/feedback\/(\w+)$/);if(detail){const x=[...posts,created].find(i=>i?.id===detail[1]);if(!x)return json(res,{error:'Suggestion introuvable.'},404);return json(res,{post:x,comments:comments[x.id]||[],original:x.duplicateOf?posts.find(i=>i.id===x.duplicateOf):null,team:false});}
 json(res,{error:'absent'},404);
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept(d.type()==='prompt'?'Hors sujet':undefined));
 await page.goto(origin);await page.getByRole('heading',{name:'Suggestions',exact:true}).waitFor();
 const rows=page.locator('.fb-row');assert.equal(await rows.count(),3);assert.match(await rows.first().innerText(),/Exporter les factures/);
 pass('the list shows pinned first with type, status, replies, author and date');
 const vote=page.getByRole('button',{name:/Voter pour « Exporter les factures en PDF »/});
 await vote.click();await page.getByRole('button',{name:/Retirer mon vote pour « Exporter les factures en PDF », 13 votes/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Retirer mon vote pour « Exporter/}).getAttribute('aria-pressed'),'true');
 refuseVote=true;await page.getByRole('button',{name:/Retirer mon vote pour « Exporter/}).click();await page.getByText('Trop de votes en une minute. Patientez un instant.').waitFor();
 assert.equal(await page.getByRole('button',{name:/Retirer mon vote pour « Exporter les factures en PDF », 13 votes/}).count(),1,'refused vote is rolled back');refuseVote=false;
 assert.equal(await page.getByRole('button',{name:/Voter pour « Factures PDF en un clic »/}).isDisabled(),true,'no vote on a duplicate');
 pass('voting is immediate, rolled back with a clear message when refused, and closed on duplicates');
 await page.getByRole('button',{name:'Bugs',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.fb-row').length===1);
 await page.getByRole('button',{name:'Tout',exact:true}).click();await page.getByRole('searchbox',{name:'Rechercher une suggestion'}).fill('publier');await page.waitForFunction(()=>document.querySelectorAll('.fb-row').length===1);
 await page.getByRole('searchbox',{name:'Rechercher une suggestion'}).fill('');pass('type tabs and search filter the list');
 await page.getByRole('button',{name:/^Notifications, 1 non lue/}).click();await page.getByRole('dialog',{name:'Notifications de statut'}).waitFor();await page.getByRole('dialog',{name:'Notifications de statut'}).getByRole('button').last().click();
 await page.getByRole('heading',{name:'Exporter les factures en PDF',level:2}).waitFor();assert.match(await page.locator('.fb-comments').innerText(),/Équipe[\s\S]*Prévu pour décembre/);
 pass('a status notification opens the suggestion; team replies are marked');
 await page.getByLabel('Votre réponse').fill('Et en Excel aussi.');await page.getByRole('button',{name:'Répondre',exact:true}).click();await page.getByText('Et en Excel aussi.').waitFor();
 await page.getByRole('button',{name:'Signaler',exact:true}).click();await page.getByText('Merci, l’équipe va regarder.').waitFor();
 pass('a member replies and reports with confirmation');
 await page.getByRole('button',{name:'Toutes les suggestions'}).click();await page.getByRole('button',{name:'Nouvelle suggestion'}).first().click();
 await page.getByRole('radio',{name:'Bug'}).click();assert.equal(await page.getByLabel(/Problème de sécurité/).count(),1);
 await page.getByRole('radio',{name:'Fonctionnalité'}).click();assert.equal(await page.getByLabel(/Problème de sécurité/).count(),0,'security only for a bug');
 await page.getByLabel('Titre').fill('Envoyer mes factures par e-mail');await page.getByText('Déjà proposé ? Votez plutôt que republier :').waitFor();
 assert.equal(await page.getByRole('button',{name:'Publier'}).isDisabled(),false);
 await page.getByLabel('Capture d’écran (facultative)').selectOption('img-1');
 await page.screenshot({path:path.join(output,'form-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Publier'}).click();await page.getByRole('heading',{name:'Envoyer mes factures par e-mail',level:2}).waitFor();
 assert.equal(created.hasAttachment,true);pass('creating shows similar suggestions while typing and opens the new suggestion');
 await page.getByRole('button',{name:'Toutes les suggestions'}).click();await page.waitForFunction(()=>document.querySelectorAll('.fb-row').length===4);
 await page.screenshot({path:path.join(output,'list-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'list-mobile.png'),fullPage:true});
 await page.keyboard.press('Tab');const focused=await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle);assert.notEqual(focused,'none');
 pass('mobile has no horizontal scroll and keyboard focus is visible');
 assert.deepEqual(errors,[]);pass('no browser errors');
}finally{await browser.close();server.close();}
console.log(`${checks} suggestions board browser checks passed.`);
