import {privateJSON} from '@/lib/private-json';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {db,failure,config,auditLog} from '@/lib/server';
import {requireOperationsAdmin} from '@/lib/operations';
import {approveFalModel,approvedModels,ensureApprovedFalModels,removeFalModel,searchFalModels} from '@/lib/fal-models';
import {MEDIA_TASKS} from '@/lib/media-routing.mjs';

const bindings=()=>({...(env as unknown as Record<string,unknown>),FAL_KEY:config().FAL_KEY});

export async function GET(request:Request){try{
 await requireOperationsAdmin(request);await ensureApprovedFalModels(bindings());
 const query=new URL(request.url).searchParams.get('q');
 const requests=await db().prepare("SELECT id,workspace_id,title,data,status,created_at FROM resources WHERE kind='model_request' AND status='awaiting_admin' ORDER BY created_at DESC LIMIT 50").all<{id:string;workspace_id:string;title:string;data:string;status:string;created_at:number}>();
 return Response.json({tasks:Object.keys(MEDIA_TASKS),approved:approvedModels(),requests:requests.results.map(row=>({...row,data:JSON.parse(row.data||'{}')})),search:query?await searchFalModels(config().FAL_KEY,query):undefined},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return failure(error);}}

export async function POST(request:Request){try{
 const who=await requireOperationsAdmin(request),body=z.object({action:z.enum(['approve','remove','reject']),model:z.record(z.unknown()).optional(),id:z.string().max(180).optional(),requestId:z.string().max(160).optional(),workspaceId:z.string().max(160).optional()}).strict().parse(await privateJSON(request,262144));
 const closeRequest=async(status:string)=>{if(body.requestId&&body.workspaceId)await db().prepare("UPDATE resources SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND kind='model_request'").bind(status,Date.now(),body.requestId,body.workspaceId).run();};
 if(body.action==='approve'){const approved=await approveFalModel(bindings(),who.user.userId,body.model);await closeRequest('approved');await auditLog(who.tenant,who.user.userId,'fal_model.approved',approved.id,{credits:approved.quote?.credits});return Response.json({approved});}
 if(body.action==='remove'&&body.id){await removeFalModel(bindings(),body.id);await auditLog(who.tenant,who.user.userId,'fal_model.removed',body.id);return Response.json({removed:body.id});}
 await closeRequest('rejected');return Response.json({rejected:body.requestId});
 }catch(error){return failure(error);}}
