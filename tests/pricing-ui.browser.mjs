// Full-screen pricing window in a real browser against a local API: four plans
// of equal height, Pro first in line of sight, annual switch, hosted payment
// redirect, owner-only purchase, Escape to close, mobile without side scroll.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/pricing-ui');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React,{useState} from "react";import {createRoot} from "react-dom/client";import {PricingDialog} from "./components/pricing/pricing-dialog";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/design-system.css";
function App(){const q=new URLSearchParams(location.search);const [open,setOpen]=useState(false);const [where,setWhere]=useState("");return <main><button className="topbar-upgrade" onClick={()=>setOpen(true)}>Passer à Pro</button><output id="where">{where}</output><PricingDialog open={open} onClose={()=>setOpen(false)} currentPlan={q.get("plan")||undefined} owner={q.get("role")!=="member"} guest={false} signInHref="/auth/sign-in" onDetails={()=>{setOpen(false);setWhere("details");}} onConfirmInSettings={()=>{setOpen(false);setWhere("settings");}}/></main>;}
createRoot(document.getElementById("root")).render(<App/>);`,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,format:'esm',jsx:'automatic',external:['/fonts/*'],loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},define:{'process.env.NODE_ENV':'"production"'},banner:{js:'globalThis.process??={env:{}};'}});
const require=createRequire(import.meta.url),playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const {PLANS}=await import(pathToFileURL(path.join(root,'lib/billing-core.mjs')).href);
const plans=Object.fromEntries(Object.entries(PLANS).map(([id,p])=>[id,{name:p.name,periodPrice:p.periodPrice,annualPrice:p.annualPrice,credits:p.credits,members:p.members,spaces:p.spaces,projects:p.projects,storage:p.storage,transfer:p.transfer,concurrency:p.concurrency,sites:p.sites}]));
const calls=[];
const json=(res,body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x'),p=url.pathname;let body='';for await(const c of req)body+=c;
 if(p==='/')return res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
 if(p==='/app.js'||p==='/app.css'){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/css'});return res.end(await readFile(path.join(output,p.slice(1))));}
 if(p==='/paid')return res.end('<!doctype html><title>Paiement</title><h1>Paiement factice</h1>');
 if(p.startsWith('/api/'))calls.push({method:req.method,path:p,body:body?JSON.parse(body):null});
 if(p==='/api/billing/catalog')return json(res,{annualAvailable:true,checkoutMode:'hosted',plans,readiness:{enabled:true}});
 if(p==='/api/billing/quotes')return json(res,{id:'quote-1',eligible:true});
 if(p==='/api/billing/checkout')return json(res,{id:'order-1',status:'pending',checkoutUrl:'/paid'});
 json(res,{error:'absent'},404);
}).listen(0);
const origin='http://127.0.0.1:'+server.address().port;
const number=value=>String(value);const flat=text=>text.replace(/[\s\u202f\u00a0]/g,'');
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const browser=await chromium.launch();
try{
 for(const scheme of ['dark','light']){
  const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:scheme}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:'Passer à Pro'}).click();
  const dialog=page.getByRole('dialog',{name:'Faites travailler Braand pour vous, tous les jours.'});await dialog.waitFor();
  const cards=dialog.locator('.pricing-card:not(.pricing-card-skeleton)');await cards.nth(3).waitFor();
  const box=await dialog.boundingBox();assert.equal(Math.round(box.width),1440);assert.equal(Math.round(box.height),900);
  const heights=await cards.evaluateAll(list=>list.map(card=>Math.round(card.getBoundingClientRect().height)));assert.equal(new Set(heights).size,1,'the four plans have the same height: '+heights);
  const tops=await cards.evaluateAll(list=>list.map(card=>Math.round(card.getBoundingClientRect().top)));assert.equal(new Set(tops).size,1,'the four plans sit side by side');
  assert.equal(await dialog.locator('.pricing-card[data-featured]').count(),1);assert.match(await dialog.locator('.pricing-card[data-featured]').innerText(),/Pro[\s\S]*Recommandé/);
  assert.equal(await dialog.locator('svg.lucide-sparkles').count(),0,'no sparkles icon');
  await page.screenshot({path:path.join(output,`desktop-${scheme}.png`)});
  if(scheme==='dark')pass('the window covers the screen; four plans side by side, same height, Pro recommended, no sparkles');
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto(origin);await page.getByRole('button',{name:'Passer à Pro'}).click();
 const dialog=page.getByRole('dialog');await dialog.locator('.pricing-card h3').first().waitFor();
 assert.match(flat(await dialog.locator('.pricing-card[data-featured] .pricing-price').innerText()),new RegExp(number(PLANS.pro.periodPrice)+'FCFA/30jours'));
 await dialog.getByRole('button',{name:/^Annuel/}).click();
 assert.equal(await dialog.getByRole('button',{name:/^Annuel/}).getAttribute('aria-pressed'),'true');
 assert.match(flat(await dialog.locator('.pricing-card[data-featured] .pricing-price').innerText()),new RegExp(number(PLANS.pro.annualPrice)+'FCFA/an'));
 assert.match(await dialog.getByRole('button',{name:/^Annuel/}).innerText(),/2 mois offerts/);
 pass('the annual switch shows yearly prices and the saving');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Passer à Pro');
 pass('Escape closes the window and gives focus back');
 await page.getByRole('button',{name:'Passer à Pro'}).click();await dialog.locator('.pricing-card h3').first().waitFor();
 await dialog.getByRole('button',{name:/^Choisir Pro,/}).click();await page.waitForURL(origin+'/paid');
 const quote=calls.find(c=>c.path==='/api/billing/quotes');assert.deepEqual(quote.body,{kind:'subscription',plan:'pro',cycle:'annual'},'the annual choice made earlier is kept');
 assert.deepEqual(calls.find(c=>c.path==='/api/billing/checkout').body.quoteId,'quote-1');
 pass('Choose Pro asks for a quote, opens the order and goes to the hosted payment page');
 calls.length=0;await page.goto(origin+'/?plan=pro');await page.getByRole('button',{name:'Passer à Pro'}).click();await dialog.locator('.pricing-card h3').first().waitFor();
 assert.match(await dialog.locator('.pricing-card[data-current]').innerText(),/Votre forfait[\s\S]*Renouveler/);
 assert.equal(await dialog.getByRole('button',{name:/Déjà inclus : Essentiel/}).isDisabled(),true);
 await dialog.getByRole('button',{name:/^Choisir Business,/}).click();await page.waitForURL(origin+'/paid');
 assert.deepEqual(calls.find(c=>c.path==='/api/billing/quotes').body,{kind:'upgrade',plan:'business'});
 pass('a subscriber sees their plan, renews it, and moves up with an upgrade');
 calls.length=0;await page.goto(origin+'/?role=member');await page.getByRole('button',{name:'Passer à Pro'}).click();await dialog.locator('.pricing-card h3').first().waitFor();
 assert.equal(await dialog.locator('.pricing-cta:not(:disabled)').count(),0);await dialog.getByText(/Seul le propriétaire de l’espace peut changer de forfait/).waitFor();
 assert.equal(calls.filter(c=>c.path!=='/api/billing/catalog').length,0);
 pass('a team member cannot pay and is told to ask the owner');
 await dialog.getByRole('button',{name:'Comparer en détail'}).click();await page.locator('#where',{hasText:'details'}).waitFor();
 pass('Compare in detail leads to Settings → Billing');
 await page.close();
 const phone=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 await phone.goto(origin);await phone.getByRole('button',{name:'Passer à Pro'}).click();const small=phone.getByRole('dialog');await small.locator('.pricing-card h3').first().waitFor();
 assert.equal(await small.locator('.pricing-card').evaluateAll(list=>list.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)[0].querySelector('h3').textContent),'Pro','Pro comes first on a phone');
 assert.ok(await phone.evaluate(()=>{const d=document.querySelector('.pricing-dialog');return d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth;}),'no side scroll');
 assert.ok(await small.getByRole('button',{name:'Fermer les tarifs'}).isVisible());
 await phone.screenshot({path:path.join(output,'mobile.png')});
 pass('on a phone the plans stack, Pro first, without side scroll, and the close button stays visible');
 console.log(`${checks} pricing checks passed; no payment or network call.`);
}finally{await browser.close();server.close();}
