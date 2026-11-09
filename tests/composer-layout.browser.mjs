// Real Studio layout against a read-only local fixture. No model, upload or payment calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const playwright=process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(path.resolve(playwright)).href:require.resolve('playwright'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.tmp','composer-layout-browser');
await mkdir(output,{recursive:true});
await build({external:['/fonts/*'],stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Studio from "./app/studio";import {FilePreviewProvider} from "./components/file-preview/file-preview-provider";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/file-upload.css";import "./components/file-preview/file-preview.css";createRoot(document.getElementById("root")).render(<FilePreviewProvider><Studio/></FilePreviewProvider>);',resolveDir:root,loader:'tsx'},outdir:output,entryNames:'app',chunkNames:'chunks/[name]-[hash]',alias:{'next/image':'vinext/shims/image'},bundle:true,splitting:true,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'fixture-worker-url',setup(builder){builder.onResolve({filter:/^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/},()=>({path:'worker',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default "/unused-pdf-worker.mjs";',loader:'js'}));}}]});

const now=Date.now();
const conversation={id:'composer-fixture-conversation',workspace_id:'composer-fixture',kind:'conversation',title:'Discussion locale existante',status:'saved',version:1,created_at:now,updated_at:now,data:{}};
const paragraphs=[
  'Je voudrais créer un visuel pour mon produit.',
  'Aide-moi à créer une vidéo publicitaire.',
  'Je voudrais créer une page de destination pour mon offre.',
  'Aide-moi à trouver des clients sur Facebook et Instagram.',
].join('\n\n');
const mutations=[],historyReads=[],externalRequests=[],pageErrors=[],checks=[],measurements=[];
let stubbedFontStylesheets=0;
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const drafts=new Map();
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.test');
  if(url.pathname==='/api/drafts'){if(req.method==='GET'){json(res,drafts.get(url.searchParams.get('context'))||{content:'',attachments:[],version:0,updatedAt:0});return;}if(req.method==='PUT'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),version=(drafts.get(body.context)?.version||0)+1;drafts.set(body.context,{content:body.content,attachments:body.attachments||[],version,updatedAt:Date.now()});json(res,{version});return;}}
  if(url.pathname.startsWith('/api/')&&req.method!=='GET'){
    mutations.push({path:url.pathname,method:req.method});json(res,{error:'Ce test autorise uniquement les lectures locales.'},405);return;
  }
  if(url.pathname==='/api/workspace'){
    json(res,{user:{id:'composer-fixture-user',name:'Compte de test',email:'composer@example.test'},workspace:{id:'composer-fixture',name:'Espace de test',credits:10,reserved:0},resources:[conversation],catalog:[],capabilities:{model:false,modelReady:false,filePreview:false}});return;
  }
  if(url.pathname==='/api/chat'){
    historyReads.push(url.searchParams.get('conversationId'));
    if(url.searchParams.get('conversationId')!==conversation.id){json(res,{error:'Discussion de test introuvable.'},404);return;}
    json(res,{messages:[{id:'composer-fixture-user-message',role:'user',content:[{type:'text',text:'Message existant de test.'}],attachments:[]},{id:'composer-fixture-assistant-message',role:'assistant',content:[{type:'text',text:'Réponse existante de test.'}],status:'complete',sources:[],attachments:[]}]});return;
  }
  if(url.pathname.startsWith('/api/')){json(res,{error:'Route absente de cette fixture.'},404);return;}
  if(url.pathname==='/app.js'||url.pathname==='/app.css'||url.pathname.startsWith('/chunks/')){
    try{const target=path.resolve(output,'.'+url.pathname);if(!target.startsWith(output+path.sep))throw Error();res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'application/javascript'});res.end(await readFile(target));}catch{res.writeHead(404);res.end();}return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Braand · Test du compositeur</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser,lastPage;
