// Real React/Chromium UI with a local fixture server. No credentials or external provider calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {SKILL_CATALOG} from '../lib/skills/catalog.generated.mjs';
import {CATALOG_VERSION,PLANS,PACKS,topupPrice,quoteTax} from '../lib/billing-core.mjs';
import {demoAnalytics,DEMO_AD_ACCOUNT} from '../scripts/demo/analytics.mjs';

const require=createRequire(import.meta.url);
const playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.tmp','agent-ui-browser');
await mkdir(output,{recursive:true});
await build({external:['/fonts/*'],stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Studio from "./app/studio";import {AppearanceProvider} from "./components/appearance-provider";import "./app/appearance.css";import {FilePreviewProvider} from "./components/file-preview/file-preview-provider";import "./app/globals.css";import "./app/file-upload.css";import "./components/file-preview/file-preview.css";createRoot(document.getElementById("root")).render(<AppearanceProvider><FilePreviewProvider><Studio/></FilePreviewProvider></AppearanceProvider>);',resolveDir:root,loader:'tsx'},outdir:output,entryNames:'app',chunkNames:'chunks/[name]-[hash]',alias:{'next/image':'vinext/shims/image'},bundle:true,splitting:true,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'fixture-worker-url',setup(builder){builder.onResolve({filter:/^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/},()=>({path:'worker',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default "/unused-pdf-worker.mjs";',loader:'js'}));}}]});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZsAAAAASUVORK5CYII=','base64');
const now=Date.now();
// Explicit test fixture only: this is not a production tax determination.
const taxRule={mode:'exclusive',rateBps:1925,jurisdiction:'fixture:CM-only',version:'fixture-tax-v1',validatedAt:'2026-10-22'};
const money=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value)+' FCFA';
const proposal={id:'proposal-fixture',workspace_id:'fixture',kind:'proposal',title:'Visuel de test local',status:'awaiting_approval',version:1,created_at:now,updated_at:now,data:{kind:'media',rationale:'Fixture locale sans génération facturable',maxCredits:5,payload:{model:'fixture-image',input:{prompt:'Fixture'}}}};
const media={id:'media-fixture',workspace_id:'fixture',kind:'media',title:proposal.title,status:'ready',version:1,created_at:now,updated_at:now,data:{model:'fixture-image',output:{images:[]}}};
const conversation={id:'conversation-fixture',workspace_id:'fixture',kind:'conversation',title:'Discussion de test locale',status:'saved',version:1,created_at:now,updated_at:now,data:{}};
const sources=[{id:'source-real',title:'Rapport de test',domain:'example.org',url:'https://example.org/report'},{id:'source-unsafe',title:'<script>source non exécutable</script>',domain:'Document joint',url:'javascript:alert(1)'}];
const history=[];const votes=new Map();
const workspaceResources=[proposal,conversation],workspaceMutations=[];
let skillReads=0,failSkills=false,browserWrites=0,anonymousSession=false,authSends=0;
let approvals=0,polls=0,chatCalls=0,stops=0,imageRequests=0,feedbackCalls=0,failFeedback=false;
const firstChatHeaders=Promise.withResolvers();
const backgroundCompletion=Promise.withResolvers();
const deferredDelivery=Promise.withResolvers();
let workspaceReads=0,summaryReads=0,walletAvailable=200,walletReserved=12;
let checkoutCalls=0,billingEnabled=false;
let analyticsConnected=false,analyticsMode='full';const analyticsReads=[];
let workspaceRole='owner',failCampaignSave=false;const campaignWrites=[];
const quoteRequests=[],orderVerificationRequests=[];
const organizationMutations=[];
const catalogRequests=[],authorizationRequests=[],revocationRequests=[];
const connectedAccounts=new Set(['gmail','slack']);
const connectorFixtures=[{slug:'metaads',name:'Meta Ads',description:'Catalogue de test local',connected:false,status:'disconnected'},{slug:'gmail',name:'Gmail',description:'Compte de test isolé',connected:true,status:'active',accountId:'fixture-gmail'},{slug:'slack',name:'Slack',description:'Deuxième page de connexions de test',connected:true,status:'active',accountId:'fixture-slack'}];
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const drafts=new Map();
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.test');
  if(url.pathname==='/auth/form'){json(res,{authenticated:false,browser:'A'.repeat(43),returnTo:'/'});return;}
  if(url.pathname==='/auth/request'){authSends++;json(res,{error:'Email sending is forbidden in the layout fixture'},403);return;}
  if(url.pathname==='/fonts/Manrope.ttf'){res.writeHead(200,{'Content-Type':'font/ttf'});res.end(await readFile(path.join(root,'public/fonts/Manrope.ttf')));return;}
  if(url.pathname==='/brand/relais-logo-dark.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await readFile(path.join(root,'public/brand/relais-logo-dark.svg')));return;}
  if(url.pathname==='/api/drafts'){
   if(req.method==='GET'){json(res,drafts.get(url.searchParams.get('context'))||{content:'',version:0,attachments:[],updatedAt:0});return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());
   if(req.method==='DELETE'){drafts.delete(body.context);json(res,{ok:true});return;}
   const current=drafts.get(body.context)||{version:0};if(body.version!==current.version){json(res,{error:'Conflit de version'},409);return;}
   const next={content:body.content,attachments:body.attachments||[],version:current.version+1,updatedAt:Date.now()};drafts.set(body.context,next);json(res,next);return;
  }
  if(url.pathname==='/api/browser'){if(req.method!=='GET'){browserWrites++;json(res,{error:'Provider actions are not permitted in this UI fixture'},403);}else json(res,{readiness:{ready:false,reasons:['binding']},sessions:[],profiles:[]});return;}
  if(url.pathname==='/api/routines'){json(res,{items:[],readiness:{ready:false}});return;}
  if(url.pathname.startsWith('/api/pages/shell-page-')){if(url.searchParams.has('publication')){json(res,null);return;}const name=url.pathname.endsWith('-a')?'A':'B';setTimeout(()=>json(res,{html:'<!doctype html><html lang="fr"><body><h1>Page '+name+'</h1></body></html>'}),name==='A'?700:15);return;}
  if(url.pathname==='/api/work'){json(res,{items:[],readiness:{enabled:false},nextCursor:null});return;}
  if(url.pathname==='/api/skills'){
skillReads++;if(failSkills){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Catalogue indisponible'}));return;}json(res,{skills:SKILL_CATALOG.map(({id,title,description,category,version,capability})=>({id,title,description,category,version,capability}))});return;}
  if(url.pathname==='/api/workspace'&&req.method==='POST'){

    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());workspaceMutations.push(body);
    const created={id:'fixture-imported-skill',workspace_id:'fixture',kind:body.kind,title:body.title,status:'candidate',version:1,created_at:now,updated_at:now,data:body.data};workspaceResources.push(created);json(res,created);return;
  }
  if(url.pathname==='/api/workspace'){workspaceReads++;if(anonymousSession){json(res,{error:'Sign in required'},401);return;}json(res,{role:workspaceRole,user:{id:'fixture-user',name:'Compte de test',email:'fixture@example.test'},workspace:{id:'fixture',name:'Espace de test',credits:walletAvailable+walletReserved,reserved:walletReserved},resources:workspaceResources,catalog:[{id:'fixture-image',kind:'image'}],capabilities:{model:true,modelReady:true,filePreview:false,metaConnected:analyticsConnected}});return;}
  const campaignIndex=workspaceResources.findIndex(resource=>resource.kind==='campaign'&&url.pathname==='/api/resources/'+resource.id);
  if(campaignIndex>=0){
    if(req.method==='GET'){json(res,workspaceResources[campaignIndex]);return;}
    if(req.method==='PATCH'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());campaignWrites.push(body);
      if(workspaceRole==='reader'){json(res,{error:'Lecture seule'},403);return;}
      if(failCampaignSave){failCampaignSave=false;json(res,{error:'Échec local de l’enregistrement'},503);return;}
      const current=workspaceResources[campaignIndex];if(body.version!==current.version){json(res,{error:'La version a changé. Actualisez avant de continuer.'},409);return;}
      const updated={...current,title:body.title,version:current.version+1,updated_at:Date.now(),data:{...current.data,...body.brief}};workspaceResources[campaignIndex]=updated;json(res,updated);return;
    }
  }
  if(url.pathname==='/api/meta'){
    analyticsReads.push({method:req.method,accountId:url.searchParams.get('accountId'),days:url.searchParams.get('days')});
    if(!url.searchParams.has('accountId')){json(res,{data:analyticsMode==='empty'?[]:[DEMO_AD_ACCOUNT,{...DEMO_AD_ACCOUNT,id:'act_other_fixture',name:'Autre compte fictif'}]});return;}
    if(analyticsMode==='failure'){json(res,{error:'Lecture publicitaire indisponible'},502);return;}
    const report=demoAnalytics(Number(url.searchParams.get('days')||30));
    if(url.searchParams.get('accountId')==='act_other_fixture')report.account={...report.account,id:'act_other_fixture',name:'Autre compte fictif'};
    if(analyticsMode==='missing'){report.daily=null;report.comparison=null;}
    if(analyticsMode==='partial')report.hasMore=true;
    if(analyticsMode==='race'&&url.searchParams.get('days')==='7'){setTimeout(()=>{if(!res.destroyed)json(res,report);},300);return;}
    json(res,report);return;
  }
  if(url.pathname==='/api/connectors/toolkits'){
    catalogRequests.push({connected:url.searchParams.get('connected'),search:url.searchParams.get('search'),cursor:url.searchParams.get('cursor')});
    const query=(url.searchParams.get('search')||'').toLowerCase(),connected=url.searchParams.get('connected')==='true',cursor=url.searchParams.get('cursor');
    const matches=connectorFixtures.map(item=>({...item,connected:connectedAccounts.has(item.slug),status:connectedAccounts.has(item.slug)?'active':'disconnected'})).filter(item=>(!connected||item.connected)&&(!query||item.name.toLowerCase().includes(query)));
    const paginated=connected&&!query&&matches.length>1;
    const items=paginated?(cursor==='fixture-connected-2'?matches.slice(1):matches.slice(0,1)):matches;
    json(res,{items,nextCursor:paginated&&!cursor?'fixture-connected-2':null,configured:true,instant:{enabled:false,monthlyLimitUsd:0,perCallLimitUsd:0,note:'Test local'}});return;
  }
  if(url.pathname==='/api/connectors/authorize'&&req.method==='POST'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());authorizationRequests.push(body);
    json(res,{redirectUrl:'https://connect.composio.dev/fixture-authorization'});return;
  }
  if(url.pathname.startsWith('/api/connectors/accounts/')&&req.method==='DELETE'){
    const accountId=decodeURIComponent(url.pathname.split('/').at(-1));revocationRequests.push(accountId);const item=connectorFixtures.find(item=>item.accountId===accountId);if(item)connectedAccounts.delete(item.slug);
    json(res,{disconnected:true});return;
  }
  if(url.pathname==='/api/billing/catalog'){json(res,{version:CATALOG_VERSION,currency:'XAF',plans:PLANS,packs:PACKS.map(quantity=>({quantity,amount:topupPrice(quantity)})),custom:null,cycles:['period'],annualAvailable:false,tax:{configured:true,...taxRule},readiness:{enabled:billingEnabled},free:{credits:15,days:7,enabled:false}});return;}
  if(url.pathname==='/api/billing/summary'){summaryReads++;json(res,{wallet:{available:walletAvailable,reserved:12},creditAllowance:PLANS.pro.credits,subscription:null,meters:{storage:10*1024*1024,transfer:20*1024*1024},lots:[],orders:[],invoices:[]});return;}
  if(url.pathname==='/api/billing/organization'){
    if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);organizationMutations.push(JSON.parse(Buffer.concat(chunks).toString()));json(res,{error:'Le test interdit les mutations d’équipe'},403);return;}
    json(res,{current:'fixture',organization:'fixture-org',role:'owner',rights:{plan:'business',limits:PLANS.business},spaces:[{id:'fixture',name:'Espace de test',organization_id:'fixture-org',organization_name:'Organisation de test'}],members:[{user_id:'fixture-user',role:'owner',active:1},{user_id:'fixture-reader',role:'reader',active:1,name:'Lecteur de test'}],limits:[],pendingInvites:0,activeMemberCount:2,viewer:{userId:'fixture-user',email:'fixture@example.test',displayName:'Compte de test'}});return;
  }
  if(url.pathname==='/api/billing/usage'){json(res,{entries:[],daily:[],asOf:now});return;}
  if(url.pathname==='/api/billing/price'){json(res,{amount:topupPrice(Number(url.searchParams.get('quantity')))});return;}
  if(url.pathname==='/api/billing/quotes'&&req.method==='POST'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());quoteRequests.push(body);
    const credits=body.kind==='topup'?body.quantity:PLANS[body.plan||'pro'].credits;
    if(body.kind==='subscription'&&body.cycle!=='period'){json(res,{error:'La fixture interdit les nouvelles ventes annuelles'},409);return;}
    const amount=body.kind==='topup'?topupPrice(credits):PLANS[body.plan||'pro'].periodPrice;
    json(res,{id:'fixture-quote',...body,...quoteTax(amount,taxRule),credits,units:credits*100,expiresAt:Date.now()+300000,eligible:false});return;
  }
  if(url.pathname==='/api/billing/checkout'){checkoutCalls++;json(res,{error:'Le test interdit toute tentative de paiement'},403);return;}
  if(url.pathname.startsWith('/api/billing/orders/')&&req.method==='GET'){
    orderVerificationRequests.push({id:decodeURIComponent(url.pathname.split('/').at(-1)),verify:url.searchParams.get('verify')});
    json(res,{id:'fixture-return-order',amount:5963,product:JSON.stringify({kind:'topup',quantity:125}),created_at:now,status:'pending'});return;
  }
  if(url.pathname==='/api/chat'&&req.method==='GET'){json(res,{messages:history.map(message=>({...message,feedback:votes.get(message.id)??null}))});return;}
  if(url.pathname==='/api/chat'&&req.method==='PATCH'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());feedbackCalls++;if(failFeedback){failFeedback=false;json(res,{error:'Échec local de test'},503);return;}votes.set(body.messageId,body.feedback);json(res,body);return;}
  if(url.pathname==='/api/chat'&&req.method==='DELETE'){stops++;json(res,{stopped:true});return;}
  if(url.pathname==='/api/chat'&&req.method==='POST'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());chatCalls++;
    if(['Discussion A en arrière-plan','Discussion B indépendante'].includes(body.text)){
      const label=body.text.startsWith('Discussion A')?'A':'B',id='conversation-background-'+label,index=chatCalls;
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});const emit=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
      emit('run',{runId:'background-'+index,conversationId:id});emit('text_delta',{text:'Texte réservé à la discussion '+label+'.'});
      if(label==='A')await backgroundCompletion.promise;else await new Promise(resolve=>setTimeout(resolve,1200));
      emit('assistant_message',{messageId:'background-message-'+index,runId:'background-'+index,sources:[]});emit('done',{runId:'background-'+index});res.end();return;
    }
    const generatedText=body.text==='Markdown multilingue'?'# Résumé\n\n- **مرحبا**\n- 世界\n\n```json\n{"safe":"<img src=x onerror=alert(1)>"}\n```':'Résultat de test conservé.';
    if(body.text==='Bonjour')await firstChatHeaders.promise;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
    const emit=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
    emit('run',{runId:'run-'+chatCalls,conversationId:'conversation-fixture'});
    const timers=[];
    if(body.text==='Préserver le navigateur'){emit('text_delta',{text:'Préparation du livrable de la fixture.'});await deferredDelivery.promise;const artifact={id:'shell-delivery',workspace_id:'fixture',kind:'deliverable',title:'Livrable pendant la navigation',status:'draft',version:1,created_at:now,updated_at:now,data:{content:'Contenu de contrôle',category:'research',format:'markdown',sources:[],executionConfirmed:false}};workspaceResources.push(artifact);emit('tool_result',{id:'shell-delivery-tool',name:'save_deliverable',result:artifact});emit('assistant_message',{messageId:'shell-delivery-message',runId:'run-'+chatCalls,sources:[]});emit('done',{runId:'run-'+chatCalls});res.end();return;}
    if(body.text==='Sources de démonstration locale'){
      const workspaceId=String(req.headers['x-braand-workspace']||'fixture');
      const file={id:'native-zip-fixture',workspace_id:workspaceId,kind:'file',title:'sources-fixture.zip',status:'ready',version:1,created_at:now,updated_at:now,data:{mime:'application/zip',size:2048}};
      const artifact={id:'native-project-fixture',workspace_id:workspaceId,kind:'deliverable',title:'Projet source de démonstration',status:'draft',version:1,created_at:now,updated_at:now,data:{title:'Projet source de démonstration',summary:'Sources proposées',content:'Code source exporté. Tests non exécutés.',category:'software',format:'source-project',sources:[],executionConfirmed:false},file};
      workspaceResources.push(artifact,file);
      timers.push(setTimeout(()=>emit('tool_result',{id:'native-source',name:'save_source_project',result:artifact}),100));
      timers.push(setTimeout(()=>emit('tool_result',{id:'native-source',name:'save_source_project',result:artifact}),160));
    }

    timers.push(setTimeout(()=>emit('specialist_start',{role:'creative'}),80));
    timers.push(setTimeout(()=>emit('tool_start',{name:'read_meta'}),350));
    timers.push(setTimeout(()=>emit('text_delta',{text:generatedText}),650));
    if(body.text==='Coupure réseau')timers.push(setTimeout(()=>res.end(),1000));
    else if(body.text!=='Arrêt utilisateur')timers.push(setTimeout(()=>{if(body.text==='Bonjour')walletAvailable=195;const messageId='assistant-'+chatCalls;history.push({id:'user-'+chatCalls,role:'user',content:[{type:'text',text:body.text}],attachments:[]},{id:messageId,role:'assistant',content:[{type:'text',text:generatedText}],status:'complete',sources,attachments:[]});emit('assistant_message',{messageId,runId:'run-'+chatCalls,sources});emit('done',{runId:'run-'+chatCalls});res.end();},body.text==='Bonjour'?3500:1700));
    res.on('close',()=>timers.forEach(clearTimeout));return;
  }
  if(url.pathname==='/api/proposals/'+proposal.id){
    if(req.method==='POST'){approvals++;proposal.status='generating';json(res,{status:'waiting_external'});return;}
    polls++;json(res,polls===1?{status:'IN_PROGRESS'}:{status:'COMPLETED',resourceId:media.id});return;
  }
  if(url.pathname==='/api/resources/'+proposal.id){json(res,proposal);return;}
  if(url.pathname==='/api/resources/'+media.id){json(res,media);return;}
  if(url.pathname.startsWith('/api/resources/native-')){const item=workspaceResources.find(item=>item.id===url.pathname.split('/').at(-1));json(res,item||{},item?200:404);return;}
  if(url.pathname.startsWith('/api/')){json(res,{},404);return;}
  if(url.pathname==='/fixture.png'){imageRequests++;if(imageRequests===1){res.writeHead(503,{'Cache-Control':'no-store'});res.end();return;}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(png);return;}
  if(url.pathname==='/app.js'||url.pathname==='/app.css'||url.pathname.startsWith('/chunks/')){
    try{const target=path.resolve(output,'.'+url.pathname);if(!target.startsWith(output+path.sep))throw Error();res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'application/javascript'});res.end(await readFile(target));}catch{res.writeHead(404);res.end();}return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Braand · Test isolé</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
