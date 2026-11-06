import {checkedProject,resourceProject} from '@/lib/project-context';
import {requireModel} from "@/lib/llm";
import {routingEnabled,routedModel} from '@/lib/model-router';
import {ensureModelPricing} from '@/lib/model-pricing';
import {z} from "zod";
import {identity,db,uid,getResource,createResource,failure,config,decode,type StoredResource} from "@/lib/server";
import {runAgent} from "@/lib/agent";
import {batchedEventWriter,bufferedAgentEvents} from "@/lib/agent-events";
import {AppError} from "@/lib/core.mjs";
import {startRunBudget,finishRunBudget,type RunBudget} from '@/lib/metering';
import {FILE_POLICY,safeFileDto} from '@/lib/file-policy.mjs';
import type {FileRecord,Resource} from '@/lib/contracts';
import {chatAttachmentBlocks} from '@/lib/chat-attachments.mjs';
import {responseCitationMarks,responseSources,responseStatus} from '@/lib/response-metadata.mjs';
import {containsExplicitLoginSecret} from '@/lib/chat-secret-guard.mjs';
import {privateJSON} from '@/lib/private-json';
export async function POST(request:Request){
 let tenant="",conversationId="",locked=false,budget:RunBudget|undefined;
 try{
  const who=await identity(request);tenant=who.tenant;
  await ensureModelPricing();
  if(routingEnabled(config()))routedModel(config(),{task:'conversation'});else requireModel();
  const body=z.object({text:z.string().trim().min(1).max(16000),conversationId:z.string().max(160).optional(),projectId:z.string().max(160).nullable().optional(),referenceProjectIds:z.array(z.string().max(160)).max(3).default([]),attachments:z.array(z.string().max(160)).max(FILE_POLICY.maxFilesPerMessage).default([]),maxCredits:z.number().int().min(1).max(1000),workMode:z.enum(["accompanied","autonomous"]).default("accompanied"),ui:z.unknown().optional()}).parse(await privateJSON(request,80000));
  if(containsExplicitLoginSecret(body.text))throw new AppError('Cette saisie semble contenir un identifiant secret. Utilisez la saisie sécurisée dans Paramètres → Autorisations, ou dans le navigateur sous votre contrôle.',400,'secure_login_input_required');
  if((body.projectId||body.referenceProjectIds.length)&&config().PROJECT_CONTEXT_V1!=='true')throw new AppError('Le contexte par projet n’est pas encore activé.',409,'project_context_unavailable');
  if(body.projectId)await checkedProject(tenant,body.projectId);for(const id of body.referenceProjectIds)await checkedProject(tenant,id);
  const conversation=body.conversationId?await getResource(tenant,body.conversationId):await createResource(tenant,"conversation",body.text.slice(0,70),{projectId:body.projectId??null},"saved");if(conversation.kind!=="conversation"||conversation.status==="deleted")throw new AppError("Discussion invalide.");const sidebar=conversation.data.sidebar;if(sidebar&&typeof sidebar==="object"&&!Array.isArray(sidebar)&&(sidebar as Record<string,unknown>).archived===true)throw new AppError("Restaurez cette discussion avant de la continuer.",409);conversationId=conversation.id;if(body.projectId!==undefined&&resourceProject(conversation.data)!==body.projectId)throw new AppError("Cette discussion appartient à un autre projet. Ouvrez une nouvelle discussion.",409,"project_scope_mismatch");
  const lock=await db().prepare("UPDATE resources SET status='streaming',updated_at=? WHERE id=? AND workspace_id=? AND (status!='streaming' OR updated_at<?)").bind(Date.now(),conversationId,tenant,Date.now()-300000).run();if(!lock.meta.changes)throw new AppError("Une réponse est déjà en cours dans cette discussion.",409);
  locked=true;
  const content:Array<Record<string,unknown>>=[{type:"text",text:body.text}];
  for(const id of body.attachments){const file=await getResource(tenant,id);if(file.kind!=="file")throw new AppError("Pièce jointe invalide.");const fileRow=await db().prepare("SELECT * FROM files WHERE id=? AND workspace_id=?").bind(id,tenant).first<FileRecord>();if(!fileRow||fileRow.status!=="ready")throw new AppError("Cette pièce jointe n’est pas encore disponible.",409,"file_not_ready");const bucket=(await import("cloudflare:workers")).env.BUCKET;content.push(...await chatAttachmentBlocks({title:file.title,data:{...file.data,mime:fileRow.detected_mime,key:fileRow.storage_key}},key=>bucket?.get(key)??Promise.resolve(null)));}
  const runId=uid(),now=Date.now();
  const creditContext=await (await import('@/lib/credit-outlook')).creditOutlook(who.organization).then(o=>import('@/lib/credit-outlook').then(m=>m.outlookContext(o))).catch(()=>null);
  budget=await startRunBudget(who,runId,body.maxCredits);budget.creditContext=creditContext;budget.referenceProjectIds=body.referenceProjectIds;budget.uiContext=await (await import('@/lib/ui-context')).describeUiContext(tenant,body.ui).catch(()=>null);
  await db().batch([db().prepare("INSERT INTO messages (id,workspace_id,conversation_id,role,content,attachments,created_at) VALUES (?,?,?,'user',?,?,?)").bind(uid(),tenant,conversationId,JSON.stringify(content),JSON.stringify(body.attachments),now),db().prepare("INSERT INTO runs (id,workspace_id,conversation_id,status,created_at,updated_at) VALUES (?,?,?,'streaming',?,?)").bind(runId,tenant,conversationId,now,now)]);
  const encoder=new TextEncoder(),abort=new AbortController();let clientClosed=false,lastHeartbeat=Date.now();
  const stream=new ReadableStream({
   async start(controller){
    const send=(chunk:string)=>{if(!clientClosed)try{controller.enqueue(encoder.encode(chunk));}catch{clientClosed=true;}};
    // Keeps proxies and mobile networks from closing a quiet stream (long tool steps).
    const keepAlive=setInterval(()=>send(": ping\n\n"),15000);
    const touch=()=>{if(Date.now()-lastHeartbeat<=30000)return;lastHeartbeat=Date.now();void db().batch([db().prepare("UPDATE runs SET updated_at=? WHERE id=? AND status='streaming'").bind(lastHeartbeat,runId),db().prepare("UPDATE resources SET updated_at=? WHERE id=? AND workspace_id=? AND status='streaming'").bind(lastHeartbeat,conversationId,tenant)]).catch(()=>undefined);};
    const writer=batchedEventWriter(async events=>{touch();const now=Date.now();const results=await db().batch(events.map(event=>db().prepare("INSERT INTO events (run_id,type,data,created_at) VALUES (?,?,?,?)").bind(runId,event.type,JSON.stringify(event.data),now)));return results.map(result=>Number(result.meta.last_row_id));},(seq,type,data)=>send("id: "+seq+"\nevent: "+type+"\ndata: "+JSON.stringify(data)+"\n\n"));
    const buffered=bufferedAgentEvents(writer);const emit=buffered.emit;
    try{await emit("run",{runId,conversationId});await runAgent(tenant,conversationId,runId,emit,abort.signal,budget!,body.workMode);const completed=await db().prepare("UPDATE runs SET status='completed',updated_at=? WHERE id=? AND workspace_id=? AND status='streaming'").bind(Date.now(),runId,tenant).run();if(!completed.meta.changes)throw new AppError('Réponse arrêtée.',499,'cancelled');await emit("done",{runId});}
    catch(error){await buffered.flush().catch(()=>undefined);await persistPartialText(tenant,conversationId,runId);const message=error instanceof AppError?error.message:"Le flux a été interrompu. Les étapes terminées restent enregistrées.";await db().prepare("UPDATE runs SET status=CASE WHEN status='cancelled' THEN status WHEN ? IN ('budget_exhausted','step_limit') THEN 'partial' ELSE 'failed' END,error=?,updated_at=? WHERE id=?").bind(error instanceof AppError?error.code:"technical_failure",message,Date.now(),runId).run();await emit("error",{message,code:error instanceof AppError?error.code:"technical_failure",runId});console.error(JSON.stringify({event:"agent_run_failed",runId,code:error instanceof AppError?error.code:"technical_failure"}));}
    finally{clearInterval(keepAlive);try{await buffered.flush().catch(()=>undefined);await finishRunBudget(budget!);}finally{await db().prepare("UPDATE resources SET status='saved',updated_at=? WHERE id=? AND workspace_id=?").bind(Date.now(),conversationId,tenant).run();if(!clientClosed)controller.close();}}
   },cancel(){clientClosed=true;abort.abort();}
  });
  return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"}});
 }catch(error){if(budget)await finishRunBudget(budget);if(locked)await db().prepare("UPDATE resources SET status='saved' WHERE id=? AND workspace_id=?").bind(conversationId,tenant).run();return failure(error);}
}
export async function GET(request:Request){try{
 const {tenant,user}=await identity(request),url=new URL(request.url),runId=url.searchParams.get("runId"),conversationId=url.searchParams.get("conversationId");
 if(runId){const run=await db().prepare("SELECT id,workspace_id,conversation_id,status,error,created_at,updated_at FROM runs WHERE id=? AND workspace_id=?").bind(runId,tenant).first();if(!run)throw new AppError("Réponse introuvable.",404);const rawCursor=Number(url.searchParams.get("after")||0);if(!Number.isSafeInteger(rawCursor)||rawCursor<0)throw new AppError("Curseur invalide.");const cursor=rawCursor;const events=await db().prepare("SELECT seq,type,data FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 2000").bind(runId,cursor).all<{seq:number;type:string;data:string}>();return Response.json({run,events:events.results.map(r=>({...r,data:JSON.parse(r.data)})),nextAfter:events.results.at(-1)?.seq??cursor,hasMore:events.results.length===2000});}
 if(!conversationId)throw new AppError("Discussion requise.");const conversation=await getResource(tenant,conversationId);if(conversation.kind!=="conversation"||conversation.status==="deleted")throw new AppError("Discussion introuvable.",404);
 type StoredMessage={id:string;role:string;content:string;attachments:string;created_at:number;run_id:string|null;run_status:string|null;feedback:'up'|'down'|null};
 type MessageBlock={type:string;text?:string;response?:unknown};
 const rows=await db().prepare("SELECT m.id,m.role,m.content,m.attachments,m.created_at,m.run_id,r.status run_status,f.feedback FROM messages m LEFT JOIN runs r ON r.id=m.run_id AND r.workspace_id=m.workspace_id LEFT JOIN response_feedback f ON f.message_id=m.id AND f.workspace_id=m.workspace_id AND f.user_id=? WHERE m.workspace_id=? AND m.conversation_id=? ORDER BY m.created_at,m.rowid").bind(user.userId,tenant,conversationId).all<StoredMessage>();
 const messages=await Promise.all(rows.results.map(async m=>{let ids:string[]=[];try{const value=JSON.parse(m.attachments||"[]") as unknown;if(Array.isArray(value))ids=value.filter((id):id is string=>typeof id==="string");}catch{}const attachments=await Promise.all(ids.map(async id=>{const file=await db().prepare("SELECT * FROM files WHERE id=? AND workspace_id=?").bind(id,tenant).first<FileRecord>();return file?safeFileDto(file):{id,workspaceId:tenant,name:"Fichier indisponible",size:0,mime:"application/octet-stream",status:"unavailable",createdAt:0,updatedAt:0,deletedAt:null};}));const storedContent=JSON.parse(m.content) as MessageBlock[];return {id:m.id,role:m.role,created_at:m.created_at,runId:m.run_id,attachments,...(m.role==='assistant'?{status:responseStatus(m.run_id,m.run_status),sources:responseSources(storedContent),citationMarks:responseCitationMarks(storedContent),feedback:m.feedback,richResponses:storedContent.filter(b=>b.type==='ui_response'&&b.response).map(b=>b.response)}:{}),content:storedContent.filter(block=>block.type==="text"||block.type==="image").map(block=>block.type==="image"?{type:"text",text:"[Image jointe]"}:block)};}));
 // Creations made during a run (media proposals, plans, pages…) stay attached to
 // that run's last answer, so an inline approval card survives a reload.
 const runIds=[...new Set(messages.filter(m=>m.role==='assistant'&&m.runId).map(m=>m.runId as string))].slice(-100);
 const byRun=new Map<string,Resource[]>();
 if(runIds.length){
  const found=await db().prepare("SELECT DISTINCT e.run_id,r.* FROM events e JOIN resources r ON r.id=json_extract(e.data,'$.result.id') AND r.workspace_id=? WHERE e.type='tool_result' AND e.run_id IN ("+runIds.map(()=>'?').join(',')+") AND r.kind IN ('proposal','page','deliverable','media','campaign','brief','mission','work','file','skill','connector_action','social_batch') AND r.status!='deleted'").bind(tenant,...runIds).all<StoredResource&{run_id:string}>();
  for(const row of found.results){const list=byRun.get(row.run_id)||[];list.push(decode(row));byRun.set(row.run_id,list);}
 }
 const lastOfRun=new Map<string,string>();for(const m of messages)if(m.role==='assistant'&&m.runId)lastOfRun.set(m.runId,m.id);
 const withResources=messages.map(m=>m.role==='assistant'&&m.runId&&lastOfRun.get(m.runId)===m.id&&byRun.has(m.runId)?{...m,resources:byRun.get(m.runId)}:m);
 return Response.json({messages:withResources.filter(m=>m.content.length||m.attachments.length||m.richResponses?.length||('resources' in m&&m.resources?.length))});
 }catch(error){return failure(error);}}
