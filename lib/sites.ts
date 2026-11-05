// Websites built by Braand: drafts in R2, automatic checks with a real browser,
// and publication on a separate domain after the user's exact approval.
import {z} from 'zod';
import {authorize,config,createResource,db,getResource,updateResource,uid,auditLog} from './server';
import {AppError} from './core.mjs';
import {currentSubscription,type BillingIdentity} from './billing';
import {PLANS} from './billing-core.mjs';
import type {Resource} from './contracts';
import {SITES_SCHEMA,SITE_LIMITS,TEXT_EXTENSIONS,normalizeSitePath,siteExtension,siteMime,siteReferences,siteSlug} from './site-files.mjs';

type SiteFile={path:string;size:number;sha256:string;mime:string};
type SiteData={slug:string;description?:string;files:SiteFile[]};
type Publication={id:string;workspace_id:string;organization_id:string;resource_id:string;slug:string;resource_version:number;digest:string;status:string;badge:number;live_digest:string|null};

let schemaReady:Promise<void>|null=null;
// Created at runtime like other recent tables: production migrations are not replayed on deploy.
export function ensureSitesSchema(){
 schemaReady??=db().batch(SITES_SCHEMA.map(sql=>db().prepare(sql)) ).then(()=>undefined).catch(error=>{schemaReady=null;throw error;});
 return schemaReady;
}

/** Public origin of the sites Worker, recorded by the deploy (never braand.fun itself). */
export async function sitesOrigin(){
 await ensureSitesSchema();
 const raw=config().SITES_ORIGIN||(await db().prepare("SELECT value FROM platform_settings WHERE key='sites_origin'").first<{value:string}>())?.value;
 if(!raw)throw new AppError('La publication des sites n’est pas encore activée sur Braand. Le site reste prêt en brouillon.',503,'sites_not_configured');
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.pathname!=='/'||/(^|\.)braand\.fun$/.test(url.hostname))throw new AppError('Adresse publique des sites invalide.',503,'sites_not_configured');
 return url.origin;
}
const bucket=()=>{const b=config().BUCKET;if(!b)throw new AppError('Stockage des fichiers indisponible.',503);return b;};
const draftKey=(tenant:string,id:string,path:string)=>`sites/${tenant}/${id}/draft/${path}`;
const publicKey=(slug:string,digest:string,path:string)=>`sites-public/${slug}/${digest}/${path}`;
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const sha=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest('SHA-256',bytes.slice().buffer as ArrayBuffer));
const siteData=(resource:Resource):SiteData=>{const data=resource.data as Partial<SiteData>;return {slug:String(data.slug||''),description:typeof data.description==='string'?data.description:undefined,files:Array.isArray(data.files)?data.files as SiteFile[]:[]};};

async function siteResource(who:BillingIdentity,id:string){
 const resource=await getResource(who.tenant,id);
 if(resource.kind!=='site'||resource.status==='deleted')throw new AppError('Site introuvable.',404,'site_not_found');
 return resource;
}
function summary(resource:Resource){
 const data=siteData(resource);
 return {...resource,slug:data.slug,files:data.files.map(file=>({path:file.path,size:file.size})),pages:data.files.filter(file=>/\.html?$/.test(file.path)).map(file=>file.path)};
}

const createInput=z.object({title:z.string().trim().min(1).max(120),name:z.string().trim().max(60).optional(),description:z.string().trim().max(300).optional()}).strict();
export async function createSite(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');await ensureSitesSchema();
 const p=createInput.parse(raw);
 let base:string;try{base=siteSlug(p.name||p.title);}catch(error){throw new AppError((error as Error).message,400,'site_name_invalid');}
 const resource=await createResource(who.tenant,'site',p.title,{slug:'',description:p.description,files:[]},'draft');
 // A unique public name is reserved now so the address never changes after publication.
 let slug='';for(let attempt=0;attempt<6&&!slug;attempt++){const candidate=attempt?`${base.slice(0,34)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0,5)}`:base;const row=await db().prepare('INSERT OR IGNORE INTO site_slugs(slug,resource_id,workspace_id,created_at) VALUES (?,?,?,?)').bind(candidate,resource.id,who.tenant,Date.now()).run();if(row.meta.changes)slug=candidate;}
 if(!slug)throw new AppError('Aucun nom de site disponible. Proposez un autre nom.',409,'site_name_taken');
 const saved=await updateResource(who.tenant,resource.id,resource.version,{data:{...siteData(resource),slug}});
 await auditLog(who.tenant,who.user.userId,'site.created',saved.id,{slug});
 return summary(saved);
}

