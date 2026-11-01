import {AsyncLocalStorage} from 'node:async_hooks';
import {env} from 'cloudflare:workers';
import {AppError} from './core.mjs';
import type {BrowserDriver,BrowserDownload} from './browser-contracts';

const owners=new AsyncLocalStorage<{id:string;driver:BrowserDriver}>();
export function runWithBrowserDriver<T>(id:string,driver:BrowserDriver,work:()=>T):T{return owners.run({id,driver},work);}
export const browserRPCPrefix=(id:string)=>'_browser_rpc/'+id+'/';
export async function browserRPCCleanup(now=Date.now()){
 const bucket=env.BUCKET;if(!bucket||typeof bucket.list!=='function')return;
 let cursor:string|undefined;
 for(let page=0;page<5;page++){const listed=await bucket.list({prefix:'_browser_rpc/',cursor,limit:500});for(const object of listed.objects)if(object.uploaded.getTime()<now-300000)await bucket.delete(object.key);if(!listed.truncated)return;cursor=listed.cursor;}
}
export function browserDriverForSession(id:string):BrowserDriver{
 const owner=owners.getStore();if(owner?.id===id)return owner.driver;
 const namespace=env.BROWSER_SESSIONS,bucket=env.BUCKET;
 if(!namespace||!bucket)throw new AppError('Le moteur cloud est indisponible.',503,'browser_runner_unavailable');
 const stub=namespace.get(namespace.idFromName(id));
 async function call(method:string,args:unknown[]=[]):Promise<Response>{
  const response=await stub.fetch('https://browser.internal/driver',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,method,args})});
  if(!response.ok){let code='browser_runner_unavailable';try{const body=await response.json() as {code?:string};if(body.code&&/^browser_[a-z_]+$/.test(body.code))code=body.code;}catch{/* No supplier error data crosses the private boundary. */}throw new AppError('Le navigateur ne peut pas confirmer cette opération.',response.status,code);}
  return response;
 }
 return {
  async configureNetwork(sessionId,policy){await call('configureNetwork',[sessionId,policy]);},
  async humanInput(sessionId,input,pageId){await call('humanInput',[sessionId,input,pageId]);},
  async receipt(sessionId){return await (await call('receipt',[sessionId])).json();},
  async open(input){return await (await call('open',[input])).json();},
  async observe(sessionId,pageId){return await (await call('observe',[sessionId,pageId])).json();},
  async command(sessionId,command,file){
   let uploadKey:string|undefined;
   try{
    if(file){uploadKey=browserRPCPrefix(id)+crypto.randomUUID();await bucket.put(uploadKey,file.bytes,{customMetadata:{expiresAt:String(Date.now()+300000)}});}
    const result=await (await call('command',[sessionId,command,file?{name:file.name,mime:file.mime,key:uploadKey}:undefined])).json() as {observation:Awaited<ReturnType<BrowserDriver['observe']>>;download?:{name:string;mime:string;key:string}};
    let download:BrowserDownload|undefined;
    if(result.download){const {key,name,mime}=result.download;if(!key.startsWith(browserRPCPrefix(id)))throw new AppError('Transfert privé invalide.',502);try{const object=await bucket.get(key);if(!object||object.size>50*1024*1024)throw new AppError('Transfert privé indisponible.',502);download={name,mime,bytes:new Uint8Array(await object.arrayBuffer())};}finally{await bucket.delete(key);}}
    return {observation:result.observation,download};
   }finally{if(uploadKey)await bucket.delete(uploadKey);}
  },
  async capture(sessionId,pageId){return new Uint8Array(await (await call('capture',[sessionId,pageId])).arrayBuffer());},
  async storageState(sessionId){return await (await call('storageState',[sessionId])).json();},
  async close(sessionId){return await (await call('close',[sessionId])).json();},
 };
}
