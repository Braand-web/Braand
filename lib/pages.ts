import {escapeHTML} from "./core.mjs";
import {pageSchema} from "./contracts";
import {z} from "zod";
import {db,config,uid,getResource,authorize} from "./server";
import {currentSubscription,type BillingIdentity} from "./billing";
import {AppError} from "./core.mjs";

const formSchema=z.object({enabled:z.boolean(),privacyUrl:z.string().url().refine(v=>v.startsWith('https://'))});
const publicationSchema=z.object({page:pageSchema,form:formSchema.optional()});
type Publication={id:string;workspace_id:string;organization_id:string;resource_id:string;resource_version:number;snapshot:string;digest:string;status:string};
export function pagesOrigin(){
 const raw=config().PAGES_ORIGIN;if(!raw)throw new AppError('L’hébergement public des pages n’est pas configuré.',503,'pages_not_configured');
 const url=new URL(raw),local=config().BRAAND_DEVELOPMENT==='true'&&['127.0.0.1','localhost'].includes(url.hostname);
 if((url.protocol!=='https:'&&!local)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new AppError('Origine publique des pages invalide.',503,'pages_not_configured');
 return url.origin;
}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function canHostPage(organization:string,workspace:string){const sub=await currentSubscription(organization);if(!sub)return false;if(sub.plan==='business'||sub.plan==='enterprise')return true;const owner=await db().prepare('SELECT owner_id FROM organizations WHERE id=?').bind(organization).first<{owner_id:string}>();return owner?.owner_id===workspace;}
async function pageEntitlement(organization:string,workspace:string){if(!await canHostPage(organization,workspace))throw new AppError('La publication de cet espace nécessite un abonnement actif adapté.',403,'page_subscription_required');}
function publicUrl(id:string){return pagesOrigin()+'/api/published/'+encodeURIComponent(id);}
async function publicationAudit(who:BillingIdentity,action:string,id:string){await db().prepare('INSERT INTO audit(id,workspace_id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?,?)').bind(uid(),who.tenant,who.user.userId,action,id,'{}',Date.now()).run();}
export async function pagePublication(who:BillingIdentity,id:string){
 const resource=await getResource(who.tenant,id);if(resource.kind!=='page'||resource.status==='deleted')throw new AppError('Page introuvable.',404);
 const p=await db().prepare('SELECT id,status,resource_version,digest,approved_at FROM page_publications WHERE resource_id=? AND workspace_id=?').bind(id,who.tenant).first<Pick<Publication,'id'|'status'|'resource_version'|'digest'>>();
 return p?{...p,url:publicUrl(p.id)}:null;
}
export async function pageLeads(who:BillingIdentity,id:string,cursor?:string){
 await authorize(who.tenant,who.user.userId,'read');const page=await getResource(who.tenant,id);if(page.kind!=='page')throw new AppError('Page introuvable.',404);
 const publication=await db().prepare('SELECT id FROM page_publications WHERE resource_id=? AND workspace_id=?').bind(id,who.tenant).first<{id:string}>();if(!publication)return {items:[],nextCursor:null};
 let after:{created_at:number;id:string}|null=null;
 if(cursor){after=await db().prepare('SELECT created_at,id FROM page_leads WHERE id=? AND publication_id=? AND workspace_id=?').bind(cursor,publication.id,who.tenant).first();if(!after)throw new AppError('Curseur invalide.',400);}
 const rows=await db().prepare('SELECT id,name,email,message,created_at FROM page_leads WHERE publication_id=? AND workspace_id=?'+(after?' AND (created_at<? OR (created_at=? AND id<?))':'')+' ORDER BY created_at DESC,id DESC LIMIT 101').bind(publication.id,who.tenant,...(after?[after.created_at,after.created_at,after.id]:[])).all<{id:string;name:string;email:string;message:string;created_at:number}>();
 return {items:rows.results.slice(0,100),nextCursor:rows.results.length>100?rows.results[99].id:null};
}
export async function preparePagePublication(who:BillingIdentity,id:string,input:unknown){
 await authorize(who.tenant,who.user.userId,'write');await pageEntitlement(who.organization,who.tenant);const origin=pagesOrigin();
 const p=z.object({version:z.number().int().positive(),form:formSchema.optional()}).parse(input),resource=await getResource(who.tenant,id);
 if(resource.kind!=='page'||resource.status==='deleted')throw new AppError('Page introuvable.',404);
 if(resource.version!==p.version)throw new AppError('La page a changé. Vérifiez la nouvelle version.',409,'stale_version');
 const active=await db().prepare("SELECT status FROM page_publications WHERE resource_id=? AND workspace_id=?").bind(id,who.tenant).first<{status:string}>();
 if(active?.status==='published')throw new AppError('Retirez explicitement la version publique avant de préparer son remplacement.',409,'page_suspend_before_replacement');
 if(p.form?.enabled&&(config().PAGE_FORM_SECRET||'').length<32)throw new AppError('La protection des formulaires n’est pas configurée.',503,'page_form_not_configured');
 const snapshot=JSON.stringify(publicationSchema.parse({page:resource.data.current,form:p.form})),hash=await digest(snapshot),now=Date.now(),publicationId=uid();
 // A replacement cannot implicitly unpublish a live version; the owner must suspend it first.
 await db().prepare("INSERT INTO page_publications(id,workspace_id,organization_id,resource_id,resource_version,snapshot,digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'awaiting_approval',?,?) ON CONFLICT(resource_id) DO UPDATE SET resource_version=excluded.resource_version,snapshot=excluded.snapshot,digest=excluded.digest,status='awaiting_approval',approved_by=NULL,approved_at=NULL,updated_at=excluded.updated_at").bind(publicationId,who.tenant,who.organization,id,p.version,snapshot,hash,now,now).run();
 const result=await pagePublication(who,id);await publicationAudit(who,'page.publication.prepared',id);
 return {...result,approval:{version:p.version,digest:hash,publicOrigin:origin,formEnabled:p.form?.enabled===true},html:renderPublishedPage(snapshot,result!.id)};
}
export async function approvePagePublication(who:BillingIdentity,id:string,input:unknown,requestOrigin:string){
 await authorize(who.tenant,who.user.userId,'approve');await pageEntitlement(who.organization,who.tenant);
 if(pagesOrigin()===requestOrigin)throw new AppError('Utilisez une origine distincte pour les pages publiques.',503,'page_origin_not_isolated');
 const p=z.object({version:z.number().int().positive(),digest:z.string().regex(/^[a-f0-9]{64}$/),approved:z.literal(true)}).parse(input);
 const now=Date.now(),result=await db().prepare("UPDATE page_publications SET status='published',approved_by=?,approved_at=?,updated_at=? WHERE resource_id=? AND workspace_id=? AND resource_version=? AND digest=? AND status='awaiting_approval' AND EXISTS(SELECT 1 FROM resources r WHERE r.id=page_publications.resource_id AND r.version=page_publications.resource_version AND r.status!='deleted')").bind(who.user.userId,now,now,id,who.tenant,p.version,p.digest).run();
 if(!result.meta.changes)throw new AppError('Cette approbation est expirée ou ne correspond pas à la page.',409,'stale_approval');
 await publicationAudit(who,'page.publication.approved',id);return pagePublication(who,id);
}
export async function suspendPagePublication(who:BillingIdentity,id:string){await authorize(who.tenant,who.user.userId,'approve');await getResource(who.tenant,id);await db().prepare("UPDATE page_publications SET status='suspended',updated_at=? WHERE resource_id=? AND workspace_id=?").bind(Date.now(),id,who.tenant).run();await publicationAudit(who,'page.publication.suspended',id);return {suspended:true};}
function publicHeaders(){return {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};}
export function renderPublishedPage(snapshot:string,id:string){const {page,form}=publicationSchema.parse(JSON.parse(snapshot));let html=renderPage(page);if(form?.enabled)html=html.replace('</main>','<section><h2>Contactez-nous</h2><form method="post" action="/api/published/'+encodeURIComponent(id)+'"><label>Nom<input name="name" maxlength="160" required></label><label>E-mail<input name="email" type="email" maxlength="254" required></label><label>Votre demande<textarea name="message" maxlength="3000" required></textarea></label><input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="display:none"><label><input type="checkbox" name="consent" value="yes" required> J’accepte la <a href="'+escapeHTML(form.privacyUrl)+'">politique de confidentialité</a>.</label><button type="submit">Envoyer</button></form></section></main>');return html;}
async function visiblePublication(request:Request,id:string){if(new URL(request.url).origin!==pagesOrigin())throw new AppError('Page introuvable.',404);const p=await db().prepare("SELECT p.* FROM page_publications p JOIN resources r ON r.id=p.resource_id WHERE p.id=? AND p.status='published' AND r.status!='deleted'").bind(id).first<Publication>();if(!p||!await canHostPage(p.organization_id,p.workspace_id))throw new AppError('Page introuvable.',404);return p;}
export async function servePublishedPage(request:Request,id:string){const p=await visiblePublication(request,id);return new Response(renderPublishedPage(p.snapshot,p.id),{headers:publicHeaders()});}
export async function submitPageLead(request:Request,id:string){
 const p=await visiblePublication(request,id),snapshot=publicationSchema.parse(JSON.parse(p.snapshot));if(!snapshot.form?.enabled)throw new AppError('Formulaire indisponible.',404);
 if(request.headers.get('origin')!==pagesOrigin())throw new AppError('Origine non autorisée.',403);
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new AppError('Format de formulaire invalide.',415);
 const length=Number(request.headers.get('content-length')||0);if(length>8192)throw new AppError('Formulaire trop volumineux.',413);
 const body=await request.text();if(new TextEncoder().encode(body).length>8192)throw new AppError('Formulaire trop volumineux.',413);
 const form=new URLSearchParams(body);if(form.get('website'))throw new AppError('Envoi refusé.',400);
 const fields=z.object({name:z.string().trim().min(1).max(160),email:z.string().trim().email().max(254),message:z.string().trim().min(1).max(3000),consent:z.literal('yes')}).parse(Object.fromEntries(form));
 const secret=config().PAGE_FORM_SECRET;if(!secret||secret.length<32)throw new AppError('Protection du formulaire indisponible.',503);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const address=request.headers.get('cf-connecting-ip')||(config().BRAAND_DEVELOPMENT==='true'?'local':null);if(!address)throw new AppError('Protection du formulaire indisponible.',503);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(p.id+':'+address)),hash=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,'0')).join(''),now=Date.now(),bucket=Math.floor(now/3600000);
 const count=await db().prepare('INSERT INTO page_form_limits(key,bucket,count) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 WHERE count<5').bind(hash,bucket).run();if(!count.meta.changes)throw new AppError('Trop de demandes. Réessayez plus tard.',429);
 await db().batch([db().prepare('INSERT INTO page_leads VALUES (?,?,?,?,?,?,?)').bind(uid(),p.id,p.workspace_id,fields.name,fields.email,fields.message,now),db().prepare('DELETE FROM page_form_limits WHERE bucket<?').bind(bucket-48)]);
 return new Response('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Demande reçue</title><p>Votre demande a été enregistrée.</p></html>',{status:201,headers:publicHeaders()});
}
export function renderPage(input:unknown){
 const p=pageSchema.parse(input),e=escapeHTML;
 return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="'+(p.noindex?'noindex,nofollow':'index,follow')+'"><title>'+e(p.title)+'</title><meta name="description" content="'+e(p.description)+'"><style>body{margin:0;font-family:system-ui,sans-serif;background:#fafaf8;color:#1c2425}main{max-width:900px;margin:auto;padding:50px 24px}section{padding:48px 0;border-bottom:1px solid #ddd}h1{font-size:clamp(36px,6vw,62px);line-height:1.1;letter-spacing:-.04em}h2{font-size:28px}p,li{font-size:18px;line-height:1.7;white-space:pre-line}a{display:inline-block;background:'+p.accent+';color:#fff;border-radius:12px;padding:16px 24px;text-decoration:none;font-weight:600}</style></head><body><main>'+p.sections.map((s,i)=>'<section><'+(i===0?'h1':'h2')+'>'+e(s.heading)+'</'+(i===0?'h1':'h2')+'><p>'+e(s.body)+'</p>'+(s.items?'<ul>'+s.items.map(v=>'<li>'+e(v)+'</li>').join("")+'</ul>':'')+(s.type==="hero"||s.type==="cta"?'<a rel="noopener noreferrer" href="'+e(p.cta.url)+'">'+e(p.cta.label)+'</a>':'')+'</section>').join("")+'</main></body></html>';
}