const writeInput=z.object({siteId:z.string().min(1).max(80),path:z.string().min(1).max(160),content:z.string().max(SITE_LIMITS.fileBytes)}).strict();
export async function writeSiteFile(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const p=writeInput.parse(raw);let path:string;try{path=normalizeSitePath(p.path);}catch(error){throw new AppError((error as Error).message,400,'site_path_invalid');}
 if(!TEXT_EXTENSIONS.has(siteExtension(path)))throw new AppError('Les images et vidéos s’ajoutent avec import_site_asset (fichier de la bibliothèque).',400,'site_binary_needs_asset');
 const bytes=new TextEncoder().encode(p.content);if(bytes.length>SITE_LIMITS.fileBytes)throw new AppError('Fichier trop volumineux (512 Kio maximum) : découpez-le.',413,'site_file_too_large');
 return putFile(who,p.siteId,path,bytes);
}
async function putFile(who:BillingIdentity,siteId:string,path:string,bytes:Uint8Array){
 const resource=await siteResource(who,siteId),data=siteData(resource),others=data.files.filter(file=>file.path!==path);
 if(others.length+1>SITE_LIMITS.files)throw new AppError(`Un site compte au plus ${SITE_LIMITS.files} fichiers.`,413,'site_file_limit');
 if(others.reduce((n,file)=>n+file.size,0)+bytes.length>SITE_LIMITS.totalBytes)throw new AppError('Le site dépasse 3 Mio : allégez les images ou les scripts.',413,'site_size_limit');
 const file:SiteFile={path,size:bytes.length,sha256:await sha(bytes),mime:siteMime(path)};
 await bucket().put(draftKey(who.tenant,siteId,path),bytes,{httpMetadata:{contentType:file.mime}});
 const saved=await updateResource(who.tenant,siteId,resource.version,{data:{...data,files:[...others,file].sort((a,b)=>a.path.localeCompare(b.path))}});
 return {...summary(saved),written:path,size:bytes.length};
}

