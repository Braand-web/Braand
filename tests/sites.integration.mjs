// Websites: drafts, limits, browser check, exact user approval, isolated public
// Worker (published files only, previews by short-lived token, contact form),
// free tier with the Braand mention and no cross-workspace access.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/sites');mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');
sql.exec("CREATE TABLE resources(id TEXT PRIMARY KEY,workspace_id TEXT,kind TEXT,title TEXT,data TEXT,status TEXT,version INTEGER DEFAULT 1,created_at INTEGER,updated_at INTEGER);CREATE TABLE files(id TEXT,workspace_id TEXT,storage_key TEXT,size_bytes INTEGER,detected_mime TEXT,status TEXT);CREATE TABLE audit(id TEXT,workspace_id TEXT,actor TEXT,action TEXT,target TEXT,detail TEXT,created_at INTEGER)");
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
const D1={prepare:q=>statement(q),batch:async rows=>{const results=[];for(const row of rows)results.push(await row.run());return results;}};
const objects=new Map();
const R2={async put(key,value){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):value instanceof Uint8Array?value:new TextEncoder().encode(String(value));objects.set(key,bytes.slice());},async get(key){const bytes=objects.get(key);if(!bytes)return null;return {size:bytes.length,body:new Blob([bytes]).stream(),async text(){return new TextDecoder().decode(bytes);},async arrayBuffer(){return bytes.slice().buffer;}};},async delete(key){objects.delete(key);}};
globalThis.__sites={db:D1,env:{BUCKET:R2,SITES_ORIGIN:'https://braand-sites.example.workers.dev'},subscribed:new Set(),roles:{}};
const stubs={
 './server':`const F=globalThis.__sites;import {AppError} from ${JSON.stringify(path.join(root,'lib/core.mjs'))};
 export const db=()=>F.db;export const config=()=>F.env;export const uid=()=>crypto.randomUUID();
 export async function authorize(tenant,user,action){const role=F.roles[user]||'owner';if(role==='reader'&&action!=='read')throw new AppError('Accès refusé.',403);}
 export async function auditLog(tenant,actor,action,target,detail){await F.db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),tenant,actor,action,target,JSON.stringify(detail),Date.now()).run();}
 export async function getResource(tenant,id){const r=await F.db.prepare('SELECT * FROM resources WHERE id=? AND workspace_id=?').bind(id,tenant).first();if(!r)throw new AppError('Ressource introuvable.',404);return {...r,data:JSON.parse(r.data)};}
 export async function createResource(tenant,kind,title,data,status){const id=crypto.randomUUID(),now=Date.now();await F.db.prepare('INSERT INTO resources(id,workspace_id,kind,title,data,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)').bind(id,tenant,kind,title,JSON.stringify(data),status,now,now).run();return getResource(tenant,id);}
 export async function updateResource(tenant,id,version,patch){const c=await getResource(tenant,id);const r=await F.db.prepare('UPDATE resources SET title=?,data=?,status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?').bind(patch.title??c.title,JSON.stringify(patch.data??c.data),patch.status??c.status,Date.now(),id,tenant,version).run();if(!r.meta.changes)throw new AppError('La version a changé.',409,'stale_version');return getResource(tenant,id);}`,
 './billing':`export async function currentSubscription(org){return globalThis.__sites.subscribed.has(org)?{plan:'pro'}:null;}`,
};
await build({entryPoints:[path.join(root,'lib/sites.ts')],outfile:path.join(out,'sites.mjs'),bundle:true,platform:'node',format:'esm',external:['zod','@cloudflare/playwright'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/(server|billing)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:root}));}}]});
const sites=await import(pathToFileURL(path.join(out,'sites.mjs')));
const worker=(await import(pathToFileURL(path.join(root,'services/sites/handler.mjs')))).default;
const workerEnv={DB:D1,BUCKET:R2};
const who={tenant:'ws-awa',organization:'org-awa',user:{userId:'awa'}},other={tenant:'ws-paul',organization:'org-paul',user:{userId:'paul'}};
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const page=(title,body,extra='')=>`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="style.css">${extra}</head><body><h1>${title}</h1>${body}<script src="app.js"></script></body></html>`;
let site;
await check('a site draft reserves a unique public name and rejects unsafe paths and oversized files',async()=>{
 site=await sites.createSite(who,{title:'Boutique Awa'});assert.equal(site.slug,'boutique-awa');assert.equal(site.kind,'site');
 const twin=await sites.createSite(other,{title:'Boutique Awa'});assert.match(twin.slug,/^boutique-awa-[a-z0-9]+$/);
 await assert.rejects(()=>sites.createSite(who,{title:'API'}),/réservé/);
 for(const bad of ['../secret.html','.env','a//b.html','page.php'])await assert.rejects(()=>sites.writeSiteFile(who,{siteId:site.id,path:bad,content:'x'}),error=>error.code==='site_path_invalid');
 await assert.rejects(()=>sites.writeSiteFile(who,{siteId:site.id,path:'big.js',content:'x'.repeat(512*1024+1)}));
 await assert.rejects(()=>sites.writeSiteFile(other,{siteId:site.id,path:'index.html',content:'x'}),/introuvable/);
});
await check('files are written as versions and listed, read and deleted',async()=>{
 await sites.writeSiteFile(who,{siteId:site.id,path:'index.html',content:page('Boutique Awa','<a href="contact.html">Contact</a> <a href="tarifs">Tarifs</a> <img src="assets/logo.png">')});
 await sites.writeSiteFile(who,{siteId:site.id,path:'style.css',content:'body{font-family:system-ui}'});
 await sites.writeSiteFile(who,{siteId:site.id,path:'app.js',content:'document.body.dataset.ready="1";'});
 const listed=await sites.listSiteFiles(who,{siteId:site.id});assert.deepEqual(listed.pages,['index.html']);assert.equal(listed.files.length,3);
 assert.match((await sites.readSiteFile(who,{siteId:site.id,path:'style.css'})).content,/system-ui/);
 await sites.writeSiteFile(who,{siteId:site.id,path:'tmp.txt',content:'x'});const after=await sites.deleteSiteFile(who,{siteId:site.id,path:'tmp.txt'});assert.equal(after.files.length,3);
});
await check('the check finds broken links, missing alt text and overflow, then passes once fixed',async()=>{
 const launch=async()=>({async newPage(){let handler,current;const listeners={};return {on(event,fn){listeners[event]=fn;},async route(_,fn){handler=fn;},async setViewportSize(size){current=size;},async goto(url){let served=null;await handler({request:()=>({url:()=>url}),async fulfill(response){served=response;}});assert.equal(served.status,200,'the page is served from the draft');},async evaluate(){return current.width<400&&objects.get('sites/ws-awa/'+site.id+'/draft/style.css')&&new TextDecoder().decode(objects.get('sites/ws-awa/'+site.id+'/draft/style.css')).includes('width:600px');}};},async close(){}});
 const first=await sites.checkSite(who,{siteId:site.id},launch);assert.equal(first.status,'issues');
 assert.ok(first.issues.some(issue=>/contact\.html/.test(issue)));assert.ok(first.issues.some(issue=>/tarifs/.test(issue)));assert.ok(first.issues.some(issue=>/texte alternatif/.test(issue)));assert.ok(first.issues.some(issue=>/assets\/logo\.png/.test(issue)));
 await sites.writeSiteFile(who,{siteId:site.id,path:'style.css',content:'.hero{width:600px}'});
 assert.ok((await sites.checkSite(who,{siteId:site.id},launch)).issues.some(issue=>/déborde horizontalement sur mobile/.test(issue)));
 objects.set('lib/logo',new Uint8Array([137,80,78,71,1,2,3]));sql.prepare("INSERT INTO files VALUES ('logo','ws-awa','lib/logo',7,'image/png','ready')").run();
 await sites.importSiteAsset(who,{siteId:site.id,fileId:'logo',path:'assets/logo.png'});
 await assert.rejects(()=>sites.importSiteAsset(other,{siteId:site.id,fileId:'logo',path:'assets/x.png'}));
 await sites.writeSiteFile(who,{siteId:site.id,path:'style.css',content:'body{font-family:system-ui}'});
 await sites.writeSiteFile(who,{siteId:site.id,path:'index.html',content:page('Boutique Awa','<a href="contact.html">Contact</a> <a href="tarifs">Tarifs</a> <img src="assets/logo.png" alt="Logo Boutique Awa">')});
 await sites.writeSiteFile(who,{siteId:site.id,path:'contact.html',content:page('Contact','<form method="post" action="__contact"><input name="name"><input name="email"><textarea name="message"></textarea><input type="hidden" name="redirect" value="merci.html"><button>Envoyer</button></form>')});
 await sites.writeSiteFile(who,{siteId:site.id,path:'tarifs.html',content:page('Tarifs','<p>Sur devis.</p>')});
 const passed=await sites.checkSite(who,{siteId:site.id},launch);assert.deepEqual(passed.issues,[]);assert.equal(passed.status,'passed');assert.equal(passed.renderedViews,6);assert.match(passed.check,/3 pages vérifiées sur ordinateur et mobile/);
});
await check('nothing is public before the user approves the exact prepared version',async()=>{
 const before=await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/'),workerEnv);assert.equal(before.status,404);
 const listed=await sites.listSiteFiles(who,{siteId:site.id});
 await assert.rejects(()=>sites.prepareSitePublication(who,site.id,{version:listed.version-1}),error=>error.code==='stale_version');
 const prepared=await sites.prepareSitePublication(who,site.id,{version:listed.version});assert.equal(prepared.url,'https://braand-sites.example.workers.dev/boutique-awa/');assert.equal(prepared.badge,true);
 assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/'),workerEnv)).status,404,'prepared is not published');
 await assert.rejects(()=>sites.approveSitePublication(who,site.id,{version:listed.version,digest:'0'.repeat(64),approved:true}),error=>error.code==='stale_approval');
 globalThis.__sites.roles.reader='reader';await assert.rejects(()=>sites.approveSitePublication({...who,user:{userId:'reader'}},site.id,{version:listed.version,digest:prepared.digest,approved:true}),/refusé/);
 const live=await sites.approveSitePublication(who,site.id,{version:listed.version,digest:prepared.digest,approved:true});assert.equal(live.status,'published');
});
await check('the public Worker serves only published files, with strict headers and the free mention',async()=>{
 const home=await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/'),workerEnv);assert.equal(home.status,200);
 const html=await home.text();assert.match(html,/Fait avec Braand/);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(home.headers.get('x-frame-options'),'DENY');assert.equal(home.headers.get('set-cookie'),null);
 assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/tarifs'),workerEnv)).status,200,'clean address without .html');
 assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/style.css'),workerEnv)).headers.get('content-type'),'text/css; charset=utf-8');
 assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/..%2F..%2Fsecret'),workerEnv)).status,404);
 assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa'),workerEnv)).status,301);
 // A later draft edit does not change the live site until a new approval.
 await sites.writeSiteFile(who,{siteId:site.id,path:'tarifs.html',content:page('Tarifs','<p>NOUVEAU PRIX NON VALIDÉ</p>')});
 assert.doesNotMatch(await (await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/tarifs'),workerEnv)).text(),/NON VALIDÉ/);
});
await check('previews use a short-lived token, are framable only by Braand and expire',async()=>{
 const {url}=await sites.sitePreviewUrl(who,site.id);assert.match(url,/^https:\/\/braand-sites\.example\.workers\.dev\/__preview\/[a-f0-9]{48}\/$/);
 const preview=await worker.fetch(new Request(url+'tarifs'),workerEnv);assert.equal(preview.status,200);assert.match(await preview.text(),/NON VALIDÉ/);assert.match(preview.headers.get('content-security-policy'),/frame-ancestors https:\/\/braand\.fun/);assert.equal(preview.headers.get('x-robots-tag'),'noindex, nofollow');
 sql.prepare('UPDATE site_preview_tokens SET expires_at=0').run();assert.equal((await worker.fetch(new Request(url),workerEnv)).status,410);
 assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/__preview/'+'a'.repeat(48)+'/'),workerEnv)).status,410);
});
await check('the contact form saves requests for the site owner only, with validation and rate limits',async()=>{
 const send=(body,ip='1.2.3.4')=>worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/__contact',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':ip},body:new URLSearchParams(body).toString()}),workerEnv);
 const ok=await send({name:'Client',email:'client@exemple.cm',message:'Bonjour, quel est le prix ?',redirect:'merci.html'});assert.equal(ok.status,303);assert.equal(ok.headers.get('location'),'https://braand-sites.example.workers.dev/boutique-awa/merci.html');
 assert.equal((await send({name:'',email:'x',message:''})).status,400);assert.equal((await send({name:'Bot',email:'b@b.cm',message:'spam',website:'x'})).status,400);
 for(let i=0;i<5;i++)assert.equal((await send({name:'N',email:'n@n.cm',message:'m'},'9.9.9.9')).status,201);assert.equal((await send({name:'N',email:'n@n.cm',message:'m'},'9.9.9.9')).status,429);
 const leads=await sites.siteLeads(who,site.id);assert.equal(leads.length,6);assert.equal(leads.at(-1).email,'client@exemple.cm');
 assert.equal((await sites.siteLeads(other,site.id)).length,0);
});
await check('the free account keeps one site online; subscribers have more and no mention; taking offline works',async()=>{
 const second=await sites.createSite(who,{title:'Deuxième site'});await sites.writeSiteFile(who,{siteId:second.id,path:'index.html',content:page('Deux','<p>Deux</p>')});
 const v=(await sites.listSiteFiles(who,{siteId:second.id})).version;
 await assert.rejects(()=>sites.prepareSitePublication(who,second.id,{version:v}),error=>error.code==='site_limit_reached');
 globalThis.__sites.subscribed.add('org-awa');const prepared=await sites.prepareSitePublication(who,second.id,{version:v});assert.equal(prepared.badge,false);
 await sites.approveSitePublication(who,second.id,{version:v,digest:prepared.digest,approved:true});
 assert.doesNotMatch(await (await worker.fetch(new Request('https://braand-sites.example.workers.dev/'+second.slug+'/'),workerEnv)).text(),/Fait avec Braand/);
 await sites.suspendSitePublication(who,site.id);assert.equal((await worker.fetch(new Request('https://braand-sites.example.workers.dev/boutique-awa/'),workerEnv)).status,404);
 assert.ok(sql.prepare("SELECT COUNT(*) n FROM audit WHERE action LIKE 'site.publication.%'").get().n>=4);
});
await check('the app never accepts braand.fun as the sites address',async()=>{
 globalThis.__sites.env.SITES_ORIGIN='https://braand.fun';await assert.rejects(()=>sites.sitePreviewUrl(who,site.id),error=>error.code==='sites_not_configured');
 delete globalThis.__sites.env.SITES_ORIGIN;await assert.rejects(()=>sites.sitePreviewUrl(who,site.id),/pas encore activée/);
 sql.prepare("INSERT INTO platform_settings VALUES ('sites_origin','https://braand-sites.example.workers.dev',1)").run();assert.match((await sites.sitePreviewUrl(who,site.id)).url,/workers\.dev/);
});
await check('the workers.dev host records its own address once and never exposes the app',async()=>{
 assert.equal((await worker.fetch(new Request('https://evil.example.workers.dev/__braand-sites-ready'),workerEnv)).status,404);
 assert.equal((await worker.fetch(new Request('https://aira-production.braand.workers.dev/__braand-sites-ready'),workerEnv)).status,200);
 assert.equal(sql.prepare("SELECT value FROM platform_settings WHERE key='sites_origin'").get().value,'https://aira-production.braand.workers.dev');
 for(const path of ['/api/health','/api/workspace','/auth/sign-in','/admin'])assert.equal((await worker.fetch(new Request('https://aira-production.braand.workers.dev'+path),workerEnv)).status,404,path);
 const reserved=await import(pathToFileURL(path.join(root,'lib/site-files.mjs')));for(const name of ['brand','fonts','onboarding','api'])assert.throws(()=>reserved.siteSlug(name),/réservé/);
});
console.log(`${checks} website checks passed; no provider, payment or network call.`);