const metrics=page=>page.locator('.composer').evaluate(element=>{
  const field=element.querySelector('textarea'),tools=element.querySelector('.composer-tools'),plus=tools.querySelector('.attach'),mode=tools.querySelector('.mode-button'),send=tools.querySelector('.send-button');
  const rect=node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height};};
  const style=getComputedStyle(element);
  return {box:rect(element),field:rect(field),tools:rect(tools),plus:rect(plus),mode:rect(mode),send:rect(send),innerLeft:element.getBoundingClientRect().left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft),innerRight:element.getBoundingClientRect().right-parseFloat(style.borderRightWidth)-parseFloat(style.paddingRight),clientHeight:field.clientHeight,scrollHeight:field.scrollHeight,overflowY:getComputedStyle(field).overflowY,lineHeight:parseFloat(getComputedStyle(field).lineHeight),documentWidth:document.documentElement.scrollWidth,viewportWidth:window.innerWidth};
});
const assertLayout=(layout,label)=>{
  assert.ok(Math.abs(layout.field.x-layout.innerLeft)<=1,`${label}: text starts at the composer inner left edge`);
  assert.ok(Math.abs(layout.field.right-layout.innerRight)<=1,`${label}: text fills the composer width`);
  assert.ok(layout.tools.y>=layout.field.bottom+1,`${label}: controls must be entirely below the text`);
  assert.ok(layout.plus.x>=layout.innerLeft-1&&layout.send.right<=layout.innerRight+1,`${label}: controls remain inside the composer`);
  assert.ok(layout.plus.right<layout.mode.x&&layout.mode.right<layout.send.x,`${label}: attachment, mode and send controls keep their order`);
  const centers=[layout.plus,layout.mode,layout.send].map(box=>box.y+box.height/2);
  assert.ok(Math.max(...centers)-Math.min(...centers)<=1,`${label}: bottom controls align on the same row`);
  assert.ok(layout.documentWidth<=layout.viewportWidth,`${label}: no horizontal document overflow`);
};
const assertFolded=(layout,width,label)=>{
  assert.equal(layout.clientHeight,24,`${label}: one line at rest`);
  if(width<768){assertLayout(layout,label);return;}
  assert.equal(layout.box.height,58,`${label}: original folded height`);
  assert.ok(layout.plus.right<layout.field.x&&layout.field.right<layout.mode.x,`${label}: text remains between the controls`);
  const centers=[layout.plus,layout.field,layout.mode,layout.send].map(box=>box.y+box.height/2);
  assert.ok(Math.max(...centers)-Math.min(...centers)<=1,`${label}: text and controls share one row`);
  assert.ok(layout.documentWidth<=layout.viewportWidth,`${label}: no horizontal document overflow`);
};

