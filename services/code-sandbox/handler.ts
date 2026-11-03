// Request policy for the isolated code sandbox Worker. Pure and runtime-agnostic
// so it can be tested without a container. The Durable Object implements
// SandboxBackend; this module only authenticates, validates and bounds calls.
import {z} from 'zod';

export const WORKSPACE='/workspace';
export const SANDBOX_LIMITS=Object.freeze({
 commandChars:8000,
 maxTimeoutSeconds:300,
 defaultTimeoutSeconds:60,
 outputChars:24000,
 fileBytes:512*1024,
 readChars:60000,
 listEntries:500,
 transferBytes:200*1024*1024,
});
export const MEDIA_TYPES:Record<string,string>={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',gif:'image/gif',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',srt:'text/plain',vtt:'text/vtt',pdf:'application/pdf',zip:'application/zip',json:'application/json',txt:'text/plain',md:'text/plain',csv:'text/plain',html:'text/plain'};
export const mediaType=(path:string)=>MEDIA_TYPES[(path.split('.').pop()||'').toLowerCase()];

export type ExecResult={exitCode:number;stdout:string;stderr:string};
export type ListEntry={name:string;type:string};
export interface SandboxBackend{
 exec(argv:string[],timeoutSeconds:number):Promise<ExecResult>;
 writeFile(path:string,content:string):Promise<void>;
 readFile(path:string):Promise<string>;
 list(path:string):Promise<ListEntry[]>;
 reset():Promise<void>;
 size(path:string):Promise<number>;
 readBinary(path:string):Promise<ReadableStream<Uint8Array>|null>;
 writeBinary(path:string,body:ReadableStream<Uint8Array>):Promise<void>;
}
export interface SandboxPolicyEnv{CODE_SANDBOX_ENABLED?:string;CODE_SANDBOX_CALL_TOKEN?:string}

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const SANDBOX_NAME=/^[a-f0-9]{40}$/;

// Paths are confined to /workspace. Relative paths are resolved against it and
// any traversal outside it is refused (symlinks inside the container are the
// container's own business: it has no secrets and no Braand credentials).
export function workspacePath(value:string){
 if(typeof value!=='string'||!value||value.length>512||value.includes('\0'))return undefined;
 const parts:string[]=[];
 for(const part of (value.startsWith('/')?value:WORKSPACE+'/'+value).split('/')){
  if(!part||part==='.')continue;
  if(part==='..'){if(!parts.length)return undefined;parts.pop();continue;}
  parts.push(part);
 }
 const resolved='/'+parts.join('/');
 return resolved===WORKSPACE||resolved.startsWith(WORKSPACE+'/')?resolved:undefined;
}
const pathField=z.string().min(1).max(512).transform((value,ctx)=>{const resolved=workspacePath(value);if(!resolved){ctx.addIssue({code:z.ZodIssueCode.custom,message:'path_outside_workspace'});return z.NEVER;}return resolved;});
const schemas={
 exec:z.object({command:z.string().min(1).max(SANDBOX_LIMITS.commandChars),timeoutSeconds:z.number().int().min(1).max(SANDBOX_LIMITS.maxTimeoutSeconds).default(SANDBOX_LIMITS.defaultTimeoutSeconds)}).strict(),
 write:z.object({path:pathField,content:z.string().max(SANDBOX_LIMITS.fileBytes)}).strict(),
 read:z.object({path:pathField,offset:z.number().int().min(0).default(0)}).strict(),
 list:z.object({path:pathField.default(WORKSPACE)}).strict(),
 reset:z.object({}).strict(),
};

function clip(text:string,limit:number){
 if(text.length<=limit)return {text,truncated:false};
 const half=Math.floor(limit/2);
 return {text:text.slice(0,half)+`\n…[${text.length-limit} caractères omis]…\n`+text.slice(-half),truncated:true};
}

