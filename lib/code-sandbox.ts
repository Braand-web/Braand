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
};
export type CodeSandboxTool=keyof typeof inputs;
export const codeSandboxToolNames=new Set<string>(Object.keys(inputs));
const operation:Record<CodeSandboxTool,string>={code_run:'exec',code_write_file:'write',code_read_file:'read',code_list_files:'list',code_reset:'reset'};
const str={type:'string'};
export const codeSandboxTools=[
 {name:'code_run',description:'Run a shell command (sh -lc) in this conversation’s isolated Linux sandbox, cwd /workspace. Node 24, npm/pnpm, Python 3, pip, git, build tools, sqlite3, jq and ripgrep are installed. Returns exit code, stdout, stderr (long output is clipped in the middle) and timedOut. Use it to install, build, run and test code. Internet access depends on the server configuration: if a download fails, say so instead of guessing. Never print or request secrets.',input_schema:{type:'object',properties:{command:str,timeoutSeconds:{type:'integer',minimum:1,maximum:300}},required:['command'],additionalProperties:false}},
 {name:'code_write_file',description:'Create or replace one UTF-8 text file under /workspace (parent folders are created). Write complete file contents; there is no partial patch. Max 512 KiB.',input_schema:{type:'object',properties:{path:str,content:str},required:['path','content'],additionalProperties:false}},
 {name:'code_read_file',description:'Read a UTF-8 text file under /workspace, 60000 characters at a time; follow nextOffset to continue.',input_schema:{type:'object',properties:{path:str,offset:{type:'integer',minimum:0}},required:['path'],additionalProperties:false}},
 {name:'code_list_files',description:'List the immediate entries of a directory under /workspace (default /workspace). Use code_run with find or rg for recursive searches.',input_schema:{type:'object',properties:{path:str},additionalProperties:false}},
 {name:'code_reset',description:'Destroy this conversation’s sandbox container and start fresh on the next call. All files in /workspace are lost. Use only when the environment is broken.',input_schema:{type:'object',properties:{},additionalProperties:false}},
] as const;

export async function runCodeSandboxTool(env:Record<string,unknown>,session:CodeSandboxSession,name:string,input:unknown,signal?:AbortSignal):Promise<Record<string,unknown>>{
 if(!codeSandboxToolNames.has(name))throw new AppError('Outil de bac à sable inconnu.',400,'sandbox_tool_unknown');
 if(!codeSandboxReady(env))throw new AppError('Le bac à sable de code n’est pas configuré sur ce serveur.',503,'sandbox_unavailable');
 const tool=name as CodeSandboxTool,parsed=inputs[tool].parse(input);
 if(session.calls>=CODE_SANDBOX_RUN_LIMITS.calls)throw new AppError('La limite d’opérations du bac à sable pour cette réponse est atteinte. Rends le résultat obtenu et ses limites.',409,'sandbox_run_limit');
 const timeout=tool==='code_run'?(parsed as {timeoutSeconds?:number}).timeoutSeconds??60:0;
 if(session.commandSeconds+timeout>CODE_SANDBOX_RUN_LIMITS.commandSeconds)throw new AppError('Le temps d’exécution du bac à sable pour cette réponse est épuisé. Rends le résultat obtenu et ses limites.',409,'sandbox_time_limit');
 session.calls++;
 const c=env as SandboxConfig;
 const body=tool==='code_run'?{command:(parsed as {command:string}).command,timeoutSeconds:timeout}:parsed;
 const response=await c.CODE_SANDBOX!.fetch('https://sandbox.internal/'+operation[tool],{method:'POST',headers:{authorization:'Bearer '+c.CODE_SANDBOX_CALL_TOKEN,'x-sandbox-name':session.sandboxName,'content-type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout((timeout+30)*1000)]):AbortSignal.timeout((timeout+30)*1000)});
 const result=await response.json().catch(()=>({})) as Record<string,unknown>;
 if(tool==='code_run'&&response.ok)session.commandSeconds+=Math.max(1,Math.ceil(Number(result.durationMs||0)/1000));
 if(response.ok)return result;
 const code=typeof result.code==='string'?result.code:'sandbox_failed';
 const message=code==='sandbox_file_error'?'Opération de fichier refusée par le système ('+String(result.errno||'erreur')+').':code==='sandbox_input_invalid'?'Paramètres refusés par le bac à sable : '+(Array.isArray(result.issues)?result.issues.join(', '):'entrée invalide')+'.':code==='sandbox_input_too_large'?'Contenu trop volumineux pour le bac à sable.':code==='sandbox_unavailable'||code==='sandbox_denied'?'Le bac à sable de code n’est pas disponible.':'Le bac à sable n’a pas pu terminer l’opération.';
 throw new AppError(message,response.status>=400&&response.status<500?response.status:502,code);
}
