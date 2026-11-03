export type EventWriter=(type:string,data:unknown)=>Promise<void>;
// Text deltas are coalesced and written in order. Only the first text flush is
// awaited, so the first visible output is persisted before streaming continues;
// later size-based flushes run in the background so the model stream is not
// paused by each storage round-trip. A write failure stops all later writes and
// is rethrown by the next emit or flush, never hidden behind a completion.
export function bufferedAgentEvents(write:EventWriter,delayMs=40,maxChars=256){
 let text='',first=true,timer:ReturnType<typeof setTimeout>|undefined,chain=Promise.resolve(),failure:{error:unknown}|undefined;
 const enqueue=(type:string,data:unknown)=>{chain=chain.then(()=>write(type,data));chain.catch(error=>{failure??={error};});return chain;};
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
