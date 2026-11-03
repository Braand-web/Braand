// Coding-agent access to the isolated code sandbox Worker (services/code-sandbox).
// The sandbox is reached only through the CODE_SANDBOX service binding with a
// call token; it receives no Braand secret, credential or database. Each
// conversation of a workspace gets its own container, and every run is bounded.
import {z} from 'zod';
import {AppError} from './core.mjs';

type SandboxConfig={CODE_SANDBOX?:Fetcher;CODE_SANDBOX_ENABLED?:string;CODE_SANDBOX_CALL_TOKEN?:string};
export const CODE_SANDBOX_RUN_LIMITS=Object.freeze({calls:60,commandSeconds:900});
export type CodeSandboxSession={calls:number;commandSeconds:number;sandboxName:string};

export function codeSandboxReady(env:Record<string,unknown>){
 const c=env as SandboxConfig;
 return !!c.CODE_SANDBOX&&typeof c.CODE_SANDBOX.fetch==='function'&&c.CODE_SANDBOX_ENABLED==='true'&&typeof c.CODE_SANDBOX_CALL_TOKEN==='string'&&c.CODE_SANDBOX_CALL_TOKEN.length>=32;
}
// One container per workspace conversation, named by an opaque hash so the
// sandbox Worker never learns workspace or conversation identifiers.
export async function codeSandboxSession(tenant:string,conversationId:string):Promise<CodeSandboxSession>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('braand-code-sandbox:v1:'+tenant+':'+conversationId));
 const sandboxName=Array.from(new Uint8Array(digest).slice(0,20),byte=>byte.toString(16).padStart(2,'0')).join('');
 return {calls:0,commandSeconds:0,sandboxName};
}

const path=z.string().min(1).max(512);
const inputs={
 code_run:z.object({command:z.string().min(1).max(8000),timeoutSeconds:z.number().int().min(1).max(300).optional()}).strict(),
 code_write_file:z.object({path,content:z.string().max(512*1024)}).strict(),
 code_read_file:z.object({path,offset:z.number().int().min(0).optional()}).strict(),
 code_list_files:z.object({path:path.optional()}).strict(),
 code_reset:z.object({}).strict(),
 render_motion:z.object({input:path,output:path.regex(/\.(mp4|gif)$/i),width:z.number().int().min(64).max(3840).refine(n=>n%2===0,'even').default(1080),height:z.number().int().min(64).max(3840).refine(n=>n%2===0,'even').default(1920),fps:z.number().int().min(1).max(60).default(30),durationSeconds:z.number().min(0.2).max(180),audio:path.optional(),poster:path.optional(),quality:z.enum(['high','draft']).default('high')}).strict().refine(v=>v.durationSeconds*v.fps<=5400,'too_many_frames'),
 code_import_file:z.object({fileId:z.string().min(1).max(160),path}).strict(),
 code_export_file:z.object({path,title:z.string().trim().min(1).max(160).optional()}).strict(),
};
// Bridges to workspace storage, supplied by the agent runtime (tenant-scoped).
export type CodeSandboxStorage={
 importFile(fileId:string):Promise<{body:ReadableStream<Uint8Array>;size:number}>;
 exportFile(file:{bytes:Uint8Array;name:string;mime:string}):Promise<Record<string,unknown>>;
};
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
export type CodeSandboxTool=keyof typeof inputs;
export const codeSandboxToolNames=new Set<string>(Object.keys(inputs));
const operation:Record<CodeSandboxTool,string>={code_run:'exec',code_write_file:'write',code_read_file:'read',code_list_files:'list',code_reset:'reset',render_motion:'exec',code_import_file:'upload',code_export_file:'download'};
const str={type:'string'};
export const codeSandboxTools=[
 {name:'code_run',description:'Run a shell command (sh -lc) in this conversation’s isolated Linux sandbox, cwd /workspace. Node 24, npm/pnpm, Python 3, pip, git, build tools, sqlite3, jq and ripgrep are installed. Returns exit code, stdout, stderr (long output is clipped in the middle) and timedOut. Use it to install, build, run and test code. Internet access depends on the server configuration: if a download fails, say so instead of guessing. Never print or request secrets.',input_schema:{type:'object',properties:{command:str,timeoutSeconds:{type:'integer',minimum:1,maximum:300}},required:['command'],additionalProperties:false}},
 {name:'code_write_file',description:'Create or replace one UTF-8 text file under /workspace (parent folders are created). Write complete file contents; there is no partial patch. Max 512 KiB.',input_schema:{type:'object',properties:{path:str,content:str},required:['path','content'],additionalProperties:false}},
 {name:'code_read_file',description:'Read a UTF-8 text file under /workspace, 60000 characters at a time; follow nextOffset to continue.',input_schema:{type:'object',properties:{path:str,offset:{type:'integer',minimum:0}},required:['path'],additionalProperties:false}},
 {name:'code_list_files',description:'List the immediate entries of a directory under /workspace (default /workspace). Use code_run with find or rg for recursive searches.',input_schema:{type:'object',properties:{path:str},additionalProperties:false}},
 {name:'render_motion',description:'Render an HTML/CSS/JS motion-design composition from /workspace into a video (MP4 H.264, yuv420p, faststart) or a GIF with a deterministic virtual clock: CSS animations, Web Animations, requestAnimationFrame timelines (GSAP, anime.js, canvas) are captured frame by frame. Size the page body to width x height. Optional audio is mixed and loudness-normalised; optional poster saves a still. Then call code_export_file to deliver it.',input_schema:{type:'object',properties:{input:str,output:str,width:{type:'integer',minimum:64,maximum:3840},height:{type:'integer',minimum:64,maximum:3840},fps:{type:'integer',minimum:1,maximum:60},durationSeconds:{type:'number',minimum:0.2,maximum:180},audio:str,poster:str,quality:{type:'string',enum:['high','draft']}},required:['input','output','durationSeconds'],additionalProperties:false}},
 {name:'code_import_file',description:'Copy one of the user’s workspace files (by file id: photo, logo, video clip, music, document) into /workspace so it can be edited, cut, combined or used in a composition. Up to 200 MiB.',input_schema:{type:'object',properties:{fileId:str,path:str},required:['fileId','path'],additionalProperties:false}},
 {name:'code_export_file',description:'Deliver a finished file from /workspace (video, GIF, image, audio, subtitles, PDF, ZIP…) to the user’s Library as a downloadable file, and show it in the conversation. Up to 100 MiB for media.',input_schema:{type:'object',properties:{path:str,title:str},required:['path'],additionalProperties:false}},
 {name:'code_reset',description:'Destroy this conversation’s sandbox container and start fresh on the next call. All files in /workspace are lost. Use only when the environment is broken.',input_schema:{type:'object',properties:{},additionalProperties:false}},
] as const;

