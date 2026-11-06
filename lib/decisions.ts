// Every approval of an action Braand wants to take lives in the conversation
// that asked for it. These two reads give the conversation its pending
// decisions (including those a background mission or the browser raises
// later) and tell any other screen which conversation to open to decide.
import {db} from './server';

export type DecisionKind='connector_action'|'proposal'|'social_batch'|'social_reply'|'browser_session';
export type PendingDecision={kind:DecisionKind;id:string};

// A resource that is still waiting for the user's decision.
const PENDING=`((r.kind='connector_action' AND r.status='pending')
 OR (r.kind='proposal' AND r.status='awaiting_approval' AND json_extract(r.data,'$.kind') IN ('media','media_plan'))
 OR (r.kind='social_batch' AND EXISTS(SELECT 1 FROM social_posts p WHERE p.batch_id=r.id AND p.workspace_id=r.workspace_id AND p.status='draft')))`;

const safe=async<T>(read:()=>Promise<T[]>):Promise<T[]>=>{try{return await read();}catch{return [];}};

export async function pendingDecisions(tenant:string,conversationId:string):Promise<PendingDecision[]>{
 const [fromChat,fromWork,browser,replies]=await Promise.all([
  safe(async()=>(await db().prepare(`SELECT DISTINCT r.id,r.kind FROM runs ru JOIN events e ON e.run_id=ru.id JOIN resources r ON r.id=json_extract(e.data,'$.result.id') AND r.workspace_id=ru.workspace_id WHERE ru.workspace_id=? AND ru.conversation_id=? AND e.type='tool_result' AND ${PENDING}`).bind(tenant,conversationId).all<{id:string;kind:DecisionKind}>()).results),
  safe(async()=>(await db().prepare(`SELECT DISTINCT r.id,r.kind FROM agent_work w JOIN agent_work_artifacts a ON a.work_id=w.id JOIN resources r ON r.id=a.resource_id AND r.workspace_id=w.workspace_id WHERE w.workspace_id=? AND w.conversation_id=? AND ${PENDING}`).bind(tenant,conversationId).all<{id:string;kind:DecisionKind}>()).results),
  safe(async()=>(await db().prepare("SELECT id FROM browser_sessions WHERE workspace_id=? AND conversation_id=? AND status='awaiting_approval' ORDER BY updated_at").bind(tenant,conversationId).all<{id:string}>()).results.map(row=>({id:row.id,kind:'browser_session' as const}))),
  safe(async()=>(await db().prepare("SELECT DISTINCT s.id FROM runs ru JOIN events e ON e.run_id=ru.id JOIN social_replies s ON s.id=json_extract(e.data,'$.result.id') AND s.workspace_id=ru.workspace_id WHERE ru.workspace_id=? AND ru.conversation_id=? AND e.type='tool_result' AND json_extract(e.data,'$.result.commentId') IS NOT NULL AND s.status='draft'").bind(tenant,conversationId).all<{id:string}>()).results.map(row=>({id:row.id,kind:'social_reply' as const}))),
 ]);
 const seen=new Set<string>();
 return [...fromChat,...fromWork,...browser,...replies].filter(item=>!seen.has(item.id)&&!!seen.add(item.id));
}

/** The conversation where this item is decided, or null when the user made it by hand. */
export async function decisionOrigin(tenant:string,id:string):Promise<string|null>{
 const reads=[
  "SELECT ru.conversation_id c FROM events e JOIN runs ru ON ru.id=e.run_id WHERE ru.workspace_id=? AND e.type='tool_result' AND json_extract(e.data,'$.result.id')=? LIMIT 1",
  "SELECT w.conversation_id c FROM agent_work w JOIN agent_work_artifacts a ON a.work_id=w.id WHERE w.workspace_id=? AND a.resource_id=? LIMIT 1",
  "SELECT conversation_id c FROM browser_sessions WHERE workspace_id=? AND id=? LIMIT 1",
 ];
 for(const sql of reads){
  const row=await db().prepare(sql).bind(tenant,id).first<{c:string|null}>().catch(()=>null);
  if(row?.c)return row.c;
 }
 return null;
}
