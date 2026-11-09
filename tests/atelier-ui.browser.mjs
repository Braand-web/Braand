import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'.tmp/atelier-ui');await mkdir(output,{recursive:true});
await build({external:['/fonts/*'],stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useEffect,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {FilePreviewProvider,useFilePreview} from './components/file-preview/file-preview-provider';
import {FilePreviewDialog} from './components/file-preview/file-preview-dialog';import {BrowserPanel} from './components/browser-panel';import {annotatedPage} from './lib/atelier';import './components/file-preview/file-preview.css';import './app/atelier.css';
function App(){const {registerPreviewPanel,openPreview,activeId,resetPreview}=useFilePreview();const [visible,setVisible]=useState(false),[session,setSession]=useState('second'),[selection,setSelection]=useState('');const frame=useRef(null);
useEffect(()=>registerPreviewPanel(()=>setVisible(true)),[registerPreviewPanel]);
useEffect(()=>{const receive=e=>{if(e.source===frame.current?.contentWindow&&e.data.token==='test-nonce')setSelection(e.data.text);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
return <><button onClick={()=>openPreview('text',{contextFileIds:['text','denied']})}>Lire le document</button><button onClick={()=>resetPreview()}>Changer de projet</button>{visible&&activeId&&<aside aria-label="Atelier"><FilePreviewDialog embedded/></aside>}<iframe ref={frame} title="Page annotable" sandbox="allow-scripts" srcDoc={annotatedPage('<h1>Brief de test</h1><script>parent.pwned=true</script><img src=x onerror="parent.pwned=true">','test-nonce')}/><p data-selection>{selection}</p><button onClick={()=>setSession('missing')}>Session inaccessible</button><BrowserPanel key={session} embedded conversationId="chat" sessionId={session}/></>}
createRoot(document.getElementById('root')).render(<FilePreviewProvider><App/></FilePreviewProvider>);`},outdir:output,entryNames:'app',bundle:true,splitting:true,format:'esm',jsx:'automatic',alias:{'next/image':'vinext/shims/image'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'worker',setup(b){b.onResolve({filter:/pdf\.worker.*\?url$/},()=>({path:'worker',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default "/unused-worker.js";'}));}}]});
const require=createRequire(import.meta.url),{chromium}=await import(process.env.BRAAND_PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.BRAAND_PLAYWRIGHT_MODULE)).href:require.resolve('playwright'));
const now=Date.now(),session=id=>({id,version:1,status:'draft',objective:id,conversationId:id==='foreign'?'other':'chat',allowedDomains:['example.com'],url:'',title:'',tabs:[],control:'agent',maxCredits:2,maxActions:10,maxSeconds:60,actionsUsed:0,secondsUsed:0,createdAt:now,updatedAt:now,expiresAt:now+600000,pendingAction:null,observation:null,captureId:null,resultReview:null,lastError:null,profileId:null});
let server,browser;const calls=[];
try{
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 if(req.method!=='GET')calls.push(req.url);
 if(url.pathname==='/api/browser')return json({readiness:{ready:true,reasons:[]},sessions:['first','second','foreign'].map(session),profiles:[]});
 if(url.pathname.endsWith('/events'))return json({events:[],cursor:0});if(url.pathname.endsWith('/artifacts'))return json({artifacts:[]});
 if(url.pathname==='/api/files/text/metadata')return json({id:'text',name:'Brief.txt',mime:'text/plain',size:20,status:'ready'});
 if(url.pathname==='/api/files/denied/metadata')return json({error:'Accès refusé'},404);
 if(url.pathname==='/api/files/text/url')return json({url:'/content.txt'});
 if(url.pathname==='/content.txt'){res.writeHead(200,{'content-type':'text/plain'});return res.end('Contenu réel de la fixture');}
 if(url.pathname.startsWith('/api/'))return json({error:'Introuvable'},404);
 if(url.pathname!=='/'){try{res.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css':'application/javascript'});return res.end(await readFile(path.join(output,path.basename(url.pathname))));}catch{res.writeHead(404);return res.end();}}
 res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script type="module" src="/app.js"></script>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:850}});await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'Lire le document'}).click();const viewer=page.getByRole('complementary',{name:'Atelier'});
 await viewer.getByText('Contenu réel de la fixture',{exact:true}).waitFor();assert.equal(await page.locator('dialog[open]').count(),0);
 await viewer.getByRole('button',{name:'Fichier suivant'}).click();await viewer.getByRole('heading',{name:'Fichier indisponible',exact:true}).waitFor();
 await page.getByRole('button',{name:'Changer de projet'}).click();assert.equal(await viewer.count(),0);
 await page.frameLocator('iframe').getByRole('heading',{name:'Brief de test'}).click();await page.locator('[data-selection]').getByText('Brief de test',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.pwned),undefined);
 const picker=page.getByLabel('Vos sessions',{exact:true});assert.equal(await picker.inputValue(),'second');assert.equal(await picker.locator('option[value="foreign"]').count(),0);
 await page.getByRole('button',{name:'Session inaccessible'}).click();await page.getByText('Cette session est indisponible dans cette discussion.',{exact:true}).waitFor();
 assert.deepEqual(calls,['/api/files/text/url']);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Lire le document'}).click();await viewer.getByText('Contenu réel de la fixture',{exact:true}).waitFor();assert.equal(await viewer.locator('button[aria-label="Télécharger le fichier"]').count(),1);
 await page.screenshot({path:path.join(output,'mobile.png')});
 console.log('PASS embedded file reading, revoked access, context reset, isolated annotations, exact browser sessions and mobile reader. No external provider call.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
