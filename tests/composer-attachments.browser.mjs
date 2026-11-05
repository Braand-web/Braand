// Real composer and preview, isolated APIs: no production uploads or messages.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const {chromium}=await import((process.env.BRAAND_PLAYWRIGHT_MODULE||process.env.AIRA_PLAYWRIGHT_MODULE)?pathToFileURL(process.env.BRAAND_PLAYWRIGHT_MODULE||process.env.AIRA_PLAYWRIGHT_MODULE).href:require.resolve('playwright'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.tmp','composer-attachments-browser');
await mkdir(output,{recursive:true});
await build({external:['/fonts/*'],stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Studio from "./app/studio";import {FilePreviewProvider} from "./components/file-preview/file-preview-provider";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-tokens.css";import "./app/file-upload.css";import "./components/file-preview/file-preview.css";createRoot(document.getElementById("root")).render(<FilePreviewProvider><Studio/></FilePreviewProvider>);',resolveDir:root,loader:'tsx'},outdir:output,entryNames:'app',chunkNames:'chunks/[name]-[hash]',alias:{'next/image':'vinext/shims/image'},bundle:true,splitting:true,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},plugins:[{name:'fixture-worker-url',setup(builder){builder.onResolve({filter:/^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/},()=>({path:'worker',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default "/unused-pdf-worker.mjs";',loader:'js'}));}}]});
let png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const files=[
  {id:'image-1',name:'reference-produit.png',mime:'image/png',size:png.length,status:'ready'},
  {id:'image-2',name:'autre-reference.png',mime:'image/png',size:png.length,status:'ready'},
  {id:'document',name:'Catalogue-et-conditions-commerciales.pdf',mime:'application/pdf',size:1200,status:'ready'},
  {id:'broken',name:'image-indisponible.png',mime:'image/png',size:100,status:'ready'},
];
const resources=files.map(file=>({id:file.id,kind:'file',title:file.name,status:file.status,version:1,created_at:Date.now(),updated_at:Date.now(),data:{mime:file.mime,size:file.size}}));
const apiCalls=[],errors=[],external=[];
let securePreview=true;
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.test'),match=/^\/api\/files\/([^/]+)\/(metadata|url|content)$/.exec(url.pathname);
  if(url.pathname.startsWith('/api/'))apiCalls.push({path:url.pathname,method:req.method});
  if(url.pathname==='/api/workspace')return json(res,{user:{id:'fixture-user',name:'Compte de test',email:'fixture@example.test'},workspace:{id:'fixture',name:'Espace de test',credits:10,reserved:0},resources:[],catalog:[],capabilities:{model:false,modelReady:false,filePreview:securePreview}});
  if(url.pathname==='/api/files/uploads'&&req.method==='GET')return json(res,{uploads:[]});
  if(url.pathname==='/api/files/uploads'&&req.method==='PUT'){for await(const chunk of req)void chunk;await new Promise(resolve=>setTimeout(resolve,1500));return json(res,{ok:true});}
  if(url.pathname==='/api/files'&&req.method==='POST'){
    let uploadBytes=0;for await(const chunk of req)uploadBytes+=chunk.length;
    if(!uploadBytes)return json(res,{error:'Import vide'},400);
    const resource=resources.find(file=>file.title===files[0].name);
    return json(res,resource,201);
  }
  if(url.pathname==='/api/files/uploads'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    const parsed=JSON.parse(body);
    if(parsed.action==='complete')return json(res,{resource:resources[0]});
    if(parsed.name==='envoi-lent.png')return json(res,{upload:{uploadId:'slow-upload',name:parsed.name,size:parsed.size,sha256:parsed.sha256,partCount:1,chunkBytes:8*1024*1024,uploadedParts:[],expiresAt:Date.now()+60000}});
    const resource=resources.find(file=>file.title===parsed.name);
    return json(res,{deduplicated:true,resource});
  }
  if(match){
    const [,id,action]=match,file=files.find(file=>file.id===id);
    if(!file)return json(res,{error:'Fichier introuvable'},404);
    if(action==='metadata')return json(res,file);
    if(action==='url'){
      let body='';for await(const chunk of req)body+=chunk;
      assert.equal(JSON.parse(body).scope,'content');
      return json(res,{url:`/api/files/${id}/content?token=fixture`});
    }
    if(id==='broken')return json(res,{error:'Indisponible'},404);
    res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);
  }
  if(url.pathname==='/api/files'&&req.method==='GET'&&url.searchParams.get('preview')==='thumbnail'){
    const file=files.find(file=>file.id===url.searchParams.get('id'));
    if(!file||!file.mime.startsWith('image/'))return json(res,{error:'Aperçu non disponible'},415);
    res.writeHead(200,{'Content-Type':file.mime,'Content-Disposition':'inline','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"});return res.end(png);
  }
  if(url.pathname.startsWith('/api/'))return json(res,{error:'Route non autorisée'},405);
  if(url.pathname==='/app.js'||url.pathname==='/app.css'||url.pathname.startsWith('/chunks/')){
    const target=path.resolve(output,'.'+url.pathname);
    if(!target.startsWith(output+path.sep)){res.writeHead(404);return res.end();}
    try{res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'application/javascript'});res.end(await readFile(target));}catch{res.writeHead(404);res.end();}return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Test des pièces jointes</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const width of [1280,814,390]){
    securePreview=width!==390;
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();if(url.hostname==='fonts.googleapis.com')return route.fulfill({status:200,contentType:'text/css',body:''});external.push(url.href);return route.abort();});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+(securePreview?'/':'/?legacy=1'));await page.locator('.home-composer textarea').waitFor();
    if(securePreview){const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=150;const context=canvas.getContext('2d');const sky=context.createLinearGradient(0,0,0,150);sky.addColorStop(0,'#b9d6f0');sky.addColorStop(1,'#f5dfc5');context.fillStyle=sky;context.fillRect(0,0,150,150);context.fillStyle='#fff0c0';context.beginPath();context.arc(111,43,17,0,Math.PI*2);context.fill();context.fillStyle='#477f77';context.beginPath();context.moveTo(0,116);context.lineTo(53,56);context.lineTo(101,116);context.fill();context.fillStyle='#6c947c';context.beginPath();context.moveTo(48,118);context.lineTo(101,67);context.lineTo(150,119);context.fill();context.fillStyle='#91a577';context.fillRect(0,118,150,32);return canvas.toDataURL('image/png').split(',')[1];});png=Buffer.from(data,'base64');}
    const field=page.locator('.composer textarea'),composer=page.locator('.composer');
    const controls=()=>page.locator('.composer-tools').evaluate(node=>{const clone=node.cloneNode(true);clone.querySelectorAll('[disabled]').forEach(button=>button.removeAttribute('disabled'));return clone.outerHTML;});
    const before=await controls(),empty=await composer.boundingBox();
    if(width>=768)assert.equal(empty.height,58);
    await field.fill('Mon brouillon');
    await page.locator('input[type="file"][multiple]').setInputFiles((securePreview?files.slice(0,3):files.slice(0,1)).map(file=>({name:file.name,mimeType:file.mime,buffer:png})));
    await page.waitForFunction((minimum)=>document.querySelectorAll('.file-card-attachment:not(.file-card-uploading)').length===minimum&&Array.from(document.querySelectorAll('.file-card-attachment:not(.file-card-uploading) img')).filter(img=>img.complete&&img.naturalWidth>0).length===(minimum===3?2:1),securePreview?3:1);
    const tiles=page.locator('.attachments-file-cards .file-card-attachment:not(.file-card-uploading)');
    assert.equal(await controls(),before,'Bottom action markup and labels stay unchanged');
    for(let index=0;index<(securePreview?3:1);index++){
      const tile=tiles.nth(index),box=await tile.boundingBox();assert.equal(box.height,150);assert.equal(box.width,index===2?200:150);
      assert.ok(box.y+box.height<=(await field.boundingBox()).y,'Attachments sit above the text');
      assert.equal(await tile.locator('.file-card-attachment-caption').count(),index===2?1:0);
    }
    const bounds=await composer.boundingBox();assert.equal(bounds.width,empty.width);assert.ok(bounds.height>empty.height);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const text=await field.boundingBox(),buttons=await page.locator('.composer-tools .attach').first().boundingBox();assert.ok(buttons.y>=text.y+text.height);
    await composer.screenshot({path:path.join(output,`attachments-${width}.png`)});
    if(securePreview){
      const documentTile=tiles.nth(2);assert.equal(await documentTile.locator('.file-card-attachment-caption').innerText(),files[2].name);
      await tiles.first().locator('.file-card-open').click();await page.locator('.file-preview-dialog[open]').waitFor();
      await page.getByRole('button',{name:'Fichier suivant',exact:true}).click();
      await page.getByRole('button',{name:'Fermer l’aperçu',exact:true}).click();
      assert.equal(await field.inputValue(),'Mon brouillon');assert.equal(await tiles.count(),3);
    }else{
      await page.waitForFunction(()=>Array.from(document.images).some(image=>image.src.includes('preview=thumbnail')&&image.complete&&image.naturalWidth>0));
      assert.equal(await tiles.first().locator('.file-card-open').isDisabled(),true);
    }
    await tiles.first().hover();await page.getByRole('button',{name:'Retirer '+files[0].name,exact:true}).click();assert.equal(await tiles.count(),securePreview?2:0);
    if(!securePreview){await field.fill('');await page.waitForFunction(()=>!document.querySelector('.composer-entry').hasAttribute('data-expanded'));assert.equal((await composer.boundingBox()).height,empty.height);assert.equal(await controls(),before);await context.close();console.log(`PASS ${width}px legacy mode: private inline image, original controls and compact reset`);continue;}
    await page.locator('input[type="file"][multiple]').setInputFiles({name:files[3].name,mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>document.querySelectorAll('.file-card-attachment:not(.file-card-uploading)').length===3&&document.querySelectorAll('.file-card-attachment:not(.file-card-uploading) img').length===1);
    const broken=page.getByRole('button',{name:'Ouvrir l’aperçu de '+files[3].name,exact:true});assert.ok(await broken.isEnabled());assert.ok(await broken.locator('svg').isVisible());
    for(const file of files.slice(1)){
      const remove=page.getByRole('button',{name:'Retirer '+file.name,exact:true});await remove.focus();await remove.click();
    }
    // A slow upload shows only its own card with a small loader, never banners or bars.
    await page.locator('input[type="file"][multiple]').setInputFiles({name:'envoi-lent.png',mimeType:'image/png',buffer:png});
    const sending=page.locator('.file-card-uploading');await sending.waitFor();
    assert.equal(await sending.count(),1);assert.ok(await sending.locator('.file-uploading-ring svg').isVisible());assert.ok(await sending.locator('img').isVisible(),'the card shows the file itself');
    assert.ok(await page.getByRole('button',{name:'Annuler l’envoi de envoi-lent.png',exact:true}).isVisible());
    assert.equal(await page.locator('.file-resume-list,.file-upload-progress,progress').count(),0,'no resume banner or progress bar');
    const card=await sending.boundingBox();assert.equal(card.height,150);assert.ok(card.y+card.height<=(await field.boundingBox()).y);
    await page.screenshot({path:path.join(output,`uploading-${width}.png`)});
    await sending.waitFor({state:'detached',timeout:10000});
    await page.getByRole('button',{name:'Retirer '+files[0].name,exact:true}).click();
    await field.fill('');await page.waitForFunction(()=>!document.querySelector('.composer-entry').hasAttribute('data-expanded'));
    assert.equal((await composer.boundingBox()).height,empty.height);assert.equal(await controls(),before);
    await context.close();console.log(`PASS ${width}px: image tiles, document caption, preview, removal, fallback, compact reset and unchanged actions`);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.ok(apiCalls.every(call=>call.method==='GET'||call.path==='/api/drafts'||call.path==='/api/files/uploads'||call.path==='/api/files'||/^\/api\/files\/[^/]+\/url$/.test(call.path)),'No messages, payments or production writes');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