media.data.output.images=[{url:origin+'/fixture.png',width:512,height:512}];
let browser,lastPage;
const checks=[];
try{
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
  const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:"dark"});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();lastPage=page;const pageErrors=[];page.on('pageerror',error=>{pageErrors.push(error.message);console.error('Browser error:',error.message);});
  const capture=async options=>{
    await page.locator('dialog[open]').evaluateAll(async dialogs=>{
      await Promise.all(dialogs.flatMap(dialog=>dialog.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    });
    await page.screenshot(options);
  };
  await page.addInitScript(()=>{window.__copyFail=false;window.__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__copyFail)throw new Error('Clipboard denied');window.__copied.push(text);}}});});
  await page.goto(origin);await page.getByRole('textbox',{name:'Votre demande à Braand'}).waitFor();
  await page.getByText('12 réservés · non débités',{exact:true}).waitFor();
  assert.equal(await page.locator('.account-credit-row > small').innerText(),'200 disponibles');
  await capture({path:path.join(output,'credit-reservation-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Ouvrir la navigation',exact:true}).click();
  assert.ok(await page.locator('.account-trigger').evaluate(element=>element.scrollWidth<=element.clientWidth));
  await capture({path:path.join(output,'credit-reservation-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});
  walletReserved=0;walletAvailable=211.8;
  await page.waitForFunction(()=>document.querySelector('.account-credit-row > small')?.textContent==='211,8 disponibles');
  assert.equal(await page.locator('.account-reserved-credits').count(),0);
  checks.push('Available and reserved credits stay distinct on desktop/mobile and settlement refreshes without reloading or charging the reservation');
  walletAvailable=200;walletReserved=12;await page.goto(origin);await page.getByRole('textbox',{name:'Votre demande à Braand'}).waitFor();
  assert.equal(await page.locator('.brand-lockup').innerText(),'Braand');
  assert.equal(await page.locator('.brand-lockup [data-brand-logo="relais"]').count(),1);
  assert.ok(await page.locator('.brand-lockup .sr-only').evaluate(element=>element.getBoundingClientRect().width<=1&&getComputedStyle(element).clipPath==='inset(50%)'),'Accessible product name stays available without a second visible wordmark');
  assert.ok(await page.locator('.sidebar-brand').evaluate(element=>element.querySelector('[data-brand-logo]').getBoundingClientRect().right<=element.querySelector('.sidebar-header-actions').getBoundingClientRect().left),'The official lockup leaves room for search and collapse controls');
  assert.ok(await page.locator('.sidebar-brand').evaluate(element=>element.scrollWidth<=element.clientWidth),'Braand wordmark must fit beside navigation controls');
  assert.doesNotMatch(await page.locator('body').innerText(),/\bA[iï]ra\b/iu,'Visible application keeps the new product name');
  checks.push('Braand identity fits the existing sidebar and replaces the legacy visible product name');
  await page.locator('.welcome-symbol canvas[data-bot-avatar="clover"][data-state="default"]').waitFor();
  const composer=page.getByRole('textbox',{name:'Votre demande à Braand'});
  const initial=await page.locator('.composer').boundingBox();
  assert.equal(await page.locator('body').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(24, 24, 25)');
  assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width),248);
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'Intégrations',exact:true}).count(),0);
  assert.equal(await page.locator('.sidebar').getByRole('button',{name:'Compétences',exact:true}).count(),0);
  await composer.fill('Une ligne\nUne deuxième ligne\nUne troisième ligne');
  await page.waitForFunction(()=>document.querySelector('.composer textarea').clientHeight>=72);
  const grown=await page.locator('.composer').boundingBox();assert.ok(grown.height>initial.height);assert.equal(Math.round(grown.width),Math.round(initial.width));
  await composer.fill('Document très long.\n'.repeat(100));
  await page.waitForFunction(()=>{const field=document.querySelector('.composer textarea');return field.clientHeight===192&&field.scrollHeight>field.clientHeight&&getComputedStyle(field).overflowY==='auto';});
  assert.equal(Math.round((await page.locator('.composer').boundingBox()).width),Math.round(initial.width));
  await composer.fill('');await page.getByRole('heading',{name:'Faites grandir vos idées.'}).click();
  await capture({path:path.join(output,'design-home-desktop.png'),fullPage:true});
  const assertAccountMenuVisible=async()=>{const menu=page.getByRole('menu',{name:'Menu du compte',exact:true});await menu.waitFor();await page.waitForFunction(()=>{const menu=document.querySelector('[role=menu][aria-label="Menu du compte"]');return menu&&getComputedStyle(menu).opacity==='1';});const bounds=await menu.boundingBox(),viewport=page.viewportSize();assert.ok(bounds.x>=8,'Account menu must stay inside the left viewport edge');assert.ok(bounds.y>=8,'Account menu must stay inside the top viewport edge');assert.ok(bounds.x+bounds.width<=viewport.width-8,'Account menu must stay inside the right viewport edge');assert.ok(bounds.y+bounds.height<=viewport.height-8,'Account menu must stay inside the bottom viewport edge');return menu;};
  await page.getByRole('button',{name:'Replier la navigation',exact:true}).click();await page.waitForFunction(()=>Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)===72);assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width),72);
  await page.locator('.account-trigger').click();await assertAccountMenuVisible();await page.locator('.account-trigger').click();
  await page.getByRole('button',{name:'Déployer la navigation',exact:true}).click();
  await composer.fill('Brouillon conservé pendant les paramètres');
  await page.locator('.account-trigger').click();await assertAccountMenuVisible();await capture({path:path.join(output,'design-account-menu-desktop.png'),fullPage:true});await page.getByRole('menuitem',{name:'Paramètres',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Paramètres',exact:true});await settings.waitFor();
  assert.equal(await settings.locator('.settings-shell').evaluate(element=>getComputedStyle(element).gridTemplateColumns),'224px 656px');
  for(const label of ['Général','Connecteurs','Compétences','Portefeuille','Facturation','Équipe et budgets','Stockage','Autorisations','Aide et raccourcis'])assert.equal(await settings.locator('.settings-navigation').getByRole('button',{name:label,exact:true}).count(),1);
  await settings.getByRole('heading',{name:'Général',exact:true}).waitFor();
  await settings.getByText('fixture@example.test',{exact:true}).waitFor();
  await settings.getByText('Compte de test',{exact:true}).waitFor();
  await settings.getByText('Espace de test',{exact:true}).waitFor();
  await settings.getByText('200 crédits',{exact:true}).waitFor();
  await settings.getByText('12 réservés',{exact:true}).waitFor();
  await capture({path:path.join(output,'design-settings-general-desktop.png'),fullPage:true});
  await settings.locator('.settings-navigation').getByRole('button',{name:'Aide et raccourcis',exact:true}).click();
  await settings.getByRole('heading',{name:'Raccourcis clavier',exact:true}).waitFor();
  await settings.locator('.settings-navigation').getByRole('button',{name:'Portefeuille',exact:true}).click();
  await settings.getByText('250 crédits',{exact:true}).waitFor();
  await settings.getByText('12 crédits',{exact:true}).waitFor();
  await settings.locator('.settings-navigation').getByRole('button',{name:'Stockage',exact:true}).click();await settings.getByRole('heading',{name:'Utilisation',exact:true}).waitFor();
  assert.match(await settings.locator('.settings-storage').innerText(),/^10 Mo sur /);
  assert.equal(await settings.getByRole('progressbar',{name:'Stockage utilisé',exact:true}).getAttribute('aria-valuenow'),String(10*1024*1024));
  assert.equal(await settings.getByRole('progressbar',{name:'Stockage utilisé',exact:true}).getAttribute('aria-valuemax'),String(PLANS.business.storage));
  assert.match(await settings.locator('.settings-content').innerText(),/20 Mo sur /);
  await settings.locator('.settings-navigation').getByRole('button',{name:'Autorisations',exact:true}).click();await settings.getByText('Propriétaire',{exact:true}).waitFor();await settings.getByText('Business',{exact:true}).waitFor();
  assert.equal(await settings.locator('.settings-content').getByRole('switch').count(),0,'Authorization policies must not expose fake permission switches');
  checks.push('Compact sidebar moves all nine management sections into settings with real storage and role values');
  await settings.locator('.settings-navigation').getByRole('button',{name:'Connecteurs',exact:true}).click();await settings.getByRole('button',{name:'Activer Meta Ads',exact:true}).waitFor();
  assert.equal(await settings.getByRole('searchbox',{name:'Rechercher une application',exact:true}).evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.ok(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await capture({path:path.join(output,'design-settings-desktop.png'),fullPage:true});
  assert.equal(await settings.getByRole('button',{name:'Disponible',exact:true}).getAttribute('aria-pressed'),'true');
  const metaTrigger=settings.getByRole('button',{name:'Découvrir Meta Ads',exact:true});
  await metaTrigger.click();const metaDetail=page.getByRole('dialog',{name:'Meta Ads',exact:true});await metaDetail.waitFor();
  assert.equal(authorizationRequests.length,0,'Opening a connector must not request authorization');
  assert.equal(revocationRequests.length,0);
  await capture({path:path.join(output,'design-connector-detail-desktop.png'),fullPage:true});
  await page.keyboard.press('Escape');await metaDetail.waitFor({state:'hidden'});assert.equal(await settings.isVisible(),true);
  assert.equal(await metaTrigger.evaluate(element=>element===document.activeElement),true,'Closing a connector returns focus to its trigger');
  await metaTrigger.click();await metaDetail.waitFor();
  await metaDetail.getByRole('button',{name:'Connecter',exact:true}).evaluate(button=>{button.click();button.click();});
  const authorize=metaDetail.getByRole('link',{name:'Autoriser Meta Ads',exact:true});await authorize.waitFor();
  assert.deepEqual(authorizationRequests,[{toolkit:'metaads'}]);
  assert.equal(await authorize.getAttribute('href'),'https://connect.composio.dev/fixture-authorization');
  assert.equal(await authorize.getAttribute('target'),'_blank');assert.equal(await authorize.getAttribute('rel'),'noopener noreferrer');
  assert.equal(context.pages().length,1,'OAuth must remain an explicit user-controlled link');
  for(const action of await metaDetail.locator('button,a').all()){
    const bounds=await action.boundingBox(),label=await action.getAttribute('aria-label')||await action.innerText();
    assert.ok(bounds.height>=44,`Connector dialog action “${label}” needs a 44px touch target; got ${bounds.height}px`);
  }
  // Simulate an OAuth grant at the fixture boundary; no authorization page is opened.
  connectedAccounts.add('metaads');
  await metaDetail.getByRole('button',{name:'Actualiser après la connexion',exact:true}).click();await metaDetail.waitFor({state:'hidden'});
  await settings.getByRole('button',{name:'Voir Meta Ads',exact:true}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'Disponible',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await settings.getByRole('searchbox',{name:'Rechercher une application',exact:true}).inputValue(),'Meta Ads');
  assert.ok(catalogRequests.some(request=>request.search==='Meta Ads'&&request.connected===null&&request.cursor===null));
  await settings.getByText('Consultez l’état de Meta Ads dans les résultats actualisés.',{exact:true}).waitFor();
  assert.deepEqual(authorizationRequests,[{toolkit:'metaads'}],'Refreshing an OAuth result must not authorize or mutate the account again');
  connectedAccounts.delete('metaads');await settings.getByRole('button',{name:'Actualiser les connexions',exact:true}).click();await settings.getByRole('button',{name:'Activer Meta Ads',exact:true}).waitFor();
  await settings.getByRole('searchbox',{name:'Rechercher une application',exact:true}).fill('');await settings.getByRole('button',{name:'Voir Gmail',exact:true}).waitFor();
  await settings.getByRole('button',{name:'Connecté',exact:true}).click();await settings.getByRole('button',{name:'Voir Gmail',exact:true}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'Connecté',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await settings.getByRole('button',{name:'Activer Meta Ads',exact:true}).count(),0);
  assert.equal(await settings.getByRole('button',{name:'Voir Slack',exact:true}).count(),0,'The connected fixture starts with one server page');
  await settings.getByRole('button',{name:'Afficher d’autres applications',exact:true}).click();await settings.getByRole('button',{name:'Voir Slack',exact:true}).waitFor();
  assert.ok(catalogRequests.some(request=>request.connected==='true'&&request.cursor==='fixture-connected-2'),'Connected filtering must be sent on pagination');
  const connectorSearch=settings.getByRole('searchbox',{name:'Rechercher une application',exact:true});
  await connectorSearch.fill('Slack');await settings.getByRole('button',{name:'Voir Slack',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.connectors-results')?.getAttribute('aria-busy')==='false');
  assert.equal(await settings.getByRole('button',{name:'Voir Gmail',exact:true}).count(),0);
  assert.ok(catalogRequests.some(request=>request.connected==='true'&&request.search==='Slack'&&request.cursor===null),'Search remains server-filtered within connected accounts');
  await connectorSearch.fill('');await settings.getByRole('button',{name:'Voir Gmail',exact:true}).waitFor();
  await settings.getByRole('button',{name:'Voir Gmail',exact:true}).click();const gmailDetail=page.getByRole('dialog',{name:'Gmail',exact:true});await gmailDetail.waitFor();
  await gmailDetail.getByRole('button',{name:'Déconnecter Gmail',exact:true}).click();
  assert.equal(revocationRequests.length,0,'The first disconnect action only asks for confirmation');
  await gmailDetail.getByRole('button',{name:'Annuler',exact:true}).click();assert.equal(revocationRequests.length,0);
  await gmailDetail.getByRole('button',{name:'Déconnecter Gmail',exact:true}).click();
  await gmailDetail.getByRole('button',{name:'Confirmer la déconnexion',exact:true}).evaluate(button=>{button.click();button.click();});
  await gmailDetail.waitFor({state:'hidden'});await settings.getByRole('button',{name:'Voir Slack',exact:true}).waitFor();
  assert.deepEqual(revocationRequests,['fixture-gmail']);assert.equal(await settings.getByRole('button',{name:'Voir Gmail',exact:true}).count(),0);
  checks.push('Settings show real account, wallet, storage and shortcuts without invented subscription prices');
  checks.push('Connector discovery is read-only; authorization needs one explicit click and a safe user-controlled OAuth link');
  checks.push('OAuth refresh closes the stale dialog and fetches the selected application by name without another authorization');
  checks.push('Connected catalog uses server-side search and pagination; disconnect requires confirmation and prevents double submission');
  checks.push('Nested connector dialog closes independently and restores focus to the originating card');
  await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.classList.contains('account-trigger'));
  assert.equal(await composer.inputValue(),'Brouillon conservé pendant les paramètres');await composer.fill('');
  await page.goto(origin+'/?view=analytics');await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:'Paramètres',exact:true}).click();await settings.waitFor();
  await settings.getByRole('button',{name:'Fermer les paramètres',exact:true}).click();await settings.waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.get('view'),'analytics');
  checks.push('Opening settings preserves the composer draft and current analytics route');
  const workspaceReadsBeforeSwitch=workspaceReads,mutationsBeforeSwitch={chatCalls,approvals,authorizationCalls:authorizationRequests.length,revocationCalls:revocationRequests.length};
  const reloadedWorkspace=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace'&&response.request().method()==='GET');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'braand.workspace',oldValue:'fixture',newValue:'fixture-other',storageArea:localStorage,url:location.href})))]);
  await reloadedWorkspace;assert.ok(workspaceReads>workspaceReadsBeforeSwitch);assert.equal(new URL(page.url()).searchParams.get('view'),'analytics');
  assert.deepEqual({chatCalls,approvals,authorizationCalls:authorizationRequests.length,revocationCalls:revocationRequests.length},mutationsBeforeSwitch);
  checks.push('A workspace change in another tab reloads its snapshot without running model, generation or connector mutations');
  await page.goto(origin+'/?view=knowledge');await settings.waitFor();await settings.getByRole('heading',{name:'Compétences',exact:true}).waitFor();
  await settings.getByRole('heading',{name:'Pilotage opérationnel des publicités',exact:true}).waitFor();
  assert.equal(await settings.locator('.skill-card').count(),SKILL_CATALOG.length);
  assert.ok(skillReads>0);assert.equal(await settings.getByRole('heading',{name:'Auditer une campagne Meta',exact:true}).count(),0);
  const methodSearch=settings.getByRole('textbox',{name:'Rechercher des compétences'});
  await methodSearch.fill('Réunions');const meetingCard=settings.locator('.skill-card');assert.equal(await meetingCard.count(),1);
  await meetingCard.getByRole('button',{name:'Utiliser',exact:true}).focus();await page.keyboard.press('Enter');await settings.waitFor({state:'hidden'});
  assert.match(await composer.inputValue(),/braand-meeting-actions/);assert.equal(chatCalls,0);await composer.fill('');
  failSkills=true;await page.goto(origin+'/?view=knowledge');await settings.waitFor();await settings.getByRole('alert').filter({hasText:'méthodes intégrées'}).waitFor();
  failSkills=false;await settings.getByRole('button',{name:'Réessayer',exact:true}).click();await settings.getByRole('heading',{name:'Réunions, décisions et actions',exact:true}).waitFor();
  checks.push('The settings library uses the real reviewed registry; keyboard Use only prepares a draft and a catalog failure can be retried');
  await settings.getByRole('heading',{name:'Compétences',exact:true}).hover();
  await page.waitForFunction(()=>{const card=document.querySelector('.skill-card');return card&&!card.matches(':hover')&&getComputedStyle(card).backgroundColor==='rgb(40, 41, 43)';});
  assert.equal(await settings.locator('.skill-card').first().evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(40, 41, 43)');
  await capture({path:path.join(output,'design-skills-desktop.png'),fullPage:true});
  const skillChooserPromise=page.waitForEvent('filechooser');await settings.getByRole('button',{name:'Importer une compétence',exact:true}).click();const skillChooser=await skillChooserPromise;
  await skillChooser.setFiles({name:'methode-test-locale.md',mimeType:'text/markdown',buffer:Buffer.from('# Méthode de test locale\nUne méthode strictement fictive.\n## Étapes\n- Lire le contexte\n## Vérifications\n- Demander les preuves')});
  const importedSkill=settings.locator('.skill-card').filter({has:page.getByRole('heading',{name:'Méthode de test locale',exact:true})});await importedSkill.waitFor();
  assert.equal(workspaceMutations.length,1);assert.equal(workspaceMutations[0].kind,'skill');
  await importedSkill.getByRole('button',{name:'Utiliser',exact:true}).click();await settings.waitFor({state:'hidden'});await composer.waitFor();
  assert.match(await composer.inputValue(),/Méthode de test locale/);assert.match(await composer.inputValue(),/get_workspace_resource/);assert.equal(chatCalls,0,'Using a skill prepares a draft without executing the agent');await composer.fill('');
  checks.push('Skills stay available in settings: import stores a private method and Use prepares the chat without execution');
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:/Crédits et facturation/}).click();await settings.waitFor();
  await settings.getByRole('heading',{name:'Facturation',exact:true}).waitFor();await settings.locator('.billing-loading').waitFor({state:'hidden'});await settings.getByRole('button',{name:'Actualiser la facturation',exact:true}).waitFor();
  const billingNavigation=settings.getByRole('navigation',{name:'Rubriques de facturation',exact:true});
  const embeddedBilling=settings.getByRole('region',{name:'Forfaits et crédits',exact:true});await embeddedBilling.waitFor();
  const assertQuoteTax=async(baseAmount)=>{
    const expected=quoteTax(baseAmount,taxRule);
    for(const [label,value] of [['Sous-total hors taxes',expected.subtotal],['Taxes · fixture:CM-only · 19,25 %',expected.tax],['Total à payer',expected.total]]){
      const term=embeddedBilling.getByText(label,{exact:true});await term.waitFor();
      assert.equal(await term.locator('..').locator('dd').innerText(),money(value),`The server ${label} must be displayed before payment confirmation`);
    }
    assert.equal(await settings.getByRole('button',{name:'Accepter le total et continuer vers le paiement',exact:true}).isDisabled(),true,'An ineligible quote must never permit checkout');
    assert.equal(checkoutCalls,0);
  };
  assert.deepEqual(await billingNavigation.getByRole('button').allTextContents(),['Forfait','Recharger','Paiements']);
  assert.equal(await billingNavigation.getByRole('button',{name:'Paiements',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await settings.locator('.billing-heading h1').count(),0,'Embedded billing must not render the central-page hero');
  await billingNavigation.getByRole('button',{name:'Forfait',exact:true}).click();await settings.getByRole('button',{name:'Choisir Pro',exact:true}).waitFor();
  for(const name of ['Essentiel','Pro','Business'])assert.equal(await embeddedBilling.getByRole('heading',{name,exact:true}).count(),1);
  assert.equal(await embeddedBilling.getByRole('button',{name:/^Choisir (Essentiel|Pro|Business)$/}).count(),3);
  assert.equal(await embeddedBilling.getByRole('button',{name:'Annuel',exact:true}).isDisabled(),true,'The server closes annual sales in this isolated fixture');
  await embeddedBilling.getByText('Pour 30 jours · hors taxes',{exact:true}).waitFor();
  for(const amount of [4900,9900,24900])assert.equal(await embeddedBilling.getByText(money(amount),{exact:true}).count(),1);
  const planCarousel=embeddedBilling.getByRole('region',{name:'Forfaits disponibles',exact:true});
  const previousPlans=embeddedBilling.getByRole('button',{name:'Forfaits précédents',exact:true}),nextPlans=embeddedBilling.getByRole('button',{name:'Forfaits suivants',exact:true});
  const planLayout=()=>planCarousel.evaluate(element=>{
    const viewport=element.getBoundingClientRect();
    return {width:viewport.width,scroll:element.scrollLeft,cards:Array.from(element.children,card=>{const bounds=card.getBoundingClientRect();return {width:bounds.width,visible:Math.max(0,Math.min(bounds.right,viewport.right)-Math.max(bounds.left,viewport.left))};})};
  });
  const waitForLastPlan=()=>page.waitForFunction(()=>{
    const carousel=document.querySelector('[aria-label="Forfaits disponibles"]'),last=carousel?.lastElementChild;
    if(!carousel||!last)return false;
    const viewport=carousel.getBoundingClientRect(),card=last.getBoundingClientRect();
    return card.left>=viewport.left-1&&card.right<=viewport.right+1;
  });
  const desktopPlans=await planLayout();
  assert.equal(desktopPlans.cards.filter(card=>card.visible>=card.width-1).length,2,'Desktop shows two complete plan cards');
  assert.ok(desktopPlans.cards[2].visible>0&&desktopPlans.cards[2].visible<desktopPlans.cards[2].width,'A sliver of the third plan reveals the horizontal comparison');
  assert.equal(await previousPlans.isDisabled(),true);assert.equal(await nextPlans.isDisabled(),false);
  await capture({path:path.join(output,'billing-offers-desktop.png'),fullPage:true});
  await nextPlans.click();await waitForLastPlan();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="Forfaits suivants"]').disabled);
  assert.equal(await previousPlans.isDisabled(),false);
  await capture({path:path.join(output,'billing-offers-desktop-last.png'),fullPage:true});
  await planCarousel.focus();await planCarousel.press('Home');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Forfaits disponibles"]').scrollLeft<1);
  await planCarousel.press('ArrowRight');await waitForLastPlan();
  await planCarousel.press('Home');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Forfaits disponibles"]').scrollLeft<1);
  await planCarousel.hover();await page.mouse.wheel(400,0);await waitForLastPlan();
  await previousPlans.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Forfaits disponibles"]').scrollLeft<1);
  checks.push('Plan comparison shows two complete desktop cards and a preview of the third; arrows, keyboard and trackpad reveal the last plan without a purchase');
  assert.equal(await embeddedBilling.locator('svg circle[cx="200"][cy="200"][r="150"]').count(),0,'Embedded plan comparison omits the large credits dial');
  assert.equal(quoteRequests.length,0);assert.equal(checkoutCalls,0);
  assert.equal(await settings.getByRole('button',{name:'Choisir Pro',exact:true}).isDisabled(),true,'Unconfigured payment providers must keep plan selection disabled');
  // Enable only the loopback fixture to exercise quote creation. Checkout remains forbidden.
  billingEnabled=true;await settings.getByRole('button',{name:'Actualiser la facturation',exact:true}).click();
  await settings.getByRole('button',{name:'Choisir Pro',exact:true}).click();await settings.getByRole('heading',{name:'Votre récapitulatif',exact:true}).waitFor();
  assert.deepEqual(quoteRequests,[{kind:'subscription',plan:'pro',cycle:'period'}]);assert.equal(checkoutCalls,0,'A quote must never open checkout before an explicit payment confirmation');
  assert.equal(await settings.getByRole('button',{name:'Accepter le total et continuer vers le paiement',exact:true}).isDisabled(),true,'The launch gate stays enforced in embedded billing');
  await assertQuoteTax(9900);await capture({path:path.join(output,'billing-tax-review-desktop.png'),fullPage:true});
  await settings.getByRole('button',{name:'Revenir',exact:true}).click();await billingNavigation.getByRole('button',{name:'Recharger',exact:true}).click();
  assert.equal(await embeddedBilling.getByRole('button',{name:/crédits/}).count(),3,'Only the three catalogue recharge packs are available');
  assert.equal(await embeddedBilling.getByRole('spinbutton').count(),0,'Custom recharge quantities must not be offered');
  assert.equal(await embeddedBilling.getByText('Autre quantité',{exact:true}).count(),0);
  const pack125=embeddedBilling.getByRole('button',{name:/125 crédits/});assert.equal(await pack125.getAttribute('aria-pressed'),'true');assert.ok((await pack125.innerText()).includes(money(5000)));
  await embeddedBilling.getByRole('button',{name:'Vérifier le récapitulatif',exact:true}).click();await assertQuoteTax(5000);
  assert.deepEqual(quoteRequests.at(-1),{kind:'topup',quantity:125});
  checks.push('Three 30-day offers and three packs expose no annual or custom sales; exact server subtotal, tax and total precede approval');
  billingEnabled=false;await settings.getByRole('button',{name:'Revenir',exact:true}).click();await billingNavigation.getByRole('button',{name:'Paiements',exact:true}).click();await settings.getByRole('button',{name:'Actualiser la facturation',exact:true}).click();await settings.getByText('Paiements indisponibles',{exact:true}).waitFor();
  await capture({path:path.join(output,'design-billing-desktop.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await settings.getByRole('button',{name:'Fermer les paramètres',exact:true}).click();await settings.waitFor({state:'hidden'});await composer.waitFor();
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:'Changer d’espace',exact:true}).click();await settings.waitFor();await settings.getByRole('heading',{name:'Équipe et budgets',exact:true}).waitFor();
  await settings.getByRole('heading',{name:'Membres de l’organisation',exact:true}).waitFor();await settings.getByText('Lecteur de test',{exact:true}).waitFor();await settings.getByText('Propriétaire',{exact:true}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'Créer l’invitation',exact:true}).isDisabled(),true);assert.equal(organizationMutations.length,0);
  await capture({path:path.join(output,'design-settings-team-desktop.png'),fullPage:true});
  await settings.getByRole('button',{name:'Fermer les paramètres',exact:true}).click();await settings.waitFor({state:'hidden'});await composer.waitFor();
  checks.push('The account workspace action opens team settings with actual members and roles without inviting or changing budgets');
  for(const legacy of ['/?view=billing','/pricing']){
    await page.goto(origin+legacy);await settings.waitFor();await settings.getByRole('heading',{name:'Facturation',exact:true}).waitFor();
    assert.equal(await billingNavigation.getByRole('button',{name:'Paiements',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.locator('.view-content .billing-page').count(),0);assert.equal(checkoutCalls,0);
    await settings.getByRole('button',{name:'Fermer les paramètres',exact:true}).click();await settings.waitFor({state:'hidden'});await composer.waitFor();
  }
  const beforeReturn={quotes:quoteRequests.length,checkout:checkoutCalls,authorizations:authorizationRequests.length,revocations:revocationRequests.length};
  await page.goto(origin+'/?billingOrder=fixture-return-order');await settings.waitFor();await settings.getByText('Paiement enregistré : Paiement attendu.',{exact:true}).waitFor();
  assert.ok(orderVerificationRequests.some(request=>request.id==='fixture-return-order'&&request.verify==='true'));
  assert.deepEqual({quotes:quoteRequests.length,checkout:checkoutCalls,authorizations:authorizationRequests.length,revocations:revocationRequests.length},beforeReturn);
  checks.push('Billing lives inside settings; legacy URLs and payment returns open the dialog and only verify the existing order');
  checks.push('Embedded billing preserves quote and launch guards; no checkout or payment is triggered by navigation');
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  for(const legacy of ['/?view=billing','/pricing']){
    await page.goto(origin+legacy);await settings.waitFor();await settings.getByRole('heading',{name:'Facturation',exact:true}).waitFor();
    const activeBillingTab=settings.locator('.settings-navigation').getByRole('button',{name:'Facturation',exact:true});
    await page.waitForFunction(()=>document.activeElement?.matches('.settings-navigation button[aria-pressed="true"]')&&document.activeElement.textContent.trim()==='Facturation');
    assert.equal(await activeBillingTab.evaluate(element=>element===document.activeElement),true);
    const tabBounds=await activeBillingTab.boundingBox(),navBounds=await settings.locator('.settings-navigation').boundingBox();
    assert.ok(tabBounds.x>=navBounds.x&&tabBounds.x+tabBounds.width<=navBounds.x+navBounds.width,'The active billing tab must remain fully visible in the mobile navigation scrollport');
    assert.ok(tabBounds.y>=navBounds.y&&tabBounds.y+tabBounds.height<=navBounds.y+navBounds.height);
  }
  checks.push('Mobile billing deep links focus the active section and reveal it within the navigation scrollport');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  const mobileRefresh=await settings.getByRole('button',{name:'Actualiser la facturation',exact:true}).boundingBox();assert.ok(mobileRefresh.x+mobileRefresh.width<=390);
  assert.ok(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await billingNavigation.getByRole('button',{name:'Forfait',exact:true}).click();
  for(const name of ['Essentiel','Pro','Business'])assert.equal(await embeddedBilling.getByRole('heading',{name,exact:true}).count(),1);
  const mobilePlans=await planLayout();
  assert.equal(mobilePlans.cards.filter(card=>card.visible>=card.width-1).length,1,'Mobile shows one complete plan card');
  assert.ok(mobilePlans.cards[1].visible>0&&mobilePlans.cards[1].visible<mobilePlans.cards[1].width);
  assert.ok(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await capture({path:path.join(output,'design-billing-mobile.png'),fullPage:true});
  await planCarousel.focus();await planCarousel.press('End');await waitForLastPlan();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="Forfaits suivants"]').disabled);
  assert.equal(await nextPlans.isDisabled(),true);
  await capture({path:path.join(output,'billing-offers-mobile-last.png'),fullPage:true});
  await planCarousel.press('Home');await page.waitForFunction(()=>document.querySelector('[aria-label="Forfaits disponibles"]').scrollLeft<1);
  assert.equal(checkoutCalls,0);
  checks.push('Mobile plan comparison stays inside settings, reveals every offer and respects reduced motion');
  billingEnabled=true;await settings.getByRole('button',{name:'Actualiser la facturation',exact:true}).click();await billingNavigation.getByRole('button',{name:'Recharger',exact:true}).click();
  await embeddedBilling.getByRole('button',{name:/125 crédits/}).click();await embeddedBilling.getByRole('button',{name:'Vérifier le récapitulatif',exact:true}).click();await assertQuoteTax(5000);
  assert.ok(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await capture({path:path.join(output,'billing-tax-review-mobile.png'),fullPage:true});billingEnabled=false;
  checks.push('Mobile pricing and tax review remain contained, with server totals and checkout disabled for ineligible quotes');
  await page.goto(origin);await composer.waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await capture({path:path.join(output,'design-home-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Ouvrir la navigation',exact:true}).click();await page.locator('.sidebar.mobile-open').waitFor();
  await page.locator('.account-trigger').click();await assertAccountMenuVisible();await capture({path:path.join(output,'design-account-menu-mobile.png'),fullPage:true});await page.locator('.account-trigger').click();
  checks.push('Account menu remains fully visible with expanded, collapsed and mobile navigation');
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:'Paramètres',exact:true}).click();await settings.waitFor();
  await settings.locator('.settings-navigation').getByRole('button',{name:'Connecteurs',exact:true}).click();await settings.getByRole('button',{name:'Activer Meta Ads',exact:true}).waitFor();
  assert.equal(await settings.locator('.settings-navigation').evaluate(element=>getComputedStyle(element).flexDirection),'row');
  assert.ok(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await capture({path:path.join(output,'design-settings-mobile.png'),fullPage:true});
  await settings.locator('.settings-navigation').getByRole('button',{name:'Général',exact:true}).click();await settings.getByText('fixture@example.test',{exact:true}).waitFor();
  assert.ok(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth));
  await capture({path:path.join(output,'design-settings-general-mobile.png'),fullPage:true});
  await settings.locator('.settings-navigation').getByRole('button',{name:'Connecteurs',exact:true}).click();await settings.getByRole('button',{name:'Activer Meta Ads',exact:true}).waitFor();
  await settings.getByRole('button',{name:'Activer Meta Ads',exact:true}).click();await metaDetail.waitFor();
  assert.ok(await metaDetail.evaluate(element=>element.scrollWidth<=element.clientWidth));
  const detailBounds=await metaDetail.boundingBox();assert.ok(detailBounds.x>=0&&detailBounds.x+detailBounds.width<=390);
  await capture({path:path.join(output,'design-connector-detail-mobile.png'),fullPage:true});
  await page.keyboard.press('Escape');await metaDetail.waitFor({state:'hidden'});assert.equal(await settings.isVisible(),true);
  await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
  await page.setViewportSize({width:1280,height:800});await page.emulateMedia({reducedMotion:'no-preference'});
  const initialDraftRestored=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/drafts'&&response.request().method()==='GET');
  await page.goto(origin);await initialDraftRestored;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await composer.fill('Bonjour');
  checks.push('Design system: shared tokens, desktop/mobile settings, catalog, billing and 72px rail');
  checks.push('Composer grows only vertically, caps at 192px and scrolls internally');
  const composerBeforeSend=await page.locator('.composer').boundingBox();
  await page.getByRole('textbox',{name:'Votre demande à Braand'}).press('Enter');
  await page.locator('.welcome-symbol .braand-avatar[data-state="working"]').waitFor();
  assert.equal(await page.locator('.chat-connect-status,.composer-wrap [data-slot=ai-status]').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/Préparation de la réponse|Connexion au modèle/);
  assert.equal(await page.locator('.content-area > .sr-only[role=status]').textContent(),'Réponse en cours');
  assert.equal(Math.round((await page.locator('.composer').boundingBox()).height),Math.round(composerBeforeSend.height),'Waiting must preserve the compact composer dimensions');
  await capture({path:path.join(output,'quiet-wait-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.locator('.chat-connect-status,.composer-wrap [data-slot=ai-status]').count(),0);
  await page.getByRole('button',{name:'Arrêter la réponse',exact:true}).waitFor();
  await capture({path:path.join(output,'quiet-wait-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});await page.emulateMedia({reducedMotion:'no-preference'});
  firstChatHeaders.resolve();
  checks.push('Pending chat headers preserve composer dimensions and show only the working clover, an accessible waiting announcement and stop control on desktop/mobile');
  await page.locator('[data-slot=ai-status][data-state=analyzing]').waitFor();
  await page.locator('[data-slot=ai-status][data-state=writing]').waitFor();
  assert.equal(await page.locator('[data-slot=ai-status][data-state=thinking]').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/Préparation de la réponse|Connexion au modèle/);
  assert.equal(await page.locator('.message.assistant .braand-avatar[data-state="working"]').count(),1);
  await page.locator('.message.assistant canvas[data-bot-avatar="clover"][data-state="working"]').waitFor();
  await capture({path:path.join(output,'desktop-writing.png'),fullPage:true});
  assert.equal(await page.locator('[data-slot=ai-status][data-state=done]').count(),0);
  assert.equal(await page.locator('[data-slot=streaming-response][data-state=streaming]').getByRole('button').count(),0);
  const summaryReadsBeforeRun=summaryReads;
  const settledWalletSummary=page.waitForResponse(async response=>new URL(response.url()).pathname==='/api/billing/summary'&&response.request().method()==='GET'&&(await response.json()).wallet.available===195);
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:'Paramètres',exact:true}).click();await settings.waitFor();
  await settings.getByText('200 crédits',{exact:true}).waitFor();
  await settings.getByText('195 crédits',{exact:true}).waitFor();
  await settledWalletSummary;
  assert.ok(summaryReads>=summaryReadsBeforeRun+2,'An open wallet must re-read its summary after the chat run settles');
  assert.equal(await settings.getByText('200 crédits',{exact:true}).count(),0,'The old wallet amount must not survive settlement');
  await settings.getByRole('button',{name:'Fermer les paramètres',exact:true}).click();await settings.waitFor({state:'hidden'});
  checks.push('An open settings wallet refreshes its real balance when a conversation run settles');
  await page.locator('[data-slot=ai-status][data-state=done]').waitFor();
  await page.locator('.message.assistant canvas[data-bot-avatar="clover"][data-state="default"]').first().waitFor();
  assert.equal(await page.locator('.braand-avatar[data-state="working"]').count(),0);
  checks.push('Clover avatar works during the current response and returns to its resting state after completion');
  assert.equal(chatCalls,1);checks.push('Chat: real stream states, one request, completion only after done');
  const response=page.locator('[data-slot=streaming-response]').first();
  await response.getByRole('button',{name:'Copier la réponse',exact:true}).click();
  await response.getByRole('button',{name:'Réponse copiée',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__copied),['Résultat de test conservé.']);
  await page.evaluate(()=>{window.__copyFail=true;});
  await response.getByRole('button',{name:'Réponse copiée',exact:true}).click();
  await response.getByText('Copie impossible. Sélectionnez le texte pour le copier.',{exact:true}).waitFor();
  assert.equal(await response.getByRole('button',{name:'Réponse copiée',exact:true}).count(),0);
  await page.evaluate(()=>{window.__copyFail=false;});
  checks.push('Copy confirms only successful clipboard writes and handles denied access');
  await response.getByRole('button',{name:'2 sources',exact:true}).click();
  const sourceLink=response.getByRole('link',{name:/Rapport de test/});
  assert.equal(await sourceLink.getAttribute('href'),'https://example.org/report');
  assert.equal(await sourceLink.getAttribute('rel'),'noopener noreferrer');
  assert.equal(await response.getByRole('link').count(),1);
  assert.ok((await response.innerText()).includes('<script>source non exécutable</script>'));
  await response.getByRole('button',{name:'2 sources',exact:true}).press('Enter');
  await sourceLink.waitFor({state:'hidden'});assert.equal(await sourceLink.isVisible(),false);
  checks.push('Sources are escaped, unsafe URLs cannot link, disclosure is keyboard controlled');
  const useful=response.getByRole('button',{name:'Réponse utile',exact:true});
  await useful.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Réponse utile"]').getAttribute('aria-pressed')==='true');
  assert.equal(votes.get('assistant-1'),'up');
  await useful.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Réponse utile"]').getAttribute('aria-pressed')==='false');
  assert.equal(votes.get('assistant-1'),null);
  failFeedback=true;await useful.click();await response.getByText('Avis non enregistré. Réessayez.',{exact:true}).waitFor();
  assert.equal(await useful.getAttribute('aria-pressed'),'false');assert.equal(votes.get('assistant-1'),null);
  await useful.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Réponse utile"]').getAttribute('aria-pressed')==='true');
  assert.equal(feedbackCalls,4);checks.push('Votes persist by message, toggle back to null, and retain prior value on API failure');
  await page.getByRole('textbox',{name:'Votre demande à Braand'}).fill('Mon brouillon');
  await response.getByRole('button',{name:'Reprendre la demande',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Votre demande à Braand'}).inputValue(),'Mon brouillon\n\nBonjour');assert.equal(chatCalls,1);
  checks.push('Resume preserves draft and prepares request without executing a new model/tool call');
  await page.reload();
  await page.getByRole('button',{name:'Rechercher',exact:true}).click();
  await page.getByRole('textbox',{name:'Rechercher dans votre espace'}).fill(conversation.title);
  await page.locator('.search-results button').filter({hasText:conversation.title}).click();
  await response.getByRole('button',{name:'Réponse utile',exact:true}).waitFor();
  assert.equal(await response.getByRole('button',{name:'Réponse utile',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await response.getByRole('button',{name:'2 sources',exact:true}).count(),1);
  checks.push('History reload restores real completion status, persisted feedback and citations');
  await page.getByRole('button',{name:'Rechercher',exact:true}).click();await page.getByRole('textbox',{name:'Rechercher dans votre espace'}).fill(proposal.title);await page.locator('.search-results button').filter({hasText:proposal.title}).click();
  const sidePanel=page.getByRole('complementary',{name:'Espace de travail',exact:true});await sidePanel.getByRole('heading',{name:proposal.title,exact:true}).waitFor();
  await composer.fill('Brouillon avec ressource ouverte');const messageCountBeforeSettings=await page.locator('.messages article').count(),scrollBeforeSettings=await page.locator('.messages').evaluate(element=>element.scrollTop);
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:/Crédits et facturation/}).click();await settings.waitFor();await settings.getByRole('heading',{name:'Facturation',exact:true}).waitFor();
  await settings.getByRole('button',{name:'Fermer les paramètres',exact:true}).click();await settings.waitFor({state:'hidden'});
  assert.equal(await composer.inputValue(),'Brouillon avec ressource ouverte');assert.equal(await page.locator('.messages article').count(),messageCountBeforeSettings);assert.equal(await page.locator('.messages').evaluate(element=>element.scrollTop),scrollBeforeSettings);
  await sidePanel.getByRole('heading',{name:proposal.title,exact:true}).waitFor();assert.equal(approvals,0);assert.equal(checkoutCalls,0);
  checks.push('Billing settings preserve the current messages, composer draft, conversation scroll and open resource panel');
  await page.getByRole('textbox',{name:'Votre demande à Braand'}).fill('Coupure réseau');await page.getByRole('textbox',{name:'Votre demande à Braand'}).press('Enter');
  await page.locator('[data-slot=ai-status][data-state=error]').waitFor();
  assert.ok((await page.locator('.messages').innerText()).includes('Résultat de test conservé.'));checks.push('Interrupted stream keeps received text and never claims success');
  await page.getByRole('textbox',{name:'Votre demande à Braand'}).fill('Arrêt utilisateur');await page.getByRole('textbox',{name:'Votre demande à Braand'}).press('Enter');
  await page.locator('[data-slot=ai-status][data-state=writing]').waitFor();
  const stopReceipt=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chat'&&response.request().method()==='DELETE');
  await page.getByRole('button',{name:'Arrêter la réponse',exact:true}).click();
  assert.equal((await stopReceipt).status(),200);
  await page.locator('[data-slot=ai-status][data-state=cancelled]').waitFor();assert.equal(stops,1);checks.push('Stop remains distinct from failure and cancels the existing run');
  assert.equal(await page.locator('.braand-avatar[data-state="working"]').count(),0);
  await page.getByRole('button',{name:'Rechercher',exact:true}).click();
  await page.getByRole('textbox',{name:'Rechercher dans votre espace'}).fill(proposal.title);
  await page.locator('.search-results button').filter({hasText:proposal.title}).click();
  await page.getByRole('button',{name:'Approuver et générer'}).evaluate(button=>{button.click();button.click();});
  await page.locator('[data-slot=grid-reveal][data-state=pending]').waitFor();
  await capture({path:path.join(output,'desktop-grid-pending.png'),fullPage:true});
  await page.locator('[data-slot=grid-reveal][data-state=error]').waitFor({timeout:12000});assert.equal(approvals,1);
  await page.getByRole('button',{name:'Réessayer',exact:true}).click();
  await page.locator('[data-slot=grid-reveal][data-state=ready]').waitFor({timeout:12000}).catch(async()=>{
    // The settled grid is intentionally replaced by the native result image.
    await page.locator('.media-output img').waitFor({state:'visible'});
  });
  await page.locator('.media-output img').waitFor({state:'visible'});assert.equal(approvals,1);assert.ok(polls>=2);
  checks.push('One approved generation: pending grid, read-only follow-up, actual image reveal');
  assert.ok(imageRequests>=2);assert.equal(approvals,1);checks.push('Failed image load retries only the image, never the paid generation');
  await capture({path:path.join(output,'desktop.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('complementary',{name:'Espace de travail'}).getByRole('button',{name:'Fermer l’espace de travail',exact:true}).click();
  await page.getByRole('textbox',{name:'Votre demande à Braand'}).fill('Mobile');await page.getByRole('textbox',{name:'Votre demande à Braand'}).press('Enter');
  await page.locator('[data-slot=ai-status][data-active]').waitFor();
  await page.waitForFunction(()=>{const path=document.querySelector('[data-slot=ai-status][data-active] .ai-status-icon svg path');return path&&getComputedStyle(path).animationName==='none';});
  await page.locator('[data-slot=ai-status][data-state=done]').waitFor();
  assert.equal(await page.locator('.response-footer').last().evaluate(element=>getComputedStyle(element).animationName),'none');
  assert.ok(await page.locator('.response-action').last().evaluate(element=>element.getBoundingClientRect().height>=44));
  await capture({path:path.join(output,'mobile-reduced-motion.png'),fullPage:true});checks.push('Mobile: no horizontal overflow; reduced-motion animation disabled');
  const modelCallsBeforeDashboard=chatCalls;
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(origin+'/?view=analytics');await page.getByRole('heading',{name:'Tableau de bord',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Reliez vos campagnes à vos décisions',exact:true}).waitFor();
  analyticsConnected=true;await page.reload();
  const dashboardMetrics=page.getByRole('region',{name:'Indicateurs de performance',exact:true});await dashboardMetrics.waitFor();
  assert.equal(await page.getByLabel('Compte publicitaire',{exact:true}).inputValue(),DEMO_AD_ACCOUNT.id,'The account selection matches the displayed data');
  assert.equal(await dashboardMetrics.locator(':scope > div').count(),6);
  assert.ok((await dashboardMetrics.innerText()).includes('38'));assert.ok((await dashboardMetrics.innerText()).includes('2,39'));
  const evolution=page.getByRole('region',{name:'Évolution quotidienne',exact:true});await evolution.getByRole('img').waitFor();
  await page.getByLabel('Indicateur du graphique',{exact:true}).selectOption('spend');assert.match(await evolution.getByRole('img').getAttribute('aria-labelledby'),/title/);
  const slider=page.getByRole('slider',{name:'Jour à consulter',exact:true});await slider.focus();await slider.press('Home');assert.match(await slider.getAttribute('aria-valuetext'),/Dépenses/);
  await page.getByRole('button',{name:'7 jours',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="Jour à consulter"]')?.max==='6');
  await page.getByRole('button',{name:'90 jours',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="Jour à consulter"]')?.max==='89');
  await page.getByRole('button',{name:'30 jours',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="Jour à consulter"]')?.max==='29');
  await capture({path:path.join(output,'dashboard-desktop.png'),fullPage:true});
  const campaignTable=page.getByRole('region',{name:'Comparaison des campagnes',exact:true});
  await page.getByRole('textbox',{name:'Rechercher une campagne',exact:true}).fill('hibiscus');assert.equal(await campaignTable.locator('tbody tr').count(),1);
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter CSV',exact:true}).click();const csv=await exported;const csvPath=path.join(output,'dashboard-campaigns.csv');await csv.saveAs(csvPath);assert.match(await readFile(csvPath,'utf8'),/Infusion hibiscus/);assert.ok(!(await readFile(csvPath,'utf8')).includes('Coffret cacao'));
  await page.getByRole('textbox',{name:'Rechercher une campagne',exact:true}).fill('');await campaignTable.getByRole('button',{name:'Clics',exact:true}).click();assert.equal(await campaignTable.locator('thead th[aria-sort="descending"]').innerText(),'Clics');
  await campaignTable.getByRole('button',{name:'Coffret cacao · découverte',exact:true}).click();await page.getByRole('button',{name:'Analyser cette campagne',exact:true}).click();
  await composer.waitFor();assert.match(await composer.inputValue(),/Données observées/);assert.match(await composer.inputValue(),/Coffret cacao/);assert.equal(chatCalls,modelCallsBeforeDashboard,'Dashboard analysis prepares a draft and never runs a model automatically');
  checks.push('Dashboard keeps its name, matches the active account, compares six real metrics, switches chart periods and exports the filtered campaigns safely');
  await page.goto(origin+'/?view=analytics');await dashboardMetrics.waitFor();
  await page.getByLabel('Compte publicitaire',{exact:true}).selectOption('act_other_fixture');await dashboardMetrics.waitFor();await page.waitForFunction(()=>document.querySelector('select[id] option:checked')?.textContent.includes('Autre compte'));
  analyticsMode='race';await page.getByRole('button',{name:'7 jours',exact:true}).click();await page.getByRole('button',{name:'90 jours',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[aria-label="Jour à consulter"]')?.max==='89');await page.waitForTimeout(400);assert.equal(await slider.getAttribute('max'),'89');
  analyticsMode='missing';await page.getByRole('button',{name:'Actualiser le tableau de bord',exact:true}).click();await page.getByText('L’évolution quotidienne n’est pas disponible pour ce compte et cette période. Les totaux restent consultables.',{exact:true}).waitFor();assert.equal(await evolution.getByRole('img').count(),0);await dashboardMetrics.waitFor();
  analyticsMode='partial';await page.getByRole('button',{name:'Actualiser le tableau de bord',exact:true}).click();await page.getByText(/Données partielles : certaines campagnes/).waitFor();assert.equal(await dashboardMetrics.getByText('Comparaison indisponible',{exact:true}).count(),6);
  analyticsMode='failure';await page.getByRole('button',{name:'Actualiser le tableau de bord',exact:true}).click();await page.getByRole('alert').getByText('Lecture publicitaire indisponible',{exact:true}).waitFor();assert.equal(await dashboardMetrics.count(),0);
  analyticsMode='full';await page.getByRole('button',{name:'Réessayer',exact:true}).click();await dashboardMetrics.waitFor();
  await page.setViewportSize({width:390,height:844});await capture({path:path.join(output,'dashboard-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:970,height:686});await capture({path:path.join(output,'dashboard-medium.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(analyticsReads.every(read=>read.method==='GET'));assert.equal(chatCalls,modelCallsBeforeDashboard);checks.push('Dashboard handles stale requests, missing daily series, partial reports, read failures, recovery and mobile layout without inventing conversions or running paid actions');
  const campaignAsset={...media,id:'campaign-asset',title:'Visuel associé au plan',data:{output:{images:[{url:origin+'/fixture.png',width:512,height:512}]}}};
  const campaignPage={...conversation,id:'campaign-page',kind:'page',title:'Page associée au plan',status:'draft',data:{}};
  const campaignPlan={...conversation,id:'campaign-plan',kind:'campaign',title:'Plan de campagne complet',status:'draft',data:{objective:'leads',offer:'Offre de test',audience:'Public de test',country:'Cameroun',currency:'XAF',dailyBudget:1000,destination:'',message:'Message exact du plan',tracking:'Événement à contrôler',creativeIds:[campaignAsset.id],pageId:campaignPage.id}};
  const missingPlan={...campaignPlan,id:'campaign-missing',title:'Plan à compléter',data:{...campaignPlan.data,audience:'',offer:'',creativeIds:[],pageId:''}};
  workspaceResources.push(campaignAsset,campaignPage,campaignPlan,missingPlan);
  const callsBeforeCampaigns=chatCalls,approvalsBeforeCampaigns=approvals;
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/?view=campaigns');await page.getByRole('heading',{name:'Campagnes',exact:true}).waitFor();
  const campaignList=page.getByRole('region',{name:'Plans de campagne',exact:true});await campaignList.waitFor();assert.equal(await campaignList.getByRole('article').count(),2);
  const preparationNav=page.getByRole('navigation',{name:'État de préparation',exact:true});await preparationNav.getByRole('button',{name:/À compléter/}).click();assert.equal(await campaignList.getByRole('article').count(),1);await preparationNav.getByRole('button',{name:/Tous les plans/}).click();
  await page.getByRole('textbox',{name:'Rechercher un plan de campagne',exact:true}).fill('complet');assert.equal(await campaignList.getByRole('article').count(),1);await page.getByRole('textbox',{name:'Rechercher un plan de campagne',exact:true}).fill('');
  await capture({path:path.join(output,'campaigns-overview-desktop.png'),fullPage:true});
  await campaignList.getByRole('article').filter({hasText:'Plan de campagne complet'}).getByRole('button',{name:'Ouvrir l’atelier',exact:true}).click();
  const workshop=page.getByRole('region',{name:'Atelier de campagne',exact:true});await workshop.waitFor();await workshop.getByText(/9\/9 éléments renseignés/).waitFor();await workshop.getByText('Publication non vérifiée',{exact:true}).waitFor();
  const stages=workshop.getByRole('list',{name:'Étapes de préparation',exact:true});assert.equal(await stages.getByRole('listitem').count(),4);assert.match(await stages.innerText(),/Destination\s+À vérifier/);assert.match(await stages.innerText(),/Validation\s+Accord requis/);await workshop.getByText(/Contrôles détaillés/).click();assert.equal(await workshop.locator('li[data-state]').count(),9);await workshop.getByText(/Contrôles détaillés/).click();
  assert.equal(await workshop.getByRole('button',{name:'Visuel associé au plan',exact:true}).count(),1);assert.equal(await workshop.getByRole('button',{name:'Page associée au plan',exact:true}).count(),1);
  await capture({path:path.join(output,'campaigns-workshop-desktop.png'),fullPage:true});
  await workshop.getByRole('button',{name:'Tous les plans',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='campaign-open-campaign-plan');await campaignList.getByRole('article').filter({hasText:'Plan de campagne complet'}).getByRole('button',{name:'Ouvrir l’atelier',exact:true}).click();await workshop.waitFor();
  await workshop.getByRole('button',{name:'Modifier le brief',exact:true}).click();
  const campaignEditor=page.getByRole('form',{name:'Modifier le brief de campagne',exact:true});await campaignEditor.waitFor();
  await campaignEditor.getByLabel('Nom du plan',{exact:true}).fill('Plan affiné et enregistré');await campaignEditor.getByLabel('Public visé',{exact:true}).fill('Public modifié sans perte de focus');
  assert.equal(await campaignEditor.getByLabel('Public visé',{exact:true}).evaluate(element=>document.activeElement===element),true);
  await campaignEditor.getByLabel('Budget publicitaire journalier',{exact:true}).fill('1200');
  await campaignEditor.getByRole('button',{name:'Enregistrer le brief',exact:true}).evaluate(button=>{button.click();button.click();});await campaignEditor.waitFor({state:'hidden'});await workshop.getByRole('heading',{name:'Plan affiné et enregistré',exact:true}).waitFor();assert.equal(campaignWrites.length,1);assert.equal(campaignWrites[0].version,1);assert.equal(campaignWrites[0].brief.dailyBudget,1200);
  const briefDownload=page.waitForEvent('download');await workshop.getByRole('button',{name:'Exporter le brief',exact:true}).click();const briefFile=await briefDownload,briefPath=path.join(output,'campaign-brief.md');await briefFile.saveAs(briefPath);assert.match(await readFile(briefPath,'utf8'),/Public modifié sans perte de focus/);
  await workshop.getByRole('button',{name:'Modifier le brief',exact:true}).click();await campaignEditor.getByLabel('Offre',{exact:true}).fill('Saisie conservée après échec');failCampaignSave=true;
  await campaignEditor.getByRole('button',{name:'Enregistrer le brief',exact:true}).click();await campaignEditor.getByRole('alert').getByText('Échec local de l’enregistrement',{exact:true}).waitFor();assert.equal(await campaignEditor.getByLabel('Offre',{exact:true}).inputValue(),'Saisie conservée après échec');
  await campaignEditor.getByRole('button',{name:'Enregistrer le brief',exact:true}).click();await campaignEditor.waitFor({state:'hidden'});assert.equal(campaignWrites.length,3);
  await workshop.getByRole('button',{name:'Modifier le brief',exact:true}).click();
  const currentCampaignIndex=workspaceResources.findIndex(resource=>resource.id==='campaign-plan');workspaceResources[currentCampaignIndex]={...workspaceResources[currentCampaignIndex],version:4,data:{...workspaceResources[currentCampaignIndex].data,offer:'Offre de la version externe'}};
  await campaignEditor.getByLabel('Offre',{exact:true}).fill('Ma saisie en conflit');await campaignEditor.getByRole('button',{name:'Enregistrer le brief',exact:true}).click();await campaignEditor.getByRole('alert').getByText('La version a changé. Actualisez avant de continuer.',{exact:true}).waitFor();assert.equal(await campaignEditor.getByLabel('Offre',{exact:true}).inputValue(),'Ma saisie en conflit');
  await campaignEditor.getByRole('button',{name:'Recharger le plan et remplacer ma saisie',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea[name="offer"]')?.value==='Offre de la version externe');assert.equal(await campaignEditor.getByRole('button',{name:'Enregistrer le brief',exact:true}).isDisabled(),false);await campaignEditor.getByRole('button',{name:'Annuler',exact:true}).click();
  await workshop.getByText('Autres actions',{exact:true}).click();await workshop.getByRole('button',{name:'Préparer un test créatif',exact:true}).click();await composer.waitFor();assert.match(await composer.inputValue(),/une seule variable/);assert.match(await composer.inputValue(),/Plan affiné et enregistré/);assert.equal(chatCalls,callsBeforeCampaigns);assert.equal(approvals,approvalsBeforeCampaigns);
  checks.push('Campaign workshop binds actual resources, saves versioned draft briefs once, preserves failed edits, recovers conflicts and exports the saved plan without an ad launch');
  workspaceRole='reader';await page.goto(origin+'/?view=campaigns');await campaignList.waitFor();await campaignList.getByRole('article').filter({hasText:'Plan affiné et enregistré'}).getByRole('button',{name:'Ouvrir l’atelier',exact:true}).click();await workshop.getByRole('button',{name:'Modifier le brief',exact:true}).click();await campaignEditor.waitFor();assert.equal(await campaignEditor.getByRole('button',{name:'Enregistrer le brief',exact:true}).isDisabled(),true);await campaignEditor.getByRole('button',{name:'Annuler',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await capture({path:path.join(output,'campaigns-workshop-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await workshop.getByRole('button',{name:'Tous les plans',exact:true}).click();await capture({path:path.join(output,'campaigns-overview-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(campaignWrites.length,4);checks.push('Campaign search, preparation filters, keyboard focus, reader permissions and mobile workshop stay usable without inventing live delivery or verified tracking');
  workspaceRole='owner';await page.setViewportSize({width:1280,height:800});const markdownDraftRestored=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/drafts'&&response.request().method()==='GET');await page.goto(origin);await markdownDraftRestored;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await composer.fill('Markdown multilingue');await composer.press('Enter');await page.getByRole('heading',{name:'Résumé',exact:true}).waitFor();await page.locator('[data-slot=ai-status][data-state=done]').waitFor();const markdown=page.locator('.message.assistant .message-text').last();assert.equal(await markdown.locator('ul li').count(),2);assert.match(await markdown.innerText(),/مرحبا/);assert.match(await markdown.innerText(),/世界/);assert.equal(await markdown.locator('pre code').count(),1);assert.equal(await markdown.locator('img').count(),0);await capture({path:path.join(output,'markdown-desktop.png'),fullPage:true});await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:768,height:1024});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await markdown.locator('pre').evaluate(element=>element.scrollWidth<=element.clientWidth));await capture({path:path.join(output,'markdown-tablet.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar')).visibility==='hidden');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await markdown.locator('pre').evaluate(element=>element.scrollWidth<=element.clientWidth));const mobileLayout=await page.evaluate(()=>Object.fromEntries(['.main-area','.topbar','.conversation','.composer','.send-button'].map(selector=>{const element=document.querySelector(selector),rect=element.getBoundingClientRect();return [selector,{x:rect.x,right:rect.right,width:rect.width,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}];})));await writeFile(path.join(output,'markdown-mobile-layout.json'),JSON.stringify(mobileLayout,null,2));for(const [selector,rect] of Object.entries(mobileLayout))assert.ok(rect.x>=0&&rect.right<=391,selector+' leaves the mobile viewport: '+JSON.stringify(rect));await capture({path:path.join(output,'markdown-mobile.png'),fullPage:true});checks.push('Markdown streams and preserves multilingual headings, lists and escaped code on desktop/tablet/mobile without horizontal overflow');
  assert.equal(checkoutCalls,0);assert.equal(organizationMutations.length,0);
  await page.setViewportSize({width:1280,height:800});await page.locator('.new-chat-icon').click();await composer.fill('Discussion A en arrière-plan');await composer.press('Enter');await page.getByText('Texte réservé à la discussion A.',{exact:true}).waitFor();
  const beforeBackground=chatCalls;await page.locator('.new-chat-icon').click();await composer.fill('Brouillon B conservé');await page.getByRole('button',{name:'Consulter la discussion en cours',exact:true}).click();assert.equal(await page.getByText('Texte réservé à la discussion A.',{exact:true}).isVisible(),true);await page.locator('.new-chat-icon').click();
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Votre demande à Braand"]').value==='Brouillon B conservé');await composer.fill('Discussion B indépendante');await composer.press('Enter');await page.getByRole('button',{name:'Arrêter la réponse',exact:true}).waitFor();assert.equal(chatCalls,beforeBackground,'Queued explicit work must respect the single active client request');
  await page.getByRole('button',{name:'Consulter la discussion en cours',exact:true}).click();assert.equal(await page.getByText('Texte réservé à la discussion A.',{exact:true}).isVisible(),true);assert.equal(await page.getByText('Texte réservé à la discussion B.',{exact:true}).count(),0);
  const secondStarted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chat'&&response.request().method()==='POST'&&response.request().postDataJSON().text==='Discussion B indépendante');backgroundCompletion.resolve();await secondStarted;await page.getByRole('button',{name:'Consulter la discussion en cours',exact:true}).click();await page.getByText('Texte réservé à la discussion B.',{exact:true}).waitFor();await page.locator('[data-slot=ai-status][data-state=done]').waitFor();assert.equal(await page.getByText('Texte réservé à la discussion A.',{exact:true}).count(),0);assert.equal(chatCalls,beforeBackground+1);
  checks.push('Live conversation switching preserves partial output and an unsent draft; a second explicit request queues and completes in its own conversation');
  await page.setViewportSize({width:1280,height:800});await page.locator('.new-chat-icon').click();await composer.fill('Sources de démonstration locale');await composer.press('Enter');
  const sourceLinks=page.locator('.message.assistant .artifact-links').last();
  await sourceLinks.getByRole('button').filter({hasText:'sources-fixture.zip'}).waitFor();assert.equal(await sourceLinks.getByRole('button').count(),2);assert.equal(await page.getByRole('button',{name:'Arrêter la réponse',exact:true}).isVisible(),true);
  await page.locator('[data-slot=ai-status][data-state=done]').waitFor();assert.equal(await sourceLinks.getByRole('button').count(),2);assert.equal(await page.getByLabel('Format du document',{exact:true}).count(),0);await capture({path:path.join(output,'native-artifacts-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar')).visibility==='hidden');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture({path:path.join(output,'native-artifacts-mobile.png'),fullPage:true});
  checks.push('Native result and ZIP appear during streaming, duplicate receipts produce no duplicate links, and mobile stays within its viewport');
  // Essentielle and Atelier exercise real routes and protections with isolated fixtures.
  workspaceRole='owner';
  workspaceResources.push({id:'shell-project',workspace_id:'fixture',kind:'project',title:'Un projet réel de la fixture',status:'saved',version:1,created_at:now,updated_at:now,data:{}},...['a','b'].map(id=>({id:'shell-page-'+id,workspace_id:'fixture',kind:'page',title:'Page de contrôle '+id.toUpperCase(),status:'draft',version:1,created_at:now,updated_at:now,data:{}})));
  workspaceResources.push(
   {...conversation,id:'gallery-document',kind:'deliverable',title:'Rapport de la bibliothèque',status:'ready',data:{format:'markdown',summary:'Synthèse réelle enregistrée pour la fixture.'}},
   {...conversation,id:'gallery-pending',kind:'file',title:'Document en validation.pdf',status:'quarantined',data:{mime:'application/pdf',size:1024}},
   {...media,id:'gallery-unsafe',title:'Création sans aperçu fiable',data:{output:{images:[{url:'javascript:alert(1)'}]}}},
   {...conversation,id:'gallery-foreign',workspace_id:'other-workspace',kind:'deliverable',title:'Document d’un autre espace',data:{}}
  );
  await page.setViewportSize({width:1280,height:800});await page.goto(origin+'/?view=library');await page.getByRole('heading',{name:'Bibliothèque',exact:true}).waitFor();
  const library=page.locator('[data-library-gallery]'),libraryFilters=library.getByRole('group',{name:'Contenu de la bibliothèque',exact:true}),libraryItems=library.locator('[data-library-resource]');
  const libraryCalls=chatCalls;
  assert.equal(await library.getByRole('button',{name:'Ouvrir Document d’un autre espace',exact:true}).count(),0);
  assert.equal(await library.getByRole('button',{name:'Ouvrir Document en validation.pdf',exact:true}).isDisabled(),true);
  assert.equal(await library.getByRole('button',{name:'Ouvrir Création sans aperçu fiable',exact:true}).locator('img').count(),0);
  assert.ok(await library.getByRole('button',{name:'Ouvrir Visuel associé au plan',exact:true}).locator('img').count()>0);
  await library.getByRole('button',{name:'Vue liste',exact:true}).click();assert.equal(await library.getByRole('button',{name:'Vue liste',exact:true}).getAttribute('aria-pressed'),'true');
  await library.getByRole('combobox',{name:'Trier la bibliothèque',exact:true}).selectOption('name');const libraryTitles=await libraryItems.locator('button:first-child').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('title')));assert.deepEqual(libraryTitles,[...libraryTitles].sort((a,b)=>a.localeCompare(b,'fr')));
  await library.getByRole('searchbox',{name:'Rechercher dans la bibliothèque',exact:true}).fill('Rapport de la bibliothèque');assert.equal(await libraryItems.count(),1);assert.match(await libraryItems.innerText(),/Livrable/);
  await library.getByRole('searchbox',{name:'Rechercher dans la bibliothèque',exact:true}).fill('aucun-résultat-unique');await library.getByRole('heading',{name:'Aucune correspondance',exact:true}).waitFor();await library.getByRole('button',{name:'Voir toutes les ressources',exact:true}).click();
  await page.evaluate(()=>localStorage.setItem('braand.library.pins:other-user:other-workspace',JSON.stringify(['campaign-asset'])));
  await library.getByRole('button',{name:'Épingler Rapport de la bibliothèque',exact:true}).click();await libraryFilters.getByRole('button',{name:'Épinglés',exact:true}).click();assert.equal(await libraryItems.count(),1);assert.match(await libraryItems.innerText(),/Rapport de la bibliothèque/);
  await page.reload();await library.waitFor();await libraryFilters.getByRole('button',{name:'Épinglés',exact:true}).click();assert.equal(await libraryItems.count(),1);assert.match(await libraryItems.innerText(),/Rapport de la bibliothèque/);assert.equal(await page.evaluate(()=>localStorage.getItem('braand.library.pins:other-user:other-workspace')),'["campaign-asset"]');
  await libraryFilters.getByRole('button',{name:'Tout',exact:true}).click();await library.getByRole('button',{name:'Vue galerie',exact:true}).click();
  await capture({path:path.join(output,'library-gallery-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture({path:path.join(output,'library-gallery-mobile.png'),fullPage:true});await library.getByRole('button',{name:'Vue liste',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture({path:path.join(output,'library-list-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});await library.getByRole('button',{name:'Vue galerie',exact:true}).click();assert.equal(chatCalls,libraryCalls);
  checks.push('Library gallery and list search, sort, filter and retain scoped pins; show only actual previews; reject unsafe images and unavailable files; stay within mobile width without starting a model');

  const primary=page.getByRole('navigation',{name:'Navigation principale',exact:true});
  for(const name of ['Chat','Bibliothèque','Missions','Automatisations'])assert.equal(await primary.getByRole('button',{name,exact:true}).count(),1);
  assert.equal(await primary.getByRole('button',{name:'Connecteurs',exact:true}).count(),0);
  assert.ok(await primary.getByRole('region',{name:'Projets',exact:true}).isVisible());
  assert.ok(await primary.getByRole('region',{name:'Historique des discussions',exact:true}).isVisible());
  await page.getByRole('group',{name:'Contenu de la bibliothèque',exact:true}).getByRole('button',{name:'Pages',exact:true}).click();
  assert.equal(await page.locator('[data-library-resource]').count(),workspaceResources.filter(r=>r.kind==='page').length);
  await primary.getByRole('button',{name:'Plus d’outils',exact:true}).press('ArrowDown');
  const more=page.getByRole('group',{name:'Plus d’outils',exact:true});await more.getByRole('button',{name:'Studio',exact:true}).click();await page.getByRole('heading',{name:'Créations',exact:true}).waitFor();
  await primary.getByRole('button',{name:'Automatisations',exact:true}).click();await page.getByRole('heading',{name:'Automatisations',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('section'),'routines');
  await primary.getByRole('button',{name:'Missions',exact:true}).click();await page.getByRole('heading',{name:'Missions',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.has('section'),false);
  await primary.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('button',{name:'Replier la navigation',exact:true}).click();
  await primary.getByRole('button',{name:'Plus d’outils',exact:true}).press('ArrowDown');await more.waitFor();const moreBounds=await more.boundingBox();assert.ok(moreBounds.x>=0&&moreBounds.x+moreBounds.width<=1280);
  await page.keyboard.press('Escape');assert.equal(await more.count(),0);assert.ok(await primary.getByRole('button',{name:'Plus d’outils',exact:true}).evaluate(e=>e===document.activeElement));
  await page.getByRole('button',{name:'Déployer la navigation',exact:true}).click();await page.waitForFunction(()=>Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)===248);await capture({path:path.join(output,'essential-sidebar-desktop.png'),fullPage:true});
  checks.push('Essentielle separates real projects and discussions, preserves Studio and routines, and keeps Connecteurs in settings');
  await page.getByRole('button',{name:'Ouvrir l’espace de travail',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Espace de travail',exact:true});
  const picker=panel.getByRole('button',{name:'Choisir le contenu de l’espace de travail',exact:true});
  assert.equal(await panel.getByRole('tablist').count(),0);
  await picker.click();await page.getByRole('group',{name:'Choisir le contenu de l’espace de travail',exact:true}).getByRole('button',{name:'Navigateur',exact:true}).click();
  await panel.getByRole('heading',{name:'Activation en attente',exact:true}).waitFor();assert.equal(browserWrites,0);
  await capture({path:path.join(output,'atelier-browser-desktop.png'),fullPage:true});
  await panel.getByRole('button',{name:'Agrandir',exact:true}).click();assert.equal(await page.locator('.main-area').isVisible(),false);
  await picker.press('ArrowDown');await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await panel.count(),0);assert.equal(await page.locator('.main-area').isVisible(),true);await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-workspace-trigger'));
  await primary.getByRole('button',{name:'Bibliothèque',exact:true}).click();await page.getByRole('group',{name:'Contenu de la bibliothèque',exact:true}).getByRole('button',{name:'Pages',exact:true}).click();
  await page.getByRole('button',{name:'Ouvrir Page de contrôle A',exact:true}).click();
  await picker.click();await page.getByRole('group',{name:'Choisir le contenu de l’espace de travail',exact:true}).getByRole('button',{name:'Page de contrôle B',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.page-frame iframe')?.getAttribute('srcdoc')?.includes('Page B'));
  await new Promise(resolve=>setTimeout(resolve,750));assert.ok(await panel.locator('.page-frame iframe').getAttribute('srcdoc').then(value=>value.includes('Page B')&&!value.includes('Page A')));
  await picker.click();await page.getByRole('group',{name:'Choisir le contenu de l’espace de travail',exact:true}).getByRole('button',{name:'Code de la page',exact:true}).click();assert.ok((await panel.locator('.atelier-source code').innerText()).includes('<h1>Page B</h1>'));
  assert.ok(await panel.locator('.atelier-source pre').evaluate(e=>e.scrollWidth<=e.clientWidth));
  await capture({path:path.join(output,'atelier-source-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar')).visibility==='hidden');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await panel.locator('.atelier-source pre').evaluate(e=>e.scrollWidth<=e.clientWidth));await capture({path:path.join(output,'atelier-mobile.png'),fullPage:true});
  await panel.getByRole('button',{name:'Fermer l’espace de travail',exact:true}).click();assert.equal(await page.locator('.main-area').isVisible(),true);
  assert.equal(browserWrites,0);assert.equal(checkoutCalls,0);checks.push('Atelier uses one content selector, handles unavailable navigation honestly, keeps the latest page/source, and restores chat and focus after expanded Escape');

  await page.setViewportSize({width:1280,height:800});await page.locator('.new-chat-icon').click();const liveDraft=page.getByRole('textbox',{name:'Votre demande à Braand'});await liveDraft.fill('Préserver le navigateur');await liveDraft.press('Enter');await page.getByText('Préparation du livrable de la fixture.',{exact:true}).waitFor();await page.getByRole('button',{name:'Ouvrir l’espace de travail',exact:true}).click();await picker.click();await page.getByRole('group',{name:'Choisir le contenu de l’espace de travail',exact:true}).getByRole('button',{name:'Navigateur',exact:true}).click();await panel.getByRole('heading',{name:'Activation en attente',exact:true}).waitFor();deferredDelivery.resolve();await page.locator('.message.assistant .artifact-links button').filter({hasText:'Livrable pendant la navigation'}).waitFor();assert.ok(await panel.getByRole('heading',{name:'Sessions privées',exact:true}).isVisible());assert.equal(await panel.locator('.artifact-heading').count(),0);assert.equal(browserWrites,0);checks.push('A streamed deliverable appears in chat without taking over a manually selected browser context');
  // The reported 774px layout must stay aligned, compact and usable with a real draft.
  await page.setViewportSize({width:1280,height:800});await page.goto(origin);await page.locator('.account-trigger:not(:disabled)').waitFor();
  const callsBeforeLayout=chatCalls;
  const alignedHeader=()=>page.evaluate(()=>{const brand=document.querySelector('.sidebar-brand').getBoundingClientRect(),bar=document.querySelector('.topbar').getBoundingClientRect();return Math.abs(brand.y+brand.height/2-bar.y-bar.height/2)<1;});
  assert.ok(await alignedHeader());assert.equal(Math.round((await page.locator('.chat-nav-row').boundingBox()).y),80);
  assert.equal(await page.locator('.home-shortcuts .platform-quick-start>button').count(),3);
  await page.getByRole('button',{name:'Autres idées',exact:true}).click();const ideas=page.getByRole('group',{name:'Autres idées',exact:true});assert.equal(await ideas.getByRole('button').count(),4);await ideas.getByRole('button',{name:'Créer un visuel',exact:true}).click();assert.match(await composer.inputValue(),/visuel/);assert.equal(chatCalls,callsBeforeLayout);
  await page.setViewportSize({width:774,height:668});await page.waitForFunction(()=>Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)===72);
  assert.ok(await alignedHeader());assert.equal(await page.locator('.brand-expand').count(),1);
  await page.getByRole('button',{name:'Déployer la navigation',exact:true}).click();await page.waitForFunction(()=>Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)===248);
  await composer.fill('Je voudrais créer un visuel pour mon produit.');assert.ok(await alignedHeader());
  assert.ok(await page.locator('.welcome').evaluate(element=>element.scrollHeight<=element.clientHeight+1));
  assert.ok(await page.locator('.home-footer').evaluate(element=>element.getBoundingClientRect().bottom<=innerHeight+1));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const shortcutRows=await page.locator('.home-shortcuts').evaluate(element=>[...element.querySelector('.platform-quick-start').children].map(child=>Math.round(child.getBoundingClientRect().top)));
  assert.equal(shortcutRows[0],shortcutRows[1]);assert.equal(shortcutRows[2],shortcutRows[3]);
  await capture({path:path.join(output,'essential-aligned-tablet.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:800});assert.equal(await page.locator('.app-shell.sidebar-collapsed').count(),0);
  checks.push('Shared header alignment, compact tablet rail, manual expansion and four balanced shortcuts preserve the draft without sending it');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Ouvrir la navigation',exact:true}).click();
  for(const selector of ['.sidebar-icon-button','.new-chat-icon','.sidebar-section-heading .icon-button','.sidebar-nav-item'])for(const target of await page.locator(selector).all()){const box=await target.boundingBox();assert.ok(box.width>=44&&box.height>=44,selector+' is too small for touch');}
  assert.ok(await alignedHeader());await capture({path:path.join(output,'essential-touch-mobile.png'),fullPage:true});
  await page.locator('.nav-scrim').click({position:{x:380,y:100}});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar')).visibility==='hidden');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  anonymousSession=true;await page.setViewportSize({width:1280,height:800});await page.goto(origin);const signIn=page.getByRole('button',{name:'Se connecter à Braand',exact:true});await signIn.waitFor();
  assert.equal(await signIn.getAttribute('aria-haspopup'),'dialog');assert.equal(await signIn.locator('.account-chevron').count(),0);assert.equal(await signIn.locator('strong').innerText(),'Se connecter');
  assert.equal(await page.locator('.sidebar-projects h2').count(),0);await page.getByRole('button',{name:'Ajouter un projet',exact:true}).click();
  const login=page.getByRole('dialog',{name:'Bienvenue chez Braand',exact:true});await login.waitFor();await login.getByRole('button',{name:'Fermer',exact:true}).click();
  await signIn.click();await login.waitFor();await login.getByRole('button',{name:'Fermer',exact:true}).click();assert.ok(await signIn.evaluate(element=>element===document.activeElement));
  assert.equal(authSends,0);assert.equal(chatCalls,callsBeforeLayout);checks.push('Touch controls reach 44px and an empty anonymous space offers project creation and a clear, keyboard-restored sign-in dialog without email or provider calls');
  assert.deepEqual(pageErrors,[]);checks.push('No unhandled browser errors');
  await writeFile(path.join(output,'results.json'),JSON.stringify({checks,chatCalls,approvals,polls,connectorAuthorizationCalls:authorizationRequests.length,connectorRevocationCalls:revocationRequests.length,billingQuoteCalls:quoteRequests.length,billingCheckoutCalls:checkoutCalls,organizationMutationCalls:organizationMutations.length,externalProviderCalls:0},null,2));
  for(const check of checks)console.log('PASS '+check);
}catch(error){if(lastPage){await lastPage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error((await lastPage.locator('body').innerText()).slice(0,1200));}throw error;}
finally{firstChatHeaders.resolve();deferredDelivery.resolve();await browser?.close();await new Promise(resolve=>server.close(resolve));}
