export type EventWriter=(type:string,data:unknown)=>Promise<void>;
// Text deltas are coalesced and written in order. Only the first text flush is
// awaited, so the first visible output is persisted before streaming continues;
// later size-based flushes run in the background so the model stream is not
// paused by each storage round-trip. A write failure stops all later writes and
// is rethrown by the next emit or flush, never hidden behind a completion.
export function bufferedAgentEvents(write:EventWriter,delayMs=30,maxChars=96){
 let text='',first=true,timer:ReturnType<typeof setTimeout>|undefined,chain=Promise.resolve(),failure:{error:unknown}|undefined;
 // The writer is called at once, in order: it queues and batches its own
 // storage, so one slow write never holds back the next event.
 const enqueue=(type:string,data:unknown)=>{const written=write(type,data);written.catch(error=>{failure??={error};});chain=chain.then(()=>written);chain.catch(()=>undefined);return chain;};
 const flush=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}if(text){const value=text;text='';return enqueue('text_delta',{text:value});}return chain;};
 const emit=async(type:string,data:unknown)=>{
  if(failure)throw failure.error;
  if(type==='text_delta'&&data&&typeof data==='object'&&'text' in data&&typeof data.text==='string'){
   text+=data.text;
   if(first){first=false;await flush();}
   else if(text.length>=maxChars)void flush().catch(()=>undefined);
   else if(timer===undefined)timer=setTimeout(()=>{void flush().catch(()=>undefined);},delayMs);
   return;
  }
  await flush();await enqueue(type,data);
 };
 return {emit,flush};
}

type Pending={type:string;data:unknown;resolve:()=>void;reject:(error:unknown)=>void};
/**
 * Events are stored in batches (one database trip for everything that arrived
 * meanwhile) and each one is sent right after its batch is stored, with the
 * stored sequence number, so a reconnection replays exactly what was missed.
 */
export function batchedEventWriter(store:(events:{type:string;data:unknown}[])=>Promise<number[]>,send:(seq:number,type:string,data:unknown)=>void,maxBatch=25):EventWriter{
 const pending:Pending[]=[];let running=false,failure:{error:unknown}|undefined;
 const pump=async()=>{
  running=true;
  try{
   while(pending.length){
    const batch=pending.splice(0,maxBatch);
    try{
     const ids=await store(batch.map(({type,data})=>({type,data})));
     batch.forEach((event,index)=>{send(ids[index],event.type,event.data);event.resolve();});
    }catch(error){failure={error};for(const event of [...batch,...pending.splice(0)])event.reject(error);}
   }
  }finally{running=false;}
 };
 return (type,data)=>{
  if(failure)return Promise.reject(failure.error);
  return new Promise<void>((resolve,reject)=>{pending.push({type,data,resolve,reject});if(!running)void pump();});
 };
}
