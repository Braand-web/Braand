import {privateJSON} from '@/lib/private-json';
import {z} from 'zod';
import {identity,getResource,db,updateResource,failure,auditLog,config,authorize} from '@/lib/server';
import {AppError,assertVersion,validateMediaInput} from '@/lib/core.mjs';
import {falCatalog,submitFal,assertFalReady} from '@/lib/providers';
import {reserve,settleHold} from '@/lib/billing';
import {hasCurrentMediaPrice} from '@/lib/execution-policy.mjs';
import {proposalSchema} from '@/lib/contracts';
import {mediaQuoteFingerprint} from '@/lib/media-routing.mjs';
import {approveAssembly,assemblyState} from '@/lib/media-render';
import {pollMediaProposal} from '@/lib/media-jobs';
import {linkMediaWork,wakeWorkForResource} from '@/lib/work';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const who=await identity(request,'approve'),{tenant}=who,{id}=await context.params;
 const {version}=z.object({version:z.number().int()}).parse(await privateJSON(request,1048576));
 const resource=await getResource(tenant,id),opId=id+':'+version;
 const previous=await db().prepare('SELECT id,status FROM operations WHERE id=? AND workspace_id=?').bind(opId,tenant).first();
 if(previous)return Response.json({operation:previous,replayed:true});
 assertVersion(resource.version,version);
 if(resource.kind==='proposal'&&resource.data.kind==='assembly')return Response.json(await approveAssembly(who,id,version));
 if(resource.kind!=='proposal'||resource.data.kind!=='media'||resource.status!=='awaiting_approval')throw new AppError('Proposition média à valider requise.',409);
 if(!config().FAL_KEY)throw new AppError('La génération de médias n’est pas encore configurée.',503);
 assertFalReady();
 const proposal=proposalSchema.parse(resource.data),payload=z.object({model:z.string(),input:z.record(z.unknown()),quoteFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(proposal.payload);
 const model=falCatalog().find(m=>m.id===payload.model),amount=proposal.maxCredits;
 if(!model||model.credits!==amount)throw new AppError('Le tarif a changé. Une nouvelle proposition est nécessaire.',409);
 if(!hasCurrentMediaPrice(model,amount))throw new AppError('Le coût de ce modèle doit être vérifié avant génération.',503);
 if(payload.quoteFingerprint&&payload.quoteFingerprint!==await mediaQuoteFingerprint(model,payload.input))throw new AppError('Le modèle, ses paramètres ou son tarif ont changé. Une nouvelle proposition est nécessaire.',409,'media_stale_quote');
 validateMediaInput(payload.input,model.inputSchema);
 const hold=await reserve(who,'media:'+opId,amount*100);
 try{await linkMediaWork(tenant,id,hold.id);}catch(error){await settleHold(hold.id,0);throw error;}
 const claim=await db().prepare("INSERT OR IGNORE INTO operations (id,workspace_id,resource_id,status,amount,detail,created_at,updated_at) VALUES (?,?,?,'submitting',?,?,?,?)").bind(opId,tenant,id,amount,JSON.stringify({model:model.id,holdId:hold.id,costCeilingXaf:model.costCeilingXaf}),Date.now(),Date.now()).run();
 if(!claim.meta.changes)return Response.json({operationId:opId,replayed:true});
 try{
  await authorize(tenant,who.user.userId,'approve');
  await linkMediaWork(tenant,id,hold.id);
  const externalId=await submitFal(model.id,payload.input);
  await db().prepare("UPDATE operations SET status='waiting_external',external_id=?,updated_at=? WHERE id=?").bind(externalId,Date.now(),opId).run();
  await db().prepare("INSERT OR IGNORE INTO provider_usage(id,organization_id,workspace_id,run_id,hold_id,provider,role,request_id,rate,usage,status,created_at) VALUES (?,?,?,?,?,'fal','creative',?,?,?,'unknown',?)").bind('fal:'+opId,who.organization,tenant,opId,hold.id,externalId,JSON.stringify({costCeilingXaf:model.costCeilingXaf,verifiedAt:model.verifiedAt}),JSON.stringify({model:model.id}),Date.now()).run();
  await updateResource(tenant,id,version,{status:'generating'});
  await auditLog(tenant,who.user.userId,'media.approved',id,{version,maxCredits:amount});
  return Response.json({operationId:opId,status:'waiting_external'});
 }catch(error){
  if(error instanceof AppError&&(error.code==='fal_rejected'||error.status===403)){
   await settleHold(hold.id,0);await db().prepare("UPDATE operations SET status='rejected',updated_at=? WHERE id=?").bind(Date.now(),opId).run();throw error;
  }
  await db().prepare("UPDATE operations SET status='needs_reconciliation',updated_at=? WHERE id=? AND status='submitting'").bind(Date.now(),opId).run();
  const current=await getResource(tenant,id);if(current.status!=='uncertain')await updateResource(tenant,id,current.version,{status:'uncertain'});await wakeWorkForResource(tenant,id);
  throw new AppError('Réponse fournisseur incertaine. Réservation conservée ; aucun nouvel envoi automatique.',502,'needs_reconciliation');
 }
 }catch(error){return failure(error);}}
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
 const {tenant}=await identity(request),{id}=await context.params,resource=await getResource(tenant,id);
 if(resource.data.kind==='assembly')return Response.json(await assemblyState(tenant,id));
 return Response.json(await pollMediaProposal(tenant,id));
 }catch(error){return failure(error);}}
