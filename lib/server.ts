import {modelRateEnvironment} from "./model-rate-refresh";
import {withRoutingDefaults} from './model-routing-defaults';
import {falRateEnvironment} from './fal-rate-refresh';
import {env} from "cloudflare:workers";
import {getBraandUser} from "@/app/auth";
import {AppError} from "./core.mjs";
import type {FileRecord,Resource} from "./contracts";
import {safeResourceDto,safeFileDto} from "./file-policy.mjs";
const LEGACY_WORKSPACE_COOKIE = ["ai", "ra", "_workspace"].join("");
export const config=()=>falRateEnvironment(modelRateEnvironment(withRoutingDefaults(env))) as Cloudflare.Env & Record<string,string|undefined>;
export function db(){if(!env.DB)throw new AppError("Stockage indisponible.",503,"storage_unavailable");return env.DB;}
export const uid=()=>crypto.randomUUID();
export type StoredResource=Omit<Resource,'data'>&{data:string};
export async function identity(request?:Request,action?:string){
 if(request&&request.method!=="GET"){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new AppError("Origine non autorisée.",403);}
 const user=await getBraandUser();if(!user)throw new AppError("Connectez-vous pour enregistrer votre travail.",401,"authentication_required");
 // A suspended account (administration) cannot use Braand. Missing table = nobody suspended.
 // Both reads run together: each database trip costs time for distant users.
 const [blocked,personal]=await Promise.all([
  db().prepare("SELECT 1 x FROM account_blocks WHERE user_id=?").bind(user.userId).first().catch(()=>null),
  db().prepare("SELECT (SELECT COUNT(*) FROM organizations WHERE id=?)+(SELECT COUNT(*) FROM organization_members WHERE organization_id=? AND user_id=?)+(SELECT COUNT(*) FROM workspaces WHERE id=?)+(SELECT COUNT(*) FROM members WHERE workspace_id=? AND user_id=?) n").bind(user.userId,user.userId,user.userId,user.userId,user.userId,user.userId).first<{n:number}>(),
 ]);
 if(blocked)throw new AppError("Ce compte est suspendu. Contactez le support Braand.",403,"account_suspended");
 // The personal space is created once, not rewritten on every request.
 const now=Date.now();if(Number(personal?.n)<4)await db().batch([
 db().prepare("INSERT OR IGNORE INTO organizations(id,name,owner_id,created_at) VALUES (?,?,?,?)").bind(user.userId,"Mon entreprise",user.userId,now),
 db().prepare("INSERT OR IGNORE INTO organization_members(organization_id,user_id,role) VALUES (?,?,'owner')").bind(user.userId,user.userId),
 db().prepare("INSERT OR IGNORE INTO workspaces (id,name,created_at,organization_id) VALUES (?,?,?,?)").bind(user.userId,"Mon entreprise",now,user.userId),
 db().prepare("INSERT OR IGNORE INTO members (id,workspace_id,user_id,role) VALUES (?,?,?,'owner')").bind(user.userId,user.userId,user.userId)]);
 const cookies=request?.headers.get('cookie')?.split(';').map(x=>x.trim())||[];
 const cookie=cookies.find(x=>x.startsWith('braand_workspace='))?.slice('braand_workspace='.length)||cookies.find(x=>x.startsWith(LEGACY_WORKSPACE_COOKIE+'='))?.slice(LEGACY_WORKSPACE_COOKIE.length+1);
 const tenant=request?.headers.get('x-braand-workspace')||(cookie?decodeURIComponent(cookie):user.userId);
 const access=await authorize(tenant,user.userId,action||(request&& !['GET','HEAD'].includes(request.method)?'write':'read'));
 return {user,tenant,organization:access.organization_id,role:access.role};
}
export async function fileIdentity(request:Request){
 try{return await identity(request);}
 catch(error){if(error instanceof AppError&&error.status===403)throw new AppError("Fichier introuvable.",404,"file_not_found");throw error;}
}
export async function authorize(tenant:string,userId:string,action='read'){
 const row=await db().prepare("SELECT w.organization_id,om.role,o.owner_id FROM workspaces w JOIN organizations o ON o.id=w.organization_id JOIN organization_members om ON om.organization_id=o.id AND om.user_id=? AND om.active=1 WHERE w.id=? AND (om.role='owner' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=om.user_id))").bind(userId,tenant).first<{organization_id:string;role:string;owner_id:string}>();
 if(!row)throw new AppError('Accès à cet espace non autorisé.',403);
 if(row.role==='owner'&&tenant!==row.owner_id&&action!=='read'){
 const business=await db().prepare("SELECT id FROM billing_subscriptions WHERE organization_id=? AND plan IN ('business','enterprise') AND status='active' AND start_at<=? AND end_at>?").bind(row.organization_id,Date.now(),Date.now()).first();
 if(!business)throw new AppError('Cet espace est en lecture seule. Un forfait Business ou Entreprise actif est nécessaire.',403);
 }
 if(row.role!=='owner'){
 const sub=await db().prepare("SELECT id FROM billing_subscriptions WHERE organization_id=? AND plan IN ('business','enterprise') AND status='active' AND start_at<=? AND end_at>?").bind(row.organization_id,Date.now(),Date.now()).first();
 if(!sub)throw new AppError('Les fonctions d’équipe nécessitent un abonnement Business ou Entreprise actif.',403);
 }
 const {roleAllows}=await import('./billing-core.mjs');if(!roleAllows(row.role,action))throw new AppError('Votre rôle ne permet pas cette action.',403);
 return row;
}
export async function list(tenant:string,kind?:string){
 const query=kind?"SELECT * FROM resources WHERE workspace_id=? AND kind=? AND status!='deleted' ORDER BY updated_at DESC LIMIT 200":"SELECT * FROM resources WHERE workspace_id=? AND status!='deleted' ORDER BY updated_at DESC LIMIT 300";
 const result=await db().prepare(query).bind(...(kind?[tenant,kind]:[tenant])).all<StoredResource>();const resources=result.results.map(decode);
 const fileIds=resources.filter(resource=>resource.kind==="file").map(resource=>resource.id);if(!fileIds.length)return resources.map(safeResourceDto) as Resource[];
 const placeholders=fileIds.map(()=>"?").join(","),files=await db().prepare(`SELECT * FROM files WHERE workspace_id=? AND id IN (${placeholders})`).bind(tenant,...fileIds).all<FileRecord>(),byId=new Map(files.results.map(file=>[file.id,file]));
 return resources.map(resource=>{const file=resource.kind==="file"?byId.get(resource.id):undefined;if(!file)return safeResourceDto(resource) as Resource;const safe=safeFileDto(file);return {...resource,title:safe.name,status:file.status,data:{mime:safe.mime,size:safe.size,thumbnailAvailable:!!file.thumbnail_key}};});
}
export function decode(row:StoredResource):Resource{const data:unknown=JSON.parse(row.data||"{}");if(!data||typeof data!=="object"||Array.isArray(data))throw new AppError("Données de l’élément invalides.",500,"resource_data_invalid");return {...row,data:data as Record<string,unknown>};}
export async function getResource(tenant:string,id:string){
 const row=await db().prepare("SELECT * FROM resources WHERE id=? AND workspace_id=?").bind(id,tenant).first<StoredResource>();if(!row)throw new AppError("Élément introuvable.",404);return decode(row);
}
export async function getClientResource(tenant:string,id:string){
 const resource=await getResource(tenant,id);if(resource.kind!=="file")return safeResourceDto(resource);
 const file=await db().prepare("SELECT * FROM files WHERE id=? AND workspace_id=?").bind(id,tenant).first<FileRecord>();if(!file)return safeResourceDto(resource);
 const safe=safeFileDto(file);return {...resource,title:safe.name,status:file.status,data:{mime:safe.mime,size:safe.size,thumbnailAvailable:!!file.thumbnail_key}};
}
export async function getFile(tenant:string,id:string){
 const row=await db().prepare("SELECT * FROM files WHERE id=? AND workspace_id=? AND status!='deleted'").bind(id,tenant).first<FileRecord>();
 if(!row)throw new AppError("Fichier introuvable.",404,"file_not_found");
 return {record:row,public:safeFileDto(row)};
}
export async function createResource(tenant:string,kind:string,title:string,data:unknown={},status="draft"){
 const id=uid(),now=Date.now();await db().prepare("INSERT INTO resources (id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,tenant,kind,title,JSON.stringify(data),status,now,now).run();return getResource(tenant,id);
}
export async function updateResource(tenant:string,id:string,version:number,patch:{title?:string;data?:unknown;status?:string}){
 const current=await getResource(tenant,id);const result=await db().prepare("UPDATE resources SET title=?,data=?,status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?").bind(patch.title??current.title,JSON.stringify(patch.data??current.data),patch.status??current.status,Date.now(),id,tenant,version).run();
 if(!result.meta.changes)throw new AppError("La version a changé. Actualisez avant de continuer.",409,"stale_version");return getResource(tenant,id);
}
export async function auditLog(tenant:string,actor:string,action:string,target:string,detail:unknown={}){
 if(typeof actor!=="string"||!actor.trim())throw new AppError("Acteur du journal d’audit requis.",500,"audit_actor_missing");
 await db().prepare("INSERT INTO audit (id,workspace_id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?,?)").bind(uid(),tenant,actor,action,target,JSON.stringify(detail),Date.now()).run();
}
export function failure(error:unknown){
 const detail=String(error);
 for(const [code,message] of [['project_quota','Le nombre de projets actifs de votre forfait est atteint.'],['concurrency_limit','Une mission est déjà en cours. Réessayez après sa fin.'],['storage_quota','Votre espace de stockage est plein. Exportez ou supprimez des fichiers.'],['transfer_quota','La limite de transfert est atteinte. Contactez le support pour un export assisté.']])if(detail.includes(code))return Response.json({error:message,code},{status:409});
 if(error instanceof SyntaxError)return Response.json({error:"Le corps de la requête doit être un JSON valide.",code:"validation_error"},{status:400});
 if(error instanceof AppError)return Response.json({error:error.message,code:error.code},{status:error.status});
 if(error&&typeof error==="object"&&"issues" in error)return Response.json({error:"Informations incomplètes ou invalides.",code:"validation_error"},{status:400});
 console.error("Request failed",error instanceof Error?error.name:"unknown");return Response.json({error:"L’opération n’a pas abouti. Réessayez ou contactez le support.",code:"internal_error"},{status:500});
}
export async function seal(value:string){
 const key=config().TOKEN_ENCRYPTION_KEY;if(!key)throw new AppError("Chiffrement des connexions non configuré.",503);
 const raw=Uint8Array.from(atob(key),c=>c.charCodeAt(0)),k=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,new TextEncoder().encode(value));return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}
export async function unseal(value:string){
 const key=config().TOKEN_ENCRYPTION_KEY;if(!key)throw new AppError("Chiffrement indisponible.",503);
 const [iv,cipher]=value.split("."),raw=Uint8Array.from(atob(key),c=>c.charCodeAt(0)),k=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},k,Uint8Array.from(atob(cipher),c=>c.charCodeAt(0))));
}

