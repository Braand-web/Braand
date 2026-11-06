// Local-only development adapter. Never used by the hosted Worker.
import {createServer} from "node:http";
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,rmSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {AsyncLocalStorage} from "node:async_hooks";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {randomBytes,createHash} from "node:crypto";
import path from "node:path";
const project=path.resolve(import.meta.dirname,"..");
const runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,"node_modules");
const require=createRequire(path.join(runtime,"package.json"));
const {build}=require("esbuild");
const output=process.env.BRAAND_BUILD_DIR?path.resolve(process.env.BRAAND_BUILD_DIR):path.join(project,".local-build"),dataDir=process.env.BRAAND_DATA_DIR?path.resolve(process.env.BRAAND_DATA_DIR):path.join(project,".local-data");
mkdirSync(output,{recursive:true});mkdirSync(dataDir,{recursive:true});mkdirSync(path.join(dataDir,"files"),{recursive:true});
mkdirSync(path.join(dataDir,"multipart"),{recursive:true});
const sql=new DatabaseSync(path.join(dataDir,"braand.sqlite"));
sql.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY)");
for(const file of readdirSync(path.join(project,"drizzle")).filter(f=>f.endsWith(".sql")).sort()){
 if(!sql.prepare("SELECT name FROM _local_migrations WHERE name=?").get(file)){
  sql.exec("BEGIN");try{sql.exec(readFileSync(path.join(project,"drizzle",file),"utf8"));sql.prepare("INSERT INTO _local_migrations VALUES (?)").run(file);sql.exec("COMMIT");}catch(error){sql.exec("ROLLBACK");throw error;}
 }
}
function statement(query,args=[]){const bound=()=>sql.prepare(query);return {
 bind(...values){return statement(query,values);},
 async first(column){const row=bound().get(...args);return column?row?.[column]??null:row??null;},
 async all(){return {results:bound().all(...args),success:true};},
 async run(){return this._run();},
 _run(){const r=bound().run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}
};}
const DB={prepare:query=>statement(query),async batch(statements){sql.exec("BEGIN");try{const results=statements.map(s=>s._run());sql.exec("COMMIT");return results;}catch(error){sql.exec("ROLLBACK");throw error;}}};
const filePath=key=>{const file=path.resolve(dataDir,"files",key);if(!file.startsWith(path.resolve(dataDir,"files")+path.sep))throw new Error("Invalid storage key");return file;};
const multipartPath=id=>{const dir=path.resolve(dataDir,"multipart",id);if(!dir.startsWith(path.resolve(dataDir,"multipart")+path.sep))throw new Error("Invalid multipart id");return dir;};
const bucketDigest=bytes=>createHash("md5").update(bytes).digest("hex");
const BUCKET={
 async put(key,bytes,options){const file=filePath(key);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,Buffer.from(bytes));writeFileSync(file+".meta",JSON.stringify(options?.httpMetadata||{}));},
 async get(key){const file=filePath(key);if(!existsSync(file))return null;const bytes=readFileSync(file);return {size:bytes.length,body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};},
 async delete(key){const {unlinkSync}=await import("node:fs");for(const file of [filePath(key),filePath(key)+".meta"])if(existsSync(file))unlinkSync(file);},
 async createMultipartUpload(key,options={}){const uploadId=randomBytes(18).toString("hex"),dir=multipartPath(uploadId);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,"state.json"),JSON.stringify({key,httpMetadata:options.httpMetadata||{}}));return this.resumeMultipartUpload(key,uploadId);},
 resumeMultipartUpload(key,uploadId){const dir=multipartPath(uploadId),statePath=path.join(dir,"state.json");if(!existsSync(statePath))throw new Error("Multipart upload not found");const state=JSON.parse(readFileSync(statePath,"utf8"));if(state.key!==key)throw new Error("Multipart key mismatch");return {
  key,uploadId,
  async uploadPart(partNumber,value){if(!Number.isInteger(partNumber)||partNumber<1||partNumber>10000)throw new Error("Invalid part number");const bytes=Buffer.from(value);writeFileSync(path.join(dir,"part-"+partNumber),bytes);return {partNumber,etag:bucketDigest(bytes)};},
  async complete(parts){const sorted=[...parts].sort((a,b)=>a.partNumber-b.partNumber);if(!sorted.length)throw new Error("No multipart parts");const buffers=[];for(const part of sorted){const partPath=path.join(dir,"part-"+part.partNumber);if(!existsSync(partPath))throw new Error("Multipart part missing");const bytes=readFileSync(partPath);if(bucketDigest(bytes)!==part.etag)throw new Error("Multipart etag mismatch");buffers.push(bytes);}const bytes=Buffer.concat(buffers);await BUCKET.put(key,bytes,{httpMetadata:state.httpMetadata});await this.abort();return {size:bytes.length,httpEtag:bucketDigest(bytes)};},
  async abort(){if(existsSync(dir))rmSync(dir,{recursive:true,force:true});}
 };}
};
const settings={};
const allowed=new Set(["MEDIA_RENDER_VIDEO_EDIT_VERIFIED","SOCIAL_PUBLISHING_ENABLED","SOCIAL_SCHEDULING_ENABLED","SOCIAL_COMMENTS_ENABLED","SOCIAL_INSIGHTS_ENABLED","RESEARCH_NATIVE_JSON","RESEARCH_TRANSPORT","MEDIA_OUTPUT_HOSTS_JSON","OPENAI_API_KEY","MODEL_ROUTING_ENABLED","MODEL_ROUTING_CATALOG_JSON","WORK_ENABLED","WORK_STAGING_VERIFIED","WORK_SCHEDULER_VERIFIED","RESEARCH_ENABLED","RESEARCH_STAGING_VERIFIED","RESEARCH_PRICING_JSON","TAVILY_API_KEY","SOCIAL_ENABLED","SOCIAL_STAGING_VERIFIED","SOCIAL_ADAPTERS_JSON","SOCIAL_INSTAGRAM_ENABLED","SOCIAL_FACEBOOK_ENABLED","SOCIAL_LINKEDIN_ENABLED","SOCIAL_TIKTOK_ENABLED","MEDIA_PERSIST_ENABLED","MEDIA_RENDER_ENABLED","MEDIA_RENDER_STAGING_VERIFIED","MEDIA_RENDER_URL","MEDIA_RENDER_TOKEN","MEDIA_RENDER_PRICING_JSON","BROWSER_ENABLED","BROWSER_AUTH_VERIFIED","BROWSER_STAGING_VERIFIED","BROWSER_PRICING_VALIDATED","BROWSER_MARGIN_VERIFIED","BROWSER_OWNERSHIP_VERIFIED","BROWSER_PRICING_JSON","BROWSER_PROFILE_KEY","BROWSER_MAX_ACTIONS","BROWSER_MAX_SECONDS","BROWSER_HUMAN_WAIT_SECONDS","APP_ENV","COMPOSIO_API_KEY","COMPOSIO_AUTH_CONFIGS_JSON","COMPOSIO_INSTANT_ENABLED","COMPOSIO_INSTANT_CATALOG_JSON","FILE_PREVIEW_V1","FILE_URL_SIGNING_SECRET","SCHEDULER_SECRET","OPS_ADMIN_IDS","BILLING_ADMIN_IDS","ANTHROPIC_API_KEY","ANTHROPIC_MODEL","ANTHROPIC_RATE_JSON","LLM_PROVIDER","OPENROUTER_API_KEY","OPENROUTER_MODEL","OPENROUTER_RATE_JSON","FAL_KEY","FAL_CATALOG_JSON","META_APP_ID","META_APP_SECRET","META_GRAPH_VERSION","META_REDIRECT_URI","TOKEN_ENCRYPTION_KEY","BILLING_ENABLED","BILLING_CHECKOUT_MODE","BILLING_XAF_CHECKOUT_VALIDATED","BILLING_TAX_VALIDATED","BILLING_BENCHMARKS_VALIDATED","BILLING_SCHEDULER_VERIFIED","BILLING_PROVIDER_TESTS_PASSED","BILLING_SUPPORT_READY","BILLING_TERMS_APPROVED","BILLING_RESTORE_TESTED","BILLING_WEBHOOK_VERIFIED","BILLING_PRODUCT_ACCEPTANCE","BILLING_LEGAL_JSON","BILLING_ECONOMICS_JSON","SASPAY_ENV","SASPAY_SECRET_KEY","SASPAY_MERCHANT_ID","SASPAY_WEBHOOK_SECRET","FREE_DAILY_CREDITS","PAGES_ORIGIN","PAGE_FORM_SECRET","AUTONOMY_ENABLED","AUTONOMY_SCHEDULER_VERIFIED","BACKUP_ENABLED","BACKUP_ENCRYPTION_KEY","BACKUP_MAINTENANCE_CONFIRMED","BACKUP_RESTORE_ALLOWED","RESEND_MODE","RESEND_API_KEY","RESEND_FROM","RESEND_TEST_RECIPIENT","OPS_ALERT_EMAIL","RESEND_LIVE_APPROVED"]);
const configFile=process.env.BRAAND_CONFIG_FILE?path.resolve(process.env.BRAAND_CONFIG_FILE):path.join(project,".dev.vars");
if(existsSync(configFile))for(const line of readFileSync(configFile,"utf8").split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&allowed.has(match[1]))settings[match[1]]=match[2].trim().replace(/^["']|["']$/g,"");}
for(const [k,v] of Object.entries(process.env))if(/^(WORK_|RESEARCH_|TAVILY_|SOCIAL_|MEDIA_|APP_ENV$|BROWSER_|AUTONOMY_|BACKUP_|COMPOSIO_|RESEND_|OPS_|SASPAY_|BILLING_|OPENROUTER_|FILE_PREVIEW_V1$|FILE_URL_SIGNING_SECRET$|LLM_PROVIDER$|ANTHROPIC_|FAL_|META_|TOKEN_ENCRYPTION_KEY$|FREE_DAILY_CREDITS$|SCHEDULER_SECRET$|PAGES_ORIGIN$|PAGE_FORM_SECRET$)/.test(k))settings[k]=v;
const context=new AsyncLocalStorage();globalThis.__braandLocal={env:{DB,BUCKET,...settings},context};
const routeFiles={
 brief:"app/api/brief/[id]/route.ts",capabilities:"app/api/capabilities/route.ts",drafts:"app/api/drafts/route.ts",memory:"app/api/memory/route.ts",skills:"app/api/skills/route.ts",skillAsset:"app/api/skills/[id]/asset/route.ts",work:"app/api/work/route.ts",workAction:"app/api/work/[...path]/route.ts",workTick:"app/api/internal/work-tick/route.ts",platformTick:"app/api/internal/platform-tick/route.ts",social:"app/api/social/[...path]/route.ts",socialAsset:"app/api/social-assets/[id]/route.ts",media:"app/api/media/[...path]/route.ts",
 browser:"app/api/browser/[...path]/route.ts",
 connectors:"app/api/connectors/[...path]/route.ts",billing:"app/api/billing/[...path]/route.ts",webhook:"app/api/webhooks/saspay/route.ts",billingTick:"app/api/internal/billing-tick/route.ts",missionTick:"app/api/internal/mission-tick/route.ts",operationsTick:"app/api/internal/operations-tick/route.ts",health:"app/api/health/route.ts",billingAdmin:"app/api/admin/billing/route.ts",operationsAdmin:"app/api/admin/operations/route.ts",mission:"app/api/missions/[id]/route.ts",published:"app/api/published/[id]/route.ts",
 workspace:"app/api/workspace/route.ts",chat:"app/api/chat/route.ts",files:"app/api/files/route.ts",fileUploads:"app/api/files/uploads/route.ts",fileAction:"app/api/files/[id]/[action]/route.ts",
 resource:"app/api/resources/[id]/route.ts",page:"app/api/pages/[id]/route.ts",proposal:"app/api/proposals/[id]/route.ts",
 meta:"app/api/meta/route.ts",connect:"app/api/meta/connect/route.ts",callback:"app/api/meta/callback/route.ts"
};
// Every other app/api route is discovered from the file tree, with Next's
// conventions ([id] one segment, [...path] the rest), so local runs serve the
// whole API instead of a hand-kept list.
const discovered=[];
const walk=dir=>{for(const name of readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,name.name);if(name.isDirectory())walk(full);else if(name.name==="route.ts")discovered.push(path.relative(project,full).replaceAll("\\","/"));}};
walk(path.join(project,"app/api"));
const known=new Set(Object.values(routeFiles)),genericRoutes=[];
discovered.filter(file=>!known.has(file)).sort().forEach((file,index)=>{
 const name="discovered"+index;routeFiles[name]=file;
 const segments=file.replace(/^app\//,"").replace(/\/route\.ts$/,"").split("/"),keys=[];
 const pattern=segments.map(segment=>{const rest=segment.match(/^\[\.\.\.(\w+)\]$/);if(rest){keys.push({name:rest[1],rest:true});return "(.+)";}const one=segment.match(/^\[(\w+)\]$/);if(one){keys.push({name:one[1]});return "([^/]+)";}return segment.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}).join("/");
 genericRoutes.push({name,regex:new RegExp("^/"+pattern+"$"),keys,staticCount:segments.filter(segment=>!segment.startsWith("[")).length});
});
genericRoutes.sort((a,b)=>b.staticCount-a.staticCount||a.keys.length-b.keys.length);
const entry=Object.entries(routeFiles).map(([name,file])=>'export * as '+name+' from "'+path.join(project,file).replaceAll("\\","/")+'";').join("\n");
await build({stdin:{contents:entry,resolveDir:project,loader:"ts"},outfile:path.join(output,"routes.mjs"),bundle:true,platform:"node",format:"esm",banner:{js:'import {createRequire as __braandCreateRequire} from "node:module";const require=__braandCreateRequire(import.meta.url);'},nodePaths:[runtime],plugins:[{name:"local-environment",setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:"env",namespace:"local"}));
 b.onResolve({filter:/^next\/headers$/},()=>({path:"headers",namespace:"local"}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"local"}));
 b.onLoad({filter:/.*/,namespace:"local"},args=>({contents:args.path==="env"?"export const env=globalThis.__braandLocal.env;":args.path==="headers"?"export async function headers(){return globalThis.__braandLocal.context.getStore()?.headers||new Headers();}":"export function redirect(url){throw new Error('Unexpected server redirect: '+url);}"}));
}}]});
const routes=await import(pathToFileURL(path.join(output,"routes.mjs")).href);
await build({stdin:{contents:'import React from "react";import {createRoot} from "react-dom/client";import Studio from "'+path.join(project,"app/studio.tsx").replaceAll("\\","/")+'";import {FilePreviewProvider} from "'+path.join(project,"components/file-preview/file-preview-provider.tsx").replaceAll("\\","/")+'";import {AppearanceProvider} from "'+path.join(project,"components/appearance-provider.tsx").replaceAll("\\","/")+'";import "'+path.join(project,"components/file-preview/file-preview.css").replaceAll("\\","/")+'";createRoot(document.getElementById("root")).render(<AppearanceProvider><FilePreviewProvider><Studio/></FilePreviewProvider></AppearanceProvider>);',resolveDir:project,loader:"tsx"},outdir:output,entryNames:"app",chunkNames:"chunks/[name]-[hash]",alias:{'next/image':'vinext/shims/image'},bundle:true,splitting:true,format:"esm",jsx:"automatic",nodePaths:[runtime],define:{"process.env.NODE_ENV":'"development"',"process.env":'{}'},minify:true,plugins:[{name:"local-pdf-worker-url",setup(b){b.onResolve({filter:/^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/},()=>({path:"pdf-worker-url",namespace:"local-pdf-worker"}));b.onLoad({filter:/.*/,namespace:"local-pdf-worker"},()=>({contents:'export default "/pdf.worker.min.mjs";',loader:"js"}));}}]});
const session=randomBytes(32).toString("hex");
const port=Number(process.env.PORT||4175);
const html='<!doctype html><html lang="fr" data-design-system="muse"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><title>Braand · Développement local</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/file-upload.css"><link rel="stylesheet" href="/app.css"><link rel="icon" href="/favicon.svg"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
function sendJSON(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));}
const server=createServer(async(req,res)=>{
 try{
  const origin="http://127.0.0.1:"+port;
  if(req.headers.host!=="127.0.0.1:"+port&&req.headers.host!=="localhost:"+port){sendJSON(res,403,{error:"Local host only."});return;}
  const url=new URL(req.url,origin);
  if(url.pathname==="/auth/sign-in"){res.writeHead(302,{"Set-Cookie":"braand_local_session="+session+"; HttpOnly; SameSite=Strict; Path=/",Location:"/"});res.end();return;}
  if(url.pathname==="/auth/sign-out"){res.writeHead(302,{"Set-Cookie":"braand_local_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",Location:"/"});res.end();return;}
  if(url.pathname.startsWith("/api/")){
   const signedIn=(req.headers.cookie||"").split(";").some(c=>c.trim()==="braand_local_session="+session);
   const headers=new Headers();if(signedIn){headers.set("x-braand-identity-id","braand_local_preview");headers.set("x-braand-identity-email","local@braand.test");headers.set("x-braand-identity-name","Espace%20local");headers.set("x-braand-identity-name-encoding","percent-encoded-utf-8");}
   const requestHeaders=new Headers();for(const [k,v] of Object.entries(req.headers))if(v&&!k.startsWith("x-braand-identity-"))requestHeaders.set(k,Array.isArray(v)?v.join(","):v);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24*1024*1024){sendJSON(res,413,{error:"Requête trop volumineuse."});return;}chunks.push(chunk);}
   const request=new Request(url,{method:req.method,headers:requestHeaders,...(!["GET","HEAD"].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const exact={"/api/capabilities":"capabilities","/api/drafts":"drafts","/api/memory":"memory","/api/skills":"skills","/api/work":"work","/api/internal/work-tick":"workTick","/api/internal/platform-tick":"platformTick","/api/webhooks/saspay":"webhook","/api/internal/billing-tick":"billingTick","/api/internal/mission-tick":"missionTick","/api/internal/operations-tick":"operationsTick","/api/health":"health","/api/admin/billing":"billingAdmin","/api/admin/operations":"operationsAdmin","/api/workspace":"workspace","/api/chat":"chat","/api/files":"files","/api/files/uploads":"fileUploads","/api/meta":"meta","/api/meta/connect":"connect","/api/meta/callback":"callback"};
   let name=exact[url.pathname],id,action;const fileActionMatch=url.pathname.match(/^\/api\/files\/([^/]+)\/([^/]+)$/);
   if(fileActionMatch){name="fileAction";id=decodeURIComponent(fileActionMatch[1]);action=decodeURIComponent(fileActionMatch[2]);}
   const skillAssetMatch=url.pathname.match(/^\/api\/skills\/([^/]+)\/asset$/);if(skillAssetMatch){name="skillAsset";id=decodeURIComponent(skillAssetMatch[1]);}
   const match=url.pathname.match(/^\/api\/(resources|pages|proposals)\/([^/]+)$/);
   if(match){name={resources:"resource",pages:"page",proposals:"proposal"}[match[1]];id=decodeURIComponent(match[2]);}
   const runtimeMatch=url.pathname.match(/^\/api\/(missions|published)\/([^/]+)$/);
   if(runtimeMatch){name={missions:"mission",published:"published"}[runtimeMatch[1]];id=decodeURIComponent(runtimeMatch[2]);}
   if(url.pathname.startsWith("/api/billing/"))name="billing";
   if(url.pathname.startsWith("/api/connectors/"))name="connectors";
   if(url.pathname==="/api/browser"||url.pathname.startsWith("/api/browser/"))name="browser";
   let platformPath;
   for(const [prefix,route] of [['/api/work/','workAction'],['/api/social/','social'],['/api/media/','media']])if(url.pathname.startsWith(prefix)){name=route;platformPath=url.pathname.slice(prefix.length).split('/');}
   const additional=url.pathname.match(/^\/api\/(brief|social-assets)\/([^/]+)$/);if(additional){name=additional[1]==='brief'?'brief':'socialAsset';id=decodeURIComponent(additional[2]);}
   let handler=name&&routes[name]?.[req.method],discoveredParams=null;
   if(!handler)for(const route of genericRoutes){const found=url.pathname.match(route.regex);if(!found)continue;const candidate=routes[route.name]?.[req.method];if(!candidate)continue;discoveredParams=Object.fromEntries(route.keys.map((key,index)=>[key.name,key.rest?found[index+1].split("/").map(decodeURIComponent):decodeURIComponent(found[index+1])]));handler=candidate;break;}
   if(!handler){sendJSON(res,404,{error:"Route introuvable."});return;}
   let response=await context.run({headers},()=>handler(request,{params:Promise.resolve(discoveredParams||{id,action,path:platformPath||url.pathname.slice(name==="browser"?"/api/browser/".length:name==="connectors"?"/api/connectors/".length:"/api/billing/".length).split("/")})}));
   if(url.pathname==="/api/workspace"&&req.method==="GET"&&response.ok){const body=await response.json();response=Response.json({...body,development:true});}
   res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body){const reader=response.body.getReader();res.on("close",()=>{if(!res.writableFinished)void reader.cancel();});while(true){const {done,value}=await reader.read();if(done)break;if(!res.destroyed)res.write(Buffer.from(value));}}res.end();return;
  }
  const staticFiles={"/app.js":[path.join(output,"app.js"),"application/javascript"],"/app.css":[path.join(output,"app.css"),"text/css"],"/style.css":[path.join(project,"app/globals.css"),"text/css"],"/file-upload.css":[path.join(project,"app/file-upload.css"),"text/css"],"/favicon.svg":[path.join(project,"public/favicon.svg"),"image/svg+xml"],"/pdf.worker.min.mjs":[require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),"text/javascript"]};
  if(staticFiles[url.pathname]){const [file,type]=staticFiles[url.pathname];res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});res.end(readFileSync(file));return;}
  // Public assets (fonts, icons, brand images) as the hosted app serves them.
  {const publicRoot=path.resolve(project,"public"),file=path.resolve(publicRoot,"."+decodeURIComponent(url.pathname));
   if(url.pathname!=="/"&&file.startsWith(publicRoot+path.sep)&&existsSync(file)&&!file.endsWith(path.sep)){try{const types={".ttf":"font/ttf",".woff2":"font/woff2",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".webp":"image/webp",".jpg":"image/jpeg",".txt":"text/plain; charset=utf-8",".json":"application/json",".pdf":"application/pdf",".zip":"application/zip",".html":"text/html; charset=utf-8"};res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});res.end(readFileSync(file));return;}catch{/* A directory: fall through to the app. */}}}
  if(url.pathname.startsWith("/chunks/")){
   const file=path.resolve(output,decodeURIComponent(url.pathname.slice(1)));
   if(!file.startsWith(path.resolve(output)+path.sep)||!existsSync(file)){sendJSON(res,404,{error:"Ressource locale introuvable."});return;}
   res.writeHead(200,{"Content-Type":"application/javascript","Cache-Control":"no-store"});res.end(readFileSync(file));return;
  }
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});res.end(html);
 }catch(error){console.error("Local request:",error instanceof Error?error.message:"error");if(!res.headersSent)sendJSON(res,500,{error:"Erreur du serveur local."});else res.end();}
});
server.listen(port,"127.0.0.1",()=>console.log("Braand local (SQLite + actual API routes): http://127.0.0.1:"+port+"\nLocal development sign-in only. No provider credentials are included."));

