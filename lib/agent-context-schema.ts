import {contextSchemaStatements} from './agent-context-schema.generated.mjs';
type State={next:number;flight?:Promise<{status:string}>};
const states=new WeakMap<object,State>();
/** Additive, idempotent rollout through the existing scheduled Worker binding.
 * Never on the login path. A storage outage postpones migration, not the app. */
export async function ensureContextSearchSchema(database:D1Database|undefined,now=Date.now()){
 if(!database)return {status:'disabled'};
 let state=states.get(database);if(!state){state={next:0};states.set(database,state);}
 if(state.flight)return state.flight;if(now<state.next)return {status:'deferred'};
 const current=state;current.next=now+300000;
 current.flight=(async()=>{
  try{
   const row=await database.prepare("SELECT value FROM platform_settings WHERE key='agent_context_schema_v1'").first<{value:string}>();
   if(row?.value==='ready'){current.next=now+86400000;return {status:'ready'};}
   await database.batch([...contextSchemaStatements.map(statement=>database.prepare(statement)),database.prepare("INSERT OR REPLACE INTO platform_settings(key,value,updated_at) VALUES ('agent_context_schema_v1','ready',?)").bind(now)]);
   current.next=now+86400000;return {status:'applied'};
  }catch{return {status:'storage_unavailable'};}
 })();
 try{return await current.flight;}finally{current.flight=undefined;}
}