export async function importSiteAsset(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const p=z.object({siteId:z.string().min(1).max(80),fileId:z.string().min(1).max(80),path:z.string().min(1).max(160)}).strict().parse(raw);
 let path:string;try{path=normalizeSitePath(p.path);}catch(error){throw new AppError((error as Error).message,400,'site_path_invalid');}
 const row=await db().prepare("SELECT storage_key,size_bytes,detected_mime FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(p.fileId,who.tenant).first<{storage_key:string;size_bytes:number;detected_mime:string}>();
 if(!row)throw new AppError('Fichier introuvable dans la bibliothèque.',404);
 if(row.size_bytes>SITE_LIMITS.fileBytes*4)throw new AppError('Image trop lourde pour un site (2 Mio maximum) : compressez-la.',413,'site_file_too_large');
 const object=await bucket().get(row.storage_key);if(!object)throw new AppError('Fichier introuvable dans la bibliothèque.',404);
 const bytes=new Uint8Array(await object.arrayBuffer());
 const resource=await siteResource(who,p.siteId),data=siteData(resource),others=data.files.filter(file=>file.path!==path);
 if(others.reduce((n,file)=>n+file.size,0)+bytes.length>SITE_LIMITS.totalBytes+SITE_LIMITS.fileBytes*8)throw new AppError('Le site dépasse la taille autorisée avec ses images.',413,'site_size_limit');
 return putFile(who,p.siteId,path,bytes);
}

export async function readSiteFile(who:BillingIdentity,raw:unknown){
 const p=z.object({siteId:z.string().min(1).max(80),path:z.string().min(1).max(160)}).strict().parse(raw),resource=await siteResource(who,p.siteId);
 const path=normalizeSitePath(p.path),file=siteData(resource).files.find(item=>item.path===path);
 if(!file)throw new AppError(`Le fichier ${path} n’existe pas dans ce site.`,404,'site_file_missing');
 if(!TEXT_EXTENSIONS.has(siteExtension(path)))return {path,size:file.size,binary:true};
 const object=await bucket().get(draftKey(who.tenant,p.siteId,path));if(!object)throw new AppError('Fichier introuvable.',404);
 return {path,size:file.size,content:await object.text()};
}
export async function listSiteFiles(who:BillingIdentity,raw:unknown){
 const p=z.object({siteId:z.string().min(1).max(80)}).strict().parse(raw);
 const resource=await siteResource(who,p.siteId),publication=await sitePublication(who,p.siteId).catch(()=>null);
 return {...summary(resource),publication};
}
export async function deleteSiteFile(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const p=z.object({siteId:z.string().min(1).max(80),path:z.string().min(1).max(160)}).strict().parse(raw),resource=await siteResource(who,p.siteId),data=siteData(resource),path=normalizeSitePath(p.path);
 if(!data.files.some(file=>file.path===path))throw new AppError(`Le fichier ${path} n’existe pas dans ce site.`,404,'site_file_missing');
 await bucket().delete(draftKey(who.tenant,p.siteId,path));
 const saved=await updateResource(who.tenant,p.siteId,resource.version,{data:{...data,files:data.files.filter(file=>file.path!==path)}});
 return {...summary(saved),deleted:path};
}

// ---------- Automatic check with a real browser ----------
type CheckPage={on(event:string,handler:(value:unknown)=>void):void;route(url:string,handler:(route:{request():{url():string};fulfill(options:{status:number;headers?:Record<string,string>;body:Uint8Array|string}):Promise<void>})=>Promise<void>):Promise<void>;goto(url:string,options:{waitUntil:'load';timeout:number}):Promise<unknown>;setViewportSize(size:{width:number;height:number}):Promise<void>;evaluate<T>(fn:()=>T):Promise<T>};
type CheckBrowser={newPage():Promise<CheckPage>;close():Promise<void>};
type Launch=(endpoint:{fetch:typeof fetch})=>Promise<CheckBrowser>;
const CHECK_ORIGIN='https://site.braand.check';
export async function checkSite(who:BillingIdentity,raw:unknown,launch?:Launch){
 const p=z.object({siteId:z.string().min(1).max(80)}).strict().parse(raw),resource=await siteResource(who,p.siteId),data=siteData(resource);
 const pages=data.files.filter(file=>/\.html?$/.test(file.path));
 if(!pages.length)throw new AppError('Le site n’a encore aucune page HTML : commencez par index.html.',400,'site_empty');
 const issues:string[]=[],paths=new Set(data.files.map(file=>file.path));
 if(!paths.has('index.html'))issues.push('Aucune page d’accueil : créez index.html.');
 const texts=new Map<string,string>();
 for(const page of pages){const object=await bucket().get(draftKey(who.tenant,p.siteId,page.path));const html=object?await object.text():'';texts.set(page.path,html);
  if(!/<title>[^<]{2,}<\/title>/i.test(html))issues.push(`${page.path} : pas de titre de page (<title>).`);
  if(!/<meta[^>]+name=["']viewport["']/i.test(html))issues.push(`${page.path} : balise viewport manquante (affichage mobile).`);
  if((html.match(/<h1\b/gi)||[]).length!==1)issues.push(`${page.path} : il faut exactement un titre principal <h1>.`);
  for(const img of html.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi))issues.push(`${page.path} : image sans texte alternatif (${img[0].slice(0,60)}…).`);
  for(const ref of siteReferences(html,page.path)){const target=ref.path.endsWith('/')||!ref.path?ref.path+'index.html':ref.path;const candidates=siteExtension(target)?[target]:[target+'.html',target+'/index.html'];if(!candidates.some(candidate=>paths.has(candidate)))issues.push(`${page.path} : lien ou fichier introuvable « ${ref.raw} ».`);}
 }
 const binding=(config() as unknown as {BROWSER?:Fetcher}).BROWSER;
 let rendered=0;const consoleErrors:string[]=[];
 if(binding||launch){
  const start=launch||((await import('@cloudflare/playwright')).launch as unknown as Launch);
  const browser=await start(binding?{fetch:binding.fetch.bind(binding) as typeof fetch}:{fetch});
  try{
   const page=await browser.newPage();
   page.on('pageerror',error=>consoleErrors.push(String((error as Error)?.message||error).slice(0,200)));
   page.on('console',message=>{const m=message as {type():string;text():string};if(m.type()==='error')consoleErrors.push(m.text().slice(0,200));});
   // The site is served from memory: nothing leaves Braand during the check.
   await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==CHECK_ORIGIN){await route.fulfill({status:204,body:''});return;}
    const path=decodeURIComponent(url.pathname.slice(1))||'index.html',candidates=siteExtension(path)?[path]:[path+'.html',path+'/index.html'],found=candidates.find(candidate=>paths.has(candidate));
    if(!found){await route.fulfill({status:404,body:'Not found'});return;}
    const object=await bucket().get(draftKey(who.tenant,p.siteId,found));await route.fulfill({status:200,headers:{'content-type':siteMime(found)},body:object?new Uint8Array(await object.arrayBuffer()):''});});
   for(const file of pages.slice(0,SITE_LIMITS.pagesChecked)){
    for(const [label,size] of [['ordinateur',{width:1280,height:800}],['mobile',{width:390,height:844}]] as const){
     await page.setViewportSize(size);
     await page.goto(CHECK_ORIGIN+'/'+file.path,{waitUntil:'load',timeout:20000});
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
     if(overflow)issues.push(`${file.path} : déborde horizontalement sur ${label} (contenu trop large).`);
     rendered++;
    }
   }
  }finally{await browser.close().catch(()=>undefined);}
 }
 for(const error of [...new Set(consoleErrors)].slice(0,10))issues.push('Erreur JavaScript : '+error);
 const unique=[...new Set(issues)].slice(0,40);
 const result={siteId:p.siteId,version:resource.version,status:unique.length?'issues':'passed',pages:pages.length,files:data.files.length,renderedViews:rendered,browserChecked:rendered>0,issues:unique,
  check:unique.length?`${unique.length} point${unique.length>1?'s':''} à corriger`:`${pages.length} page${pages.length>1?'s':''} vérifiée${pages.length>1?'s':''}${rendered?' sur ordinateur et mobile':''}, aucun problème`};
 await auditLog(who.tenant,who.user.userId,'site.checked',p.siteId,{version:resource.version,status:result.status,issues:unique.length});
 return result;
}