try{
  try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'msedge'});}
  for(const width of [1280,1003,814,390]){
    const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin)return route.continue();
      // Keep the established stylesheet import offline; screenshots use the system fallback.
      if(url.origin==='https://fonts.googleapis.com'&&url.pathname==='/css2'&&route.request().resourceType()==='stylesheet'){stubbedFontStylesheets++;return route.fulfill({status:200,contentType:'text/css',body:''});}
      externalRequests.push(url.href);return route.abort();
    });
    const page=await context.newPage();lastPage=page;page.on('pageerror',error=>pageErrors.push(error.message));
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace');await page.goto(origin);await loaded;await page.locator('.topbar').waitFor();
    const composer=page.getByRole('textbox',{name:'Votre demande à Braand',exact:true});
    for(const surface of ['home','conversation']){
      if(surface==='conversation'){
        await composer.fill('');
        if(width<768)await page.getByRole('button',{name:'Ouvrir la navigation',exact:true}).click();
        // Between phone and wide screens the navigation is an icon rail: unfold it to reach recent conversations.
        else{const unfold=page.getByRole('button',{name:'Déployer la navigation',exact:true});if(await unfold.isVisible())await unfold.click();}
        await page.getByRole('button',{name:conversation.title,exact:true}).click();
        await page.getByText('Réponse existante de test.',{exact:true}).waitFor();
        await page.locator('.conversation .composer').waitFor();
      }else await page.locator('.home-composer').waitFor();
      await composer.fill('');
      await page.waitForFunction(()=>document.querySelector('.composer textarea')?.clientHeight===24);
      const empty=await metrics(page);assertFolded(empty,width,`${surface} ${width}px empty`);
      if(surface==='home'&&[1280,390].includes(width))await page.screenshot({path:path.join(output,`composer-folded-home-${width}.png`),fullPage:true});
      await composer.focus();assertFolded(await metrics(page),width,`${surface} ${width}px focused`);
      await composer.fill('Bonjour');assertFolded(await metrics(page),width,`${surface} ${width}px single line`);
      await composer.fill(paragraphs);
      await page.waitForFunction(()=>{const field=document.querySelector('.composer textarea');return field?.clientHeight>=168;});
      const filled=await metrics(page);assertLayout(filled,`${surface} ${width}px paragraphs`);
      assert.ok(Math.abs(filled.box.width-empty.box.width)<=1,`${surface} ${width}px: composer grows only vertically`);
      assert.ok(filled.box.height>empty.box.height,`${surface} ${width}px: composer expands for paragraphs`);
      if(width>=814){assert.equal(filled.overflowY,'hidden',`${surface} ${width}px: the four paragraphs must not scroll before the maximum`);assert.equal(filled.clientHeight,168,`${surface} ${width}px: seven lines fit in the full-width field`);assert.ok(filled.scrollHeight<=filled.clientHeight);}
      await composer.scrollIntoViewIfNeeded();
      if(surface==='home'&&[1280,814,390].includes(width))await page.screenshot({path:path.join(output,`composer-home-${width}.png`),fullPage:true});
      if(surface==='conversation'&&width===814)await page.screenshot({path:path.join(output,'composer-conversation-814.png'),fullPage:true});
      // Keyboard traversal never activates the send button or opens a file picker.
      await composer.focus();await page.keyboard.press('Tab');assert.equal(await page.locator('.composer-tools .attach').first().evaluate(element=>element===document.activeElement),true);
      assert.equal(await page.locator('.composer-tools .screen-share').count(),0);
      await page.keyboard.press('Tab');assert.equal(await page.locator('.composer-tools .mode-button').evaluate(element=>element===document.activeElement),true);
      await page.keyboard.press('Enter');await page.getByRole('group',{name:'Mode de travail',exact:true}).waitFor();
      await page.keyboard.press('Escape');await page.getByRole('group',{name:'Mode de travail',exact:true}).waitFor({state:'hidden'});
      await page.keyboard.press('Tab');assert.equal(await page.locator('.composer-tools .send-button').evaluate(element=>element===document.activeElement),true);
      assert.equal(await composer.inputValue(),paragraphs);
      await composer.fill('Une très longue demande.\n'.repeat(100));
      await page.waitForFunction(()=>{const field=document.querySelector('.composer textarea');return field?.clientHeight===192&&field.scrollHeight>field.clientHeight&&getComputedStyle(field).overflowY==='auto';});
      const long=await metrics(page);assertLayout(long,`${surface} ${width}px long`);assert.ok(Math.abs(long.box.width-empty.box.width)<=1);
      await composer.evaluate(element=>{element.scrollTop=element.scrollHeight;});assert.ok(await composer.evaluate(element=>element.scrollTop>0),`${surface} ${width}px: long text scrolls inside the field`);
      await composer.fill('É漢🙂'.repeat(500));
      await page.waitForFunction(()=>document.querySelector('.composer textarea')?.clientHeight===192);
      const unicode=await metrics(page);assertLayout(unicode,`${surface} ${width}px Unicode`);assert.ok(Math.abs(unicode.box.width-empty.box.width)<=1);
      await composer.fill('');await page.waitForFunction(()=>{const field=document.querySelector('.composer textarea');return field?.clientHeight===24&&getComputedStyle(field).overflowY==='hidden';});
      const cleared=await metrics(page);assertFolded(cleared,width,`${surface} ${width}px cleared`);assert.ok(Math.abs(cleared.box.height-empty.box.height)<=1,`${surface} ${width}px: clearing restores the compact height`);
      measurements.push({surface,width,empty,paragraphs:filled,long,unicode,cleared});checks.push(`${surface} ${width}px: original folded size, full-width multiline text, separate expanded controls, vertical growth, internal scrolling, Unicode and keyboard traversal`);
    }
    await context.close();lastPage=null;
  }
  assert.deepEqual(mutations,[],'The layout test must never send a message, upload, authorize or pay');
  assert.equal(historyReads.length,4);assert.ok(historyReads.every(id=>id===conversation.id));
  assert.deepEqual(externalRequests,[]);assert.deepEqual(pageErrors,[]);
  checks.push('Read-only existing conversation fixture; private draft saves only, zero external requests and unhandled browser errors');
  await writeFile(path.join(output,'results.json'),JSON.stringify({checks,measurements,historyReads:historyReads.length,apiMutations:mutations.length,externalRequests:externalRequests.length,stubbedFontStylesheets,pageErrors},null,2));
  for(const check of checks)console.log('PASS '+check);
}catch(error){if(lastPage){await lastPage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error((await lastPage.locator('body').innerText()).slice(0,1000));}throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
