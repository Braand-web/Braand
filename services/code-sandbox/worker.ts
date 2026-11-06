// Isolated code execution Worker for Braand coding agents. Each sandbox is a
// Durable Object that owns one Cloudflare Container. It never receives Braand
// secrets, user credentials or database bindings; the main Worker reaches it
// only through a service binding and a shared call token.
import {Files} from '@cloudflare/sandbox';
import {DurableObject} from 'cloudflare:workers';
import {handleSandboxRequest,WORKSPACE,type ExecResult,type ListEntry,type SandboxBackend} from './handler';
import {PREVIEW_COOKIE,PREVIEW_TTL_MS,previewCookie,verifyPreview} from '../../lib/preview-token.mjs';

type ExecProcess={output():Promise<{exitCode:number;stdout:Uint8Array;stderr:Uint8Array}>};
type SandboxContainer={
 running:boolean;
 images:Record<string,unknown>;
 start(options:Record<string,unknown>):void;
 exec(argv:string[],options:{cwd:string;signal?:AbortSignal}):Promise<ExecProcess>;
 destroy():Promise<void>;
 setInactivityTimeout(ms:number):Promise<void>;
 getTcpPort(port:number):{fetch(request:Request):Promise<Response>};
};
interface SandboxEnv{
 SANDBOX:DurableObjectNamespace<CodeSandbox>;
 CODE_SANDBOX_ENABLED?:string;
 CODE_SANDBOX_CALL_TOKEN?:string;
 // Package installs need outbound access; keep it closed unless explicitly enabled.
 CODE_SANDBOX_INTERNET?:string;
 CODE_SANDBOX_INSTANCE?:string;
 // Signs live preview links (shared with the main Worker).
 CODE_PREVIEW_SECRET?:string;
}
const INACTIVITY_TIMEOUT_MS=10*60*1000;

export class CodeSandbox extends DurableObject<SandboxEnv> implements SandboxBackend{
 private readonly files:Files;
 constructor(ctx:DurableObjectState,env:SandboxEnv){
  super(ctx,env);
  const container=this.container();
  this.files=new Files(container as unknown as ConstructorParameters<typeof Files>[0]);
  if(container.running)void ctx.blockConcurrencyWhile(()=>container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
 }
 async exec(argv:string[],timeoutSeconds:number):Promise<ExecResult>{
  const container=await this.running();
  const signal=AbortSignal.timeout(timeoutSeconds*1000);
  const process=await container.exec(argv,{cwd:WORKSPACE,signal});
  const output=await process.output(),decoder=new TextDecoder();
  return {exitCode:output.exitCode,stdout:decoder.decode(output.stdout),stderr:decoder.decode(output.stderr)};
 }
 async writeFile(path:string,content:string){
  await this.running();
  const parent=path.slice(0,path.lastIndexOf('/'));
  if(parent&&parent!==WORKSPACE)await this.files.mkdir(parent,{recursive:true});
  await this.files.writeFile(path,content);
 }
 async readFile(path:string){await this.running();return (await this.files.readFile(path)).text();}
 async list(path:string):Promise<ListEntry[]>{await this.running();return (await this.files.readDirectory(path)).map(entry=>({name:entry.name,type:entry.type}));}
 // Relays a browser request to the app the user is previewing in this container.
 async preview(request:Request,port:number){
  const container=this.container();
  if(!container.running)return previewPage('Cet aperçu est arrêté','Le projet ne tourne plus (inactif depuis 10 minutes). Demandez à Braand de relancer l’aperçu.',410);
  try{return await container.getTcpPort(port).fetch(request);}
  catch{return previewPage('L’application ne répond pas','Le serveur du projet démarre encore ou s’est arrêté. Patientez quelques secondes, ou demandez à Braand de vérifier le journal.',502);}
 }
 async reset(){const container=this.container();if(container.running)await container.destroy();}
 async size(path:string){await this.running();return Number((await this.files.stat(path)).size);}
 async readBinary(path:string){await this.running();return (await this.files.readFile(path)).body;}
 async writeBinary(path:string,body:ReadableStream<Uint8Array>){await this.running();const parent=path.slice(0,path.lastIndexOf('/'));if(parent&&parent!==WORKSPACE)await this.files.mkdir(parent,{recursive:true});await this.files.writeFile(path,body);}
 private async running(){
  const container=this.container();
  if(!container.running){
   container.start({image:container.images.sandbox,instance:this.env.CODE_SANDBOX_INSTANCE||'basic',enableInternet:this.env.CODE_SANDBOX_INTERNET==='true',labels:{service:'braand-code-sandbox'}});
   await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
  }
  return container;
 }
 private container(){
  const container=(this.ctx as unknown as {container?:SandboxContainer}).container;
  if(!container)throw new Error('Container attachment is unavailable');
  return container;
 }
}

function previewPage(title:string,text:string,status:number){
 return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;color:#1f2328"><h1 style="font-size:22px">${title}</h1><p style="color:#57606a;line-height:1.5">${text}</p></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}
// Live preview, on this Worker's own workers.dev address (a separate site from
// braand.fun, so the previewed app never sees Braand's cookies). The signed
// link sets a cookie, then every path of the app is relayed to the container.
export async function handlePreview(request:Request,env:SandboxEnv){
 const url=new URL(request.url),secret=env.CODE_PREVIEW_SECRET||'';
 const entry=url.pathname.match(/^\/__preview\/([A-Za-z0-9_.-]{20,512})\/?$/);
 if(entry){
  const access=await verifyPreview(entry[1],secret);
  if(!access)return previewPage('Lien d’aperçu expiré','Ce lien n’est plus valable. Demandez à Braand un nouvel aperçu.',403);
  const maxAge=Math.max(60,Math.floor((access.expiresAt-Date.now())/1000));
  return new Response(null,{status:302,headers:{Location:'/','Set-Cookie':`${PREVIEW_COOKIE}=${entry[1]}; Path=/; Max-Age=${Math.min(maxAge,PREVIEW_TTL_MS/1000)}; Secure; HttpOnly; SameSite=Lax`,'cache-control':'no-store'}});
 }
 const access=await verifyPreview(previewCookie(request)||'',secret);
 if(!access)return previewPage('Aperçu introuvable','Ouvrez l’aperçu depuis le lien donné par Braand dans la discussion.',403);
 const headers=new Headers(request.headers);
 const rest=(headers.get('cookie')||'').split(/;\s*/).filter(part=>part&&!part.startsWith(PREVIEW_COOKIE+'=')).join('; ');
 if(rest)headers.set('cookie',rest);else headers.delete('cookie');
 const forwarded=new Request(request,{headers,redirect:'manual'});
 const sandbox=env.SANDBOX.getByName(access.sandbox) as unknown as CodeSandbox;
 return sandbox.preview(forwarded,access.port);
}

const codeSandboxWorker={
 fetch(request:Request,env:SandboxEnv){
  // Calls from the main Worker carry the call token; everything else is a browser looking at a preview.
  if(!request.headers.has('authorization')&&env.CODE_SANDBOX_ENABLED==='true')return handlePreview(request,env);
  return handleSandboxRequest(request,env,name=>env.SANDBOX.getByName(name) as unknown as SandboxBackend);
 },
};
export default codeSandboxWorker;