export async function handleSandboxRequest(request:Request,env:SandboxPolicyEnv,backendFor:(name:string)=>SandboxBackend){
 const token=env.CODE_SANDBOX_CALL_TOKEN;
 if(env.CODE_SANDBOX_ENABLED!=='true'||!token||token.length<32)return json({code:'sandbox_unavailable'},503);
 const url=new URL(request.url);
 if(url.hostname!=='sandbox.internal'||request.method!=='POST'||request.headers.get('authorization')!=='Bearer '+token)return json({code:'sandbox_denied'},403);
 const name=request.headers.get('x-sandbox-name')||'';
 if(!SANDBOX_NAME.test(name))return json({code:'sandbox_denied'},403);
 const binary=url.pathname==='/download'||url.pathname==='/upload';
 if(binary){
  const path=workspacePath(url.searchParams.get('path')||'');
  if(!path)return json({code:'sandbox_input_invalid',issues:['path_outside_workspace']},400);
  const type=mediaType(path);if(!type)return json({code:'sandbox_input_invalid',issues:['file_type_not_allowed']},400);
  const backend=backendFor(name);
  try{
   if(url.pathname==='/download'){
    const size=await backend.size(path);if(size<=0)return json({code:'sandbox_file_error',errno:'EEMPTY'},422);if(size>SANDBOX_LIMITS.transferBytes)return json({code:'sandbox_input_too_large'},413);
    const body=await backend.readBinary(path);if(!body)return json({code:'sandbox_file_error',errno:'ENOENT'},422);
    return new Response(body,{headers:{'content-type':type,'content-length':String(size),'x-sandbox-path':path,'cache-control':'no-store'}});
   }
   const length=Number(request.headers.get('content-length')||0);
   if(!request.body||!Number.isSafeInteger(length)||length<=0||length>SANDBOX_LIMITS.transferBytes)return json({code:'sandbox_input_too_large'},413);
   await backend.writeBinary(path,request.body);
   return json({path,bytes:length});
  }catch(error){
   const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'';
   if(/^E[A-Z]+$/.test(code))return json({code:'sandbox_file_error',errno:code},422);
   return json({code:'sandbox_failed'},502);
  }
 }
 const operation=url.pathname.slice(1) as keyof typeof schemas;
 if(!Object.hasOwn(schemas,operation))return json({code:'sandbox_not_found'},404);
 if(Number(request.headers.get('content-length')||0)>SANDBOX_LIMITS.fileBytes*2)return json({code:'sandbox_input_too_large'},413);
 let body:unknown;
 try{body=await request.json();}catch{return json({code:'sandbox_input_invalid'},400);}
 const parsed=schemas[operation].safeParse(body);
 if(!parsed.success)return json({code:'sandbox_input_invalid',issues:parsed.error.issues.map(issue=>issue.message).slice(0,5)},400);
 const backend=backendFor(name),input=parsed.data as Record<string,unknown>;
 try{
  if(operation==='exec'){
   const timeout=input.timeoutSeconds as number,started=Date.now();
   // coreutils timeout bounds the whole process tree; 124 means it expired.
   const result=await backend.exec(['timeout','-k','5',String(timeout),'sh','-lc',input.command as string],timeout+10);
   const stdout=clip(result.stdout,SANDBOX_LIMITS.outputChars),stderr=clip(result.stderr,SANDBOX_LIMITS.outputChars);
   return json({exitCode:result.exitCode,timedOut:result.exitCode===124,durationMs:Date.now()-started,stdout:stdout.text,stderr:stderr.text,truncated:stdout.truncated||stderr.truncated});
  }
  if(operation==='write'){
   const path=input.path as string,content=input.content as string;
   if(new TextEncoder().encode(content).byteLength>SANDBOX_LIMITS.fileBytes)return json({code:'sandbox_input_too_large'},413);
   await backend.writeFile(path,content);
   return json({path,bytes:new TextEncoder().encode(content).byteLength});
  }
  if(operation==='read'){
   const path=input.path as string,offset=input.offset as number,text=await backend.readFile(path);
   const end=Math.min(text.length,offset+SANDBOX_LIMITS.readChars);
   return json({path,offset,content:text.slice(offset,end),totalChars:text.length,nextOffset:end<text.length?end:null});
  }
  if(operation==='list'){
   const path=input.path as string,entries=await backend.list(path);
   return json({path,entries:entries.slice(0,SANDBOX_LIMITS.listEntries),truncated:entries.length>SANDBOX_LIMITS.listEntries});
  }
  await backend.reset();
  return json({reset:true});
 }catch(error){
  const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'';
  if(/^E[A-Z]+$/.test(code))return json({code:'sandbox_file_error',errno:code},422);
  console.error(JSON.stringify({event:'sandbox_operation_failed',operation,error:error instanceof Error?error.name:'unknown'}));
  return json({code:'sandbox_failed'},502);
 }
}
