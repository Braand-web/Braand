import {DurableObject} from 'cloudflare:workers';
import {z} from 'zod';
import {createBrowserDriver} from './browser-driver';
import {browserRPCPrefix,runWithBrowserDriver} from './browser-runtime';
import {getBrowserExecution,browserAbortExecution,browserCleanup} from './browser';
import {runBrowserAgentTurn} from './browser-agent';
import {BrowserCredentialBroker} from './browser-credential-broker';
import {browserLiveSocket} from './browser-live';
import {parseHumanBrowserInput} from './browser-input.mjs';
import type {HumanBrowserInput} from './browser-contracts';
import type {BrowserDriver,BrowserDownload} from './browser-contracts';

const envelope=z.object({id:z.string().uuid(),method:z.enum(['open','observe','command','capture','storageState','close','receipt','configureNetwork','humanInput']),args:z.array(z.unknown()).max(3)}).strict();
const reference=z.string().min(1).max(10000),optionalReference=z.string().max(200).nullish();
const transfer=z.object({name:z.string().max(200),mime:z.string().max(100),key:z.string().max(300)}).strict();
// Private service-binding RPC only. No public route forwards arbitrary methods here.
export class BrowserSession extends DurableObject<Cloudflare.Env>{
 private driver:BrowserDriver;
 private vault:BrowserCredentialBroker;
 private queue:Promise<unknown>=Promise.resolve();
 constructor(ctx:DurableObjectState,bindings:Cloudflare.Env){super(ctx,bindings);if(!bindings.BROWSER)throw new Error('Browser binding missing');this.driver=createBrowserDriver(bindings.BROWSER);this.vault=new BrowserCredentialBroker(bindings,this.driver);}
 private async bind(id:string){const current=await this.ctx.storage.get<string>('session');if(current&&current!==id)throw new Error('Session mismatch');if(!current)await this.ctx.storage.put('session',id);}
 private serialize<T>(work:()=>Promise<T>):Promise<T>{const next=this.queue.then(work);this.queue=next.catch(()=>{});return next;}
 async fetch(request:Request):Promise<Response>{
  try{
   if(new URL(request.url).hostname==='browser.internal'&&new URL(request.url).pathname==='/live'){
    const id=z.string().uuid().parse(request.headers.get('x-browser-session'));await this.bind(id);
    return browserLiveSocket(request,this.env,this.driver,this.ctx);
   }
   if(new URL(request.url).hostname==='browser.internal'&&new URL(request.url).pathname==='/vault'&&request.method==='POST'){
    if(!this.env.VAULT_BROWSER_TOKEN||request.headers.get('authorization')!=='Bearer '+this.env.VAULT_BROWSER_TOKEN)return new Response(null,{status:403});
    const copy=await request.clone().text();if(copy.length>24000)return new Response(null,{status:413});
    await this.bind(z.object({id:z.string().uuid()}).passthrough().parse(JSON.parse(copy)).id);
    return this.serialize(()=>this.vault.handle(request));
   }
   if(request.method!=='POST'||new URL(request.url).hostname!=='browser.internal')return new Response(null,{status:404});
   const raw=await request.text();if(raw.length>12*1024*1024)return new Response(null,{status:413});
   if(new URL(request.url).pathname==='/wake'){const {id}=z.object({id:z.string().uuid()}).strict().parse(JSON.parse(raw));await this.bind(id);await this.ctx.storage.setAlarm(Date.now()+100);return Response.json({scheduled:true});}
   if(new URL(request.url).pathname!=='/driver')return new Response(null,{status:404});
   const data=envelope.parse(JSON.parse(raw));await this.bind(data.id);
   return await this.serialize(async()=>{
    const [session,page]=data.args;
    if(data.method==='open'){await this.ctx.storage.setAlarm(Date.now()+30000);const opened=await this.driver.open(z.object({allowedDomains:z.array(z.string()).min(1).max(20),storageState:z.string().max(8*1024*1024).optional()}).strict().parse(session));await this.ctx.storage.put('provider',opened.sessionId);return Response.json(opened);}
    const provider=reference.parse(session);
    if(data.method==='humanInput'){if(!this.driver.humanInput)throw new Error();await this.driver.humanInput(provider,parseHumanBrowserInput(page) as HumanBrowserInput,optionalReference.parse(data.args[2])??undefined);return Response.json({accepted:true});}
    if(data.method==='configureNetwork'){const policy=z.object({submit:z.enum(['allow','ask','deny']),download:z.enum(['allow','ask','deny']),approvedAction:z.boolean()}).strict().parse(page);if(!this.driver.configureNetwork)throw new Error();await this.driver.configureNetwork(provider,policy);return Response.json({configured:true});}
    if(data.method==='receipt')return Response.json(await this.driver.receipt(provider));
    if(data.method==='observe')return Response.json(await this.driver.observe(provider,optionalReference.parse(page)??undefined));
    if(data.method==='capture'){const bytes=await this.driver.capture(provider,optionalReference.parse(page)??undefined);return new Response(bytes.slice().buffer as ArrayBuffer,{headers:{'content-type':'image/png','cache-control':'no-store'}});}
    if(data.method==='storageState')return Response.json(await this.driver.storageState(provider));
    if(data.method==='close')return Response.json(await this.driver.close(provider));
    let file:BrowserDownload|undefined;
    if(data.args[2]){const f=transfer.parse(data.args[2]);if(!f.key.startsWith(browserRPCPrefix(data.id))||!this.env.BUCKET)throw new Error('Invalid private transfer');const object=await this.env.BUCKET.get(f.key);if(!object||object.size>50*1024*1024)throw new Error('Invalid transfer size');file={name:f.name,mime:f.mime,bytes:new Uint8Array(await object.arrayBuffer())};await this.env.BUCKET.delete(f.key);}
    const result=await this.driver.command(provider,page as Parameters<BrowserDriver['command']>[1],file);
    if(!result.download)return Response.json(result);
    if(!this.env.BUCKET)throw new Error('Storage unavailable');
    const key=browserRPCPrefix(data.id)+crypto.randomUUID();await this.env.BUCKET.put(key,result.download.bytes,{customMetadata:{expiresAt:String(Date.now()+300000)}});
    return Response.json({observation:result.observation,download:{name:result.download.name,mime:result.download.mime,key}});
   });
  }catch(error){const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^browser_[a-z_]+$/.test(error.code)?error.code:'browser_runner_unavailable';return Response.json({code},{status:409});}
 }
 async alarm(){
  const id=await this.ctx.storage.get<string>('session');if(!id)return;
  // Alarm retries never repeat an uncertain command. The encrypted checkpoint and
  // persisted action lease are inspected before any model or browser operation.
  await runWithBrowserDriver(id,this.driver,async()=>{
   let execution:Awaited<ReturnType<typeof getBrowserExecution>>=null;
   try{
    await browserCleanup();
    const row=await this.env.DB?.prepare('SELECT active,provider_id,provider_state FROM browser_sessions WHERE id=?').bind(id).first<{active:number;provider_id:string|null;provider_state:string}>();
    if(!row?.active){const provider=await this.ctx.storage.get<string>('provider');if(provider&&row?.provider_state==='opening'){await this.driver.close(provider);await browserAbortExecution(id);}return;}
    // Activation may have lost its HTTP response before persisting the provider
    // handle. Close the orphan, retain unknown cost, never launch it a second time.
    if(row.provider_state==='opening'){const provider=await this.ctx.storage.get<string>('provider');if(provider)await this.driver.close(provider);await browserAbortExecution(id);return;}
    execution=await getBrowserExecution(id);
    if(execution)await runBrowserAgentTurn(execution);
    const next=await getBrowserExecution(id);
    const active=await this.env.DB?.prepare('SELECT active FROM browser_sessions WHERE id=?').bind(id).first<{active:number}>();
    if(active?.active)await this.ctx.storage.setAlarm(Date.now()+(next?500:30000));
   }
   catch{
    const current=await this.env.DB?.prepare('SELECT status,active FROM browser_sessions WHERE id=?').bind(id).first<{status:string;active:number}>();
    if(current?.active&&['paused','awaiting_login','awaiting_approval'].includes(current.status))await this.ctx.storage.setAlarm(Date.now()+30000);
    else await browserAbortExecution(id);
   }
  });
 }
}