// ---------- Preview and publication ----------
export async function sitePreviewUrl(who:BillingIdentity,siteId:string){
 await authorize(who.tenant,who.user.userId,'read');const resource=await siteResource(who,siteId),origin=await sitesOrigin();
 const token=hex(crypto.getRandomValues(new Uint8Array(24)).buffer);
 await db().batch([db().prepare('INSERT INTO site_preview_tokens(token,resource_id,workspace_id,expires_at) VALUES (?,?,?,?)').bind(token,resource.id,who.tenant,Date.now()+30*60000),db().prepare('DELETE FROM site_preview_tokens WHERE expires_at<?').bind(Date.now())]);
 return {url:`${origin}/__preview/${token}/`,expiresInMinutes:30};
}
async function entitlement(who:BillingIdentity,resourceId:string){
 const sub=await currentSubscription(who.organization),subscribed=!!sub,planSites=sub?PLANS[sub.plan as keyof typeof PLANS]?.sites:undefined;
 const live=await db().prepare("SELECT COUNT(*) n FROM site_publications WHERE organization_id=? AND status='published' AND resource_id!=?").bind(who.organization,resourceId).first<{n:number}>();
 const limit=subscribed?(planSites??SITE_LIMITS.paidSites):SITE_LIMITS.freeSites;
 if((live?.n||0)>=limit)throw new AppError(subscribed?`Votre offre permet ${limit} sites en ligne. Retirez-en un pour publier celui-ci.`:'Le compte gratuit permet 1 site en ligne. Retirez l’autre site ou passez à une offre payante pour en publier davantage.',402,'site_limit_reached');
 return {badge:!subscribed};
}
export async function sitePublication(who:BillingIdentity,siteId:string){
 await ensureSitesSchema();
 const row=await db().prepare('SELECT * FROM site_publications WHERE resource_id=? AND workspace_id=?').bind(siteId,who.tenant).first<Publication>();
 if(!row)return null;
 const origin=await sitesOrigin().catch(()=>null);
 return {id:row.id,status:row.status,version:row.resource_version,digest:row.digest,badge:!!row.badge,url:origin?`${origin}/${row.slug}/`:null};
}
const manifestDigest=async(data:SiteData,version:number)=>sha(new TextEncoder().encode(JSON.stringify({version,files:data.files.map(file=>[file.path,file.sha256])})));
/** Prepares the exact version the user will approve. Never publishes by itself. */
export async function prepareSitePublication(who:BillingIdentity,siteId:string,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');await ensureSitesSchema();
 const p=z.object({version:z.number().int().positive()}).parse(raw),resource=await siteResource(who,siteId),data=siteData(resource),origin=await sitesOrigin();
 if(resource.version!==p.version)throw new AppError('Le site a changé. Vérifiez la nouvelle version.',409,'stale_version');
 if(!data.files.some(file=>file.path==='index.html'))throw new AppError('Ajoutez une page d’accueil index.html avant de publier.',400,'site_no_index');
 const {badge}=await entitlement(who,siteId),digest=await manifestDigest(data,resource.version),now=Date.now();
 await db().prepare("INSERT INTO site_publications(id,workspace_id,organization_id,resource_id,slug,resource_version,digest,status,badge,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'awaiting_approval',?,?,?) ON CONFLICT(resource_id) DO UPDATE SET resource_version=excluded.resource_version,digest=excluded.digest,status=CASE WHEN site_publications.status='published' THEN 'published' ELSE 'awaiting_approval' END,badge=excluded.badge,updated_at=excluded.updated_at")
  .bind(uid(),who.tenant,who.organization,siteId,data.slug,resource.version,digest,badge?1:0,now,now).run();
 await auditLog(who.tenant,who.user.userId,'site.publication.prepared',siteId,{version:resource.version});
 return {siteId,version:resource.version,digest,url:`${origin}/${data.slug}/`,badge,files:data.files.length};
}
/** Called only from the signed-in user's explicit click (never by the model). */
export async function approveSitePublication(who:BillingIdentity,siteId:string,raw:unknown){
 await authorize(who.tenant,who.user.userId,'approve');await ensureSitesSchema();
 const p=z.object({version:z.number().int().positive(),digest:z.string().regex(/^[a-f0-9]{64}$/),approved:z.literal(true)}).parse(raw);
 const resource=await siteResource(who,siteId),data=siteData(resource);
 if(resource.version!==p.version||await manifestDigest(data,resource.version)!==p.digest)throw new AppError('Le site a changé depuis la préparation. Relancez la publication.',409,'stale_approval');
 const row=await db().prepare('SELECT * FROM site_publications WHERE resource_id=? AND workspace_id=?').bind(siteId,who.tenant).first<Publication>();
 if(!row||row.digest!==p.digest)throw new AppError('Cette approbation est expirée. Relancez la publication.',409,'stale_approval');
 await entitlement(who,siteId);
 // Copy the approved files to an immutable public folder, then switch the live version.
 for(const file of data.files){const object=await bucket().get(draftKey(who.tenant,siteId,file.path));if(!object)throw new AppError(`Le fichier ${file.path} est introuvable. Réessayez.`,409,'site_file_missing');await bucket().put(publicKey(data.slug,p.digest,file.path),await object.arrayBuffer(),{httpMetadata:{contentType:file.mime}});}
 const now=Date.now();
 await db().prepare("UPDATE site_publications SET status='published',live_digest=?,approved_by=?,approved_at=?,updated_at=? WHERE id=? AND digest=?").bind(p.digest,who.user.userId,now,now,row.id,p.digest).run();
 await auditLog(who.tenant,who.user.userId,'site.publication.approved',siteId,{version:resource.version,digest:p.digest});
 return sitePublication(who,siteId);
}
export async function suspendSitePublication(who:BillingIdentity,siteId:string){
 await authorize(who.tenant,who.user.userId,'approve');await ensureSitesSchema();await siteResource(who,siteId);
 await db().prepare("UPDATE site_publications SET status='suspended',updated_at=? WHERE resource_id=? AND workspace_id=?").bind(Date.now(),siteId,who.tenant).run();
 await auditLog(who.tenant,who.user.userId,'site.publication.suspended',siteId,{});
 return sitePublication(who,siteId);
}
export async function siteLeads(who:BillingIdentity,siteId:string){
 await authorize(who.tenant,who.user.userId,'read');await ensureSitesSchema();
 return (await db().prepare('SELECT l.id,l.name,l.email,l.message,l.created_at FROM site_leads l JOIN site_publications p ON p.id=l.publication_id WHERE p.resource_id=? AND l.workspace_id=? ORDER BY l.created_at DESC LIMIT 100').bind(siteId,who.tenant).all()).results;
}
