import {operationHiddenFrom,privateOperationKinds} from '@/lib/agent-operation-visibility';
import {memoryOwnedByOther} from '@/lib/agent-memory';
import {privateJSON} from '@/lib/private-json';
import {z} from "zod";
import {identity,getResource,getClientResource,updateResource,failure,auditLog,db} from "@/lib/server";
import {skillHiddenFrom} from "@/lib/skill-visibility.mjs";
import {AppError} from "@/lib/core.mjs";
import {pageSchema} from "@/lib/contracts";
import {campaignBriefSchema,reviseCampaignBrief} from '@/lib/campaign-brief';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{const {tenant,user}=await identity(request);const resource=await getClientResource(tenant,(await context.params).id);if(operationHiddenFrom(resource,user.userId)||(resource.kind==='knowledge'&&memoryOwnedByOther(resource.data,user.userId)))throw new AppError("Élément introuvable.",404);if(resource.kind==="connector_action"&&resource.data.requester!==user.userId)throw new AppError("Élément introuvable.",404);if(resource.kind==="skill"&&skillHiddenFrom(resource.data,user.userId))throw new AppError("Élément introuvable.",404);return Response.json(resource);}catch(error){return failure(error);}}
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){try{
 const {tenant,user}=await identity(request),{id}=await context.params,resource=await getResource(tenant,id);if(operationHiddenFrom(resource,user.userId)||privateOperationKinds.has(resource.kind)||(resource.kind==='knowledge'&&memoryOwnedByOther(resource.data,user.userId)))throw new AppError("Utilisez les commandes versionnées de cet élément.",403);if(resource.status==="deleted")throw new AppError("Élément introuvable.",404);
 const p=z.object({version:z.number().int(),action:z.enum(["rename","restore","suspend","cancel","campaign_brief","pin","unpin","mark_unread","mark_read","archive","unarchive","delete"]),title:z.string().trim().min(1).max(160).optional(),historyVersion:z.number().int().optional(),brief:campaignBriefSchema.optional()}).parse(await privateJSON(request,1048576));
 if(p.action==='campaign_brief'){
  if(!p.brief)throw new AppError('Brief de campagne requis.');
  await reviseCampaignBrief(tenant,id,p.version,p.brief,p.title);await auditLog(tenant,user.userId,'campaign.brief.update',id,{version:p.version});return Response.json(await getClientResource(tenant,id));
 }
 let patch:Parameters<typeof updateResource>[3]={};
 if(p.action==="rename"){if(!p.title)throw new AppError("Nom requis.");patch={title:p.title};}
 else if(["pin","unpin","mark_unread","mark_read","archive","unarchive","delete"].includes(p.action)){
  if(resource.kind!=="conversation")throw new AppError("Action réservée aux discussions.");
  if(resource.status==="streaming"&&(p.action==="archive"||p.action==="delete"))throw new AppError("Attendez la fin de la réponse avant de modifier cette discussion.",409);
  const current=resource.data.sidebar&&typeof resource.data.sidebar==="object"&&!Array.isArray(resource.data.sidebar)?resource.data.sidebar as Record<string,unknown>:{};
  if(p.action==="delete")patch={status:"deleted"};
  else patch={data:{...resource.data,sidebar:{...current,...(p.action==="pin"?{pinned:true}:{}),...(p.action==="unpin"?{pinned:false}:{}),...(p.action==="mark_unread"?{unread:true}:{}),...(p.action==="mark_read"?{unread:false}:{}),...(p.action==="archive"?{archived:true}:{}),...(p.action==="unarchive"?{archived:false}:{})}}};
 }
 else if(p.action==="restore"){if(resource.kind!=="page")throw new AppError("Page requise.");const history=z.array(z.object({version:z.number().int(),page:pageSchema,at:z.number().optional()})).parse(resource.data.history??[]);const old=history.find(h=>h.version===p.historyVersion);if(!old)throw new AppError("Version introuvable.");patch={data:{current:old.page,history:[...history,{version:resource.version,page:pageSchema.parse(resource.data.current),at:Date.now()}].slice(-30)}};}
 else {if(resource.kind!=="mission")throw new AppError("Mission requise.");if(["completed","cancelled"].includes(resource.status))throw new AppError("Cette mission est terminée.",409);patch={status:p.action==="suspend"?"suspended":"cancelled"};}
 await updateResource(tenant,id,p.version,patch);if(resource.kind==="file"&&p.action==="rename"&&p.title)await db().prepare("UPDATE files SET display_name=?,updated_at=? WHERE id=? AND workspace_id=?").bind(p.title,Date.now(),id,tenant).run();await auditLog(tenant,user.userId,p.action,id,{version:p.version});return Response.json(await getClientResource(tenant,id));
 }catch(error){return failure(error);}}