export async function runCodeSandboxTool(env:Record<string,unknown>,session:CodeSandboxSession,name:string,input:unknown,signal?:AbortSignal,storage?:CodeSandboxStorage):Promise<Record<string,unknown>>{
 if(!codeSandboxToolNames.has(name))throw new AppError('Outil de bac à sable inconnu.',400,'sandbox_tool_unknown');
 if(!codeSandboxReady(env))throw new AppError('Le bac à sable de code n’est pas configuré sur ce serveur.',503,'sandbox_unavailable');
 const tool=name as CodeSandboxTool,parsed=inputs[tool].parse(input);
 if(session.calls>=CODE_SANDBOX_RUN_LIMITS.calls)throw new AppError('La limite d’opérations du bac à sable pour cette réponse est atteinte. Rends le résultat obtenu et ses limites.',409,'sandbox_run_limit');
 const motion=tool==='render_motion'?parsed as {input:string;output:string;width:number;height:number;fps:number;durationSeconds:number;audio?:string;poster?:string;quality:'high'|'draft'}:undefined;
 // Rendering speed is bounded by one screenshot per frame; budget generously but finitely.
 const timeout=tool==='code_run'?(parsed as {timeoutSeconds?:number}).timeoutSeconds??60:motion?Math.min(300,Math.max(60,Math.ceil(motion.durationSeconds*motion.fps*(motion.quality==='draft'?0.25:0.45))+30)):0;
 if(session.commandSeconds+timeout>CODE_SANDBOX_RUN_LIMITS.commandSeconds)throw new AppError('Le temps d’exécution du bac à sable pour cette réponse est épuisé. Rends le résultat obtenu et ses limites.',409,'sandbox_time_limit');
 session.calls++;
 const c=env as SandboxConfig,headers={authorization:'Bearer '+c.CODE_SANDBOX_CALL_TOKEN,'x-sandbox-name':session.sandboxName};
 const deadline=()=>signal?AbortSignal.any([signal,AbortSignal.timeout((timeout+60)*1000)]):AbortSignal.timeout((timeout+60)*1000);
 if(tool==='code_import_file'){
  if(!storage)throw new AppError('Le transfert de fichiers n’est pas disponible ici.',503,'sandbox_storage_unavailable');
  const p=parsed as {fileId:string;path:string},file=await storage.importFile(p.fileId);
  const response=await c.CODE_SANDBOX!.fetch('https://sandbox.internal/upload?path='+encodeURIComponent(p.path),{method:'POST',headers:{...headers,'content-type':'application/octet-stream','content-length':String(file.size)},body:file.body,signal:deadline()});
  const result=await response.json().catch(()=>({})) as Record<string,unknown>;if(!response.ok)throw new AppError('Le fichier n’a pas pu être copié dans le bac à sable.',response.status>=400&&response.status<500?response.status:502,typeof result.code==='string'?result.code:'sandbox_failed');
  return {...result,fileId:p.fileId};
 }
 if(tool==='code_export_file'){
  if(!storage)throw new AppError('Le transfert de fichiers n’est pas disponible ici.',503,'sandbox_storage_unavailable');
  const p=parsed as {path:string;title?:string};
  const response=await c.CODE_SANDBOX!.fetch('https://sandbox.internal/download?path='+encodeURIComponent(p.path),{method:'POST',headers,signal:deadline()});
  if(!response.ok){const result=await response.json().catch(()=>({})) as Record<string,unknown>;throw new AppError(result.code==='sandbox_input_too_large'?'Ce fichier est trop volumineux pour être livré.':result.code==='sandbox_input_invalid'?'Ce type de fichier ne peut pas être livré.':'Le fichier n’a pas pu être récupéré.',response.status>=400&&response.status<500?response.status:502,typeof result.code==='string'?result.code:'sandbox_failed');}
  const bytes=new Uint8Array(await response.arrayBuffer()),base=p.path.split('/').pop()||'rendu',extension=base.includes('.')?base.slice(base.lastIndexOf('.')):'';
  const cleanTitle=p.title?p.title.replace(/[\\/:*?"<>|]+/g,' ').trim():'';
  const name=cleanTitle?cleanTitle+(cleanTitle.toLowerCase().endsWith(extension.toLowerCase())?'':extension):base;
  const resource=await storage.exportFile({bytes,name,mime:(response.headers.get('content-type')||'application/octet-stream').split(';')[0]});
  return {exported:true,path:p.path,bytes:bytes.length,resource};
 }
 const body=tool==='code_run'?{command:(parsed as {command:string}).command,timeoutSeconds:timeout}:motion?{command:['render-motion','--input',quote(motion.input),'--output',quote(motion.output),'--width',String(motion.width),'--height',String(motion.height),'--fps',String(motion.fps),'--duration',String(motion.durationSeconds),'--quality',motion.quality,...(motion.audio?['--audio',quote(motion.audio)]:[]),...(motion.poster?['--poster',quote(motion.poster)]:[])].join(' '),timeoutSeconds:timeout}:parsed;
 const response=await c.CODE_SANDBOX!.fetch('https://sandbox.internal/'+operation[tool],{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body),signal:deadline()});
 const result=await response.json().catch(()=>({})) as Record<string,unknown>;
 if((tool==='code_run'||motion)&&response.ok)session.commandSeconds+=Math.max(1,Math.ceil(Number(result.durationMs||0)/1000));
 if(response.ok)return result;
 const code=typeof result.code==='string'?result.code:'sandbox_failed';
 const message=code==='sandbox_file_error'?'Opération de fichier refusée par le système ('+String(result.errno||'erreur')+').':code==='sandbox_input_invalid'?'Paramètres refusés par le bac à sable : '+(Array.isArray(result.issues)?result.issues.join(', '):'entrée invalide')+'.':code==='sandbox_input_too_large'?'Contenu trop volumineux pour le bac à sable.':code==='sandbox_unavailable'||code==='sandbox_denied'?'Le bac à sable de code n’est pas disponible.':'Le bac à sable n’a pas pu terminer l’opération.';
 throw new AppError(message,response.status>=400&&response.status<500?response.status:502,code);
}
