// Isolated code execution Worker for Braand coding agents. Each sandbox is a
// Durable Object that owns one Cloudflare Container. It never receives Braand
// secrets, user credentials or database bindings; the main Worker reaches it
// only through a service binding and a shared call token.
import {Files} from '@cloudflare/sandbox';
import {DurableObject} from 'cloudflare:workers';
import {handleSandboxRequest,WORKSPACE,type ExecResult,type ListEntry,type SandboxBackend} from './handler';

type ExecProcess={output():Promise<{exitCode:number;stdout:Uint8Array;stderr:Uint8Array}>};
type SandboxContainer={
 running:boolean;
 images:Record<string,unknown>;
 start(options:Record<string,unknown>):void;
 exec(argv:string[],options:{cwd:string;signal?:AbortSignal}):Promise<ExecProcess>;
 destroy():Promise<void>;
 setInactivityTimeout(ms:number):Promise<void>;
};
interface SandboxEnv{
 SANDBOX:DurableObjectNamespace<CodeSandbox>;
 CODE_SANDBOX_ENABLED?:string;
 CODE_SANDBOX_CALL_TOKEN?:string;
 // Package installs need outbound access; keep it closed unless explicitly enabled.
 CODE_SANDBOX_INTERNET?:string;
 CODE_SANDBOX_INSTANCE?:string;
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
 async reset(){const container=this.container();if(container.running)await container.destroy();}
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

const codeSandboxWorker={
 fetch(request:Request,env:SandboxEnv){
  return handleSandboxRequest(request,env,name=>env.SANDBOX.getByName(name) as unknown as SandboxBackend);
 },
};
export default codeSandboxWorker;
