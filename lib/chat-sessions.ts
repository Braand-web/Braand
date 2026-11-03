type Update<T> = T | ((current:T)=>T);
export type ChatSlot<M,A,S>={key:string;scope:string;projectId:string|null;referenceProjectId:string;conversationId:string|undefined;messages:M[];attachments:A[];draftInput:string|null;busy:boolean;runId:string;activity:string;responseStatus:S|null;error:string;controller:{current:AbortController|null};inFlight:{current:boolean};flush:{current:(()=>void)|null}};

/** UI state and stream ownership are scoped to a conversation, never to the visible page. */
export function createChatSessions<M,A,S>(){
 const slots=new Map<string,ChatSlot<M,A,S>>(),active=new Map<string,string>(),listeners=new Set<()=>void>();
 let sequence=0,disposed=false;
 const notify=()=>{for(const fn of listeners)fn();};
 const create=(scope:string,conversationId?:string,messages:M[]=[])=>{
  const key=scope+':'+(++sequence),slot:ChatSlot<M,A,S>={key,scope,projectId:null,referenceProjectId:'',conversationId,messages,attachments:[],draftInput:null,busy:false,runId:'',activity:'',responseStatus:null,error:'',controller:{current:null},inFlight:{current:false},flush:{current:null}};
  slots.set(key,slot);active.set(scope,key);
  // Keep running streams; evict only old inactive UI histories. Saved chats remain on the server.
  const old=[...slots.values()].filter(item=>item.scope===scope&&!item.busy&&item.key!==key);
  while(old.length>30){const item=old.shift()!;slots.delete(item.key);}
  return slot;
 };
 return {
  subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  snapshot(scope:string){return slots.get(active.get(scope)||'')||create(scope);},
  update<K extends keyof ChatSlot<M,A,S>>(key:string,field:K,value:Update<ChatSlot<M,A,S>[K]>){const item=slots.get(key);if(!item||disposed)return;const next=typeof value==='function'?(value as (v:ChatSlot<M,A,S>[K])=>ChatSlot<M,A,S>[K])(item[field]):value;slots.set(key,{...item,[field]:next});if(['busy','conversationId'].includes(field)){const visible=active.get(item.scope);if(visible&&visible!==key){const shown=slots.get(visible);if(shown)slots.set(visible,{...shown});}}notify();},
  newChat(scope:string,force=false,projectId:string|null=null){const existing=!force&&[...slots.values()].reverse().find(s=>s.scope===scope&&!s.busy&&!s.conversationId&&s.projectId===projectId);const item=existing||create(scope);item.projectId=projectId;active.set(scope,item.key);notify();return item;},
  open(scope:string,id:string,messages?:M[],projectId?:string|null){let item=[...slots.values()].find(s=>s.scope===scope&&s.conversationId===id);if(!item&&messages===undefined)return false;if(!item)item=create(scope,id,messages);if(projectId!==undefined)item.projectId=projectId;active.set(scope,item.key);notify();return true;},
  isCurrent(scope:string,key:string){return active.get(scope)===key;},
  select(scope:string,key:string){if(slots.get(key)?.scope!==scope)return false;active.set(scope,key);notify();return true;},
  running(scope:string){return [...slots.values()].filter(s=>s.scope===scope&&s.busy);},
  dispose(){for(const s of slots.values()){s.flush.current?.();s.controller.current?.abort();}disposed=true;slots.clear();active.clear();listeners.clear();}
 };
}

/** Queue explicit user submissions without bypassing server concurrency or making retries. */
// Parallel conversations follow the plan's concurrency (the server enforces the
// same limit). Extra explicit requests wait in order; at most `waitingLimit`
// may wait so a burst of clicks cannot queue unbounded work.
export function createChatQueue(waitingLimit=2,initialParallel=1){
 let parallel=Math.max(1,initialParallel),active=0;const waiting:{signal:AbortSignal;resolve:(release:()=>void)=>void;reject:(error:Error)=>void;abort:()=>void}[]=[];
 const drain=()=>{while(active<parallel){const next=waiting.shift();if(!next)return;next.signal.removeEventListener('abort',next.abort);if(next.signal.aborted){next.reject(new DOMException('Stopped','AbortError'));continue;}active++;let released=false;next.resolve(()=>{if(released)return;released=true;active--;drain();});}};
 return {
  get parallel(){return parallel;},
  setParallel(value:number){parallel=Math.max(1,Math.min(10,Math.floor(value)||1));drain();},
  acquire(signal:AbortSignal):Promise<()=>void>{if(signal.aborted)return Promise.reject(new DOMException('Stopped','AbortError'));if(active>=parallel&&waiting.length>=waitingLimit)return Promise.reject(new Error(parallel>1?'Toutes vos réponses simultanées sont occupées et deux demandes attendent déjà.':'Une réponse est en cours et deux demandes attendent déjà.'));return new Promise((resolve,reject)=>{const item={signal,resolve,reject,abort:()=>{const i=waiting.indexOf(item);if(i>=0)waiting.splice(i,1);reject(new DOMException('Stopped','AbortError'));}};signal.addEventListener('abort',item.abort,{once:true});waiting.push(item);drain();});},
 };
}
