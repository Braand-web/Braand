import {z} from "zod";
import {AppError,validateMediaInput} from "./core.mjs";
import {config,db,unseal} from "./server";
import {MEDIA_TASKS,chooseMediaRoute} from './media-routing.mjs';
import {approvedCatalogItems} from './fal-models';
const catalogItem=z.object({id:z.string().regex(/^[a-zA-Z0-9/._-]+$/),name:z.string(),kind:z.enum(["image","video","audio"]),credits:z.number().int().positive(),costCeilingXaf:z.number().positive().optional(),verifiedAt:z.string().datetime().optional(),inputSchema:z.record(z.unknown()),description:z.string(),tasks:z.array(z.string().refine(value=>Object.hasOwn(MEDIA_TASKS,value))).max(7).optional(),priority:z.number().int().min(0).max(1000).optional()});
export function falCatalog(){let base:z.infer<typeof catalogItem>[];try{base=z.array(catalogItem).max(50).parse(JSON.parse(config().FAL_CATALOG_JSON||"[]"));}catch{throw new AppError("Catalogue média invalide. Contactez l’administrateur.",503);}
 // Administrator-approved models complete the configured catalog; configured entries win.
 if(config().FAL_GENERATION_ENABLED==='false')return base;const ids=new Set(base.map(item=>item.id));return [...base,...approvedCatalogItems().filter(item=>!ids.has(item.id)).map(item=>catalogItem.parse(item))];}
export function falAvailability(){const c=config();return !c.FAL_KEY?{ready:false,reason:'configuration_pending'}:c.FAL_GENERATION_ENABLED==='false'?{ready:false,reason:c.FAL_ACCOUNT_STATUS==='needs_funding'?'provider_funding_required':'activation_pending'}:{ready:true,reason:null};}
export function assertFalReady(){const state=falAvailability();if(!state.ready)throw new AppError(state.reason==='provider_funding_required'?'Le compte fournisseur Fal doit être crédité avant la génération. Votre demande peut rester en brouillon.':'La génération média attend sa configuration ou son activation.',503,'fal_not_ready');}
export function mediaRoute(task:string,input:Record<string,unknown>,maxCredits?:number){assertFalReady();return chooseMediaRoute(falCatalog(),task,input,maxCredits) as z.infer<typeof catalogItem>;}
export async function metaToken(tenant:string){
 const row=await db().prepare("SELECT encrypted_token,expires_at FROM connections WHERE workspace_id=? AND provider='meta'").bind(tenant).first<{encrypted_token:string;expires_at:number}>();
 if(!row)throw new AppError("Connectez Meta for Business pour continuer.",412,"meta_not_connected");
 if(row.expires_at&&row.expires_at<Date.now())throw new AppError("La connexion Meta a expiré.",412,"meta_expired");return unseal(row.encrypted_token);
}
export async function metaGet(tenant:string,path:string,params:Record<string,string>={}){
 const version=config().META_GRAPH_VERSION;if(!version||!/^v\d+\.\d+$/.test(version))throw new AppError("Version de l’API Meta à configurer.",503);
 const url=new URL("https://graph.facebook.com/"+version+"/"+path);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const response=await fetch(url,{headers:{Authorization:"Bearer "+await metaToken(tenant)},signal:AbortSignal.timeout(20000)});
 const data:unknown=await response.json();if(!response.ok)throw new AppError("Meta refuse cette lecture. Vérifiez les droits et l’état du compte.",response.status===401?412:502,"meta_error");return z.record(z.unknown()).parse(data);
}
export async function submitFal(model:string,input:Record<string,unknown>){
 assertFalReady();
 const item=falCatalog().find(m=>m.id===model);if(!item)throw new AppError("Modèle non validé dans le catalogue.",403);
 validateMediaInput(input,item.inputSchema);
 const key=config().FAL_KEY;if(!key)throw new AppError("Génération média non configurée.",503);
 // URLs can only be passed to fal. No arbitrary server-side URL fetch.
 const response=await fetch("https://queue.fal.run/"+model,{method:"POST",headers:{Authorization:"Key "+key,"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(25000)});
 const data:unknown=await response.json();if(!response.ok)throw new AppError("fal.ai n’a pas accepté la génération.",502,response.status>=500?'uncertain_result':'fal_rejected');const submitted=z.object({request_id:z.string().min(1)}).safeParse(data);if(!submitted.success)throw new AppError("Réponse média incertaine.",502,"uncertain_result");return submitted.data.request_id;
}
export async function falResult(model:string,id:string){
 const key=config().FAL_KEY;if(!key)throw new AppError("Génération média non configurée.",503);
 const root=model.split("/").slice(0,2).join("/");
 const endpoint="https://queue.fal.run/"+root+"/requests/"+encodeURIComponent(id);
 const headers={Authorization:"Key "+key};
 const response=await fetch(endpoint+"/status",{headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new AppError("Le fournisseur média ne répond pas.",502);
 const state=z.object({status:z.string()}).parse(await response.json());if(state.status!=="COMPLETED")return {status:state.status};
 const result=await fetch(endpoint,{headers,signal:AbortSignal.timeout(20000)});
 if(!result.ok)throw new AppError("Le résultat média est indisponible.",502);
 const output:unknown=await result.json();return {status:"COMPLETED",output};
}