export async function PATCH(request:Request){try{
 const {tenant,user}=await identity(request);
 const {messageId,feedback}=z.object({messageId:z.string().min(1).max(128),feedback:z.enum(['up','down']).nullable()}).strict().parse(await privateJSON(request,1048576));
 const now=Date.now();
 // Match the message and workspace in the write itself so a stale check cannot
 // insert a vote for another tenant or a non-assistant message.
 const result=await db().prepare("INSERT INTO response_feedback(workspace_id,user_id,message_id,feedback,created_at,updated_at) SELECT workspace_id,?,id,?,?,? FROM messages WHERE id=? AND workspace_id=? AND role='assistant' ON CONFLICT(workspace_id,user_id,message_id) DO UPDATE SET feedback=excluded.feedback,updated_at=CASE WHEN response_feedback.feedback IS excluded.feedback THEN response_feedback.updated_at ELSE excluded.updated_at END").bind(user.userId,feedback,now,now,messageId,tenant).run();
 if(!result.meta.changes)throw new AppError("Réponse introuvable.",404,"message_not_found");
 return Response.json({messageId,feedback});
 }catch(error){return failure(error);}}
export async function DELETE(request:Request){try{const {tenant}=await identity(request);const {runId}=z.object({runId:z.string()}).parse(await privateJSON(request,1048576));await db().prepare("UPDATE runs SET status='cancelled',updated_at=? WHERE id=? AND workspace_id=? AND status='streaming'").bind(Date.now(),runId,tenant).run();return Response.json({stopped:true});}catch(error){return failure(error);}}



async function persistPartialText(tenant:string,conversationId:string,runId:string){
 const events=await db().prepare("SELECT data FROM events WHERE run_id=? AND type='text_delta' AND seq>COALESCE((SELECT MAX(seq) FROM events WHERE run_id=? AND type='assistant_message'),0) ORDER BY seq").bind(runId,runId).all<{data:string}>();
 const text=events.results.map(event=>{try{return String(JSON.parse(event.data).text||'');}catch{return '';}}).join('');
 if(text.trim())await db().prepare("INSERT INTO messages(id,workspace_id,conversation_id,role,content,run_id,created_at) VALUES (?,?,?,'assistant',?,?,?)").bind(uid(),tenant,conversationId,JSON.stringify([{type:'text',text}]),runId,Date.now()).run();
}
