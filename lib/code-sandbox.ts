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
 import_github_repo:z.object({repo:z.string().min(3).max(300),ref:z.string().max(200).optional(),install:z.boolean().optional()}).strict(),
 start_preview:z.object({dir:path,command:z.string().min(2).max(400).optional(),port:z.number().int().min(1024).max(65535).optional()}).strict(),
};
// Bridges to workspace storage, supplied by the agent runtime (tenant-scoped).
export type CodeSandboxStorage={
 importFile(fileId:string):Promise<{body:ReadableStream<Uint8Array>;size:number}>;
 exportFile(file:{bytes:Uint8Array;name:string;mime:string}):Promise<Record<string,unknown>>;
 // The user's GitHub token for private repositories (used only inside the clone command).
 githubToken?():Promise<string|null>;
 // Keys the user entered in the secure form for this conversation (never shown to the model).
 envValues?():Promise<Record<string,string>>;
 // A signed link to the app running on this port of this conversation's sandbox.
 previewLink?(sandboxName:string,port:number):Promise<{url:string;expiresAt:number}|null>;
};
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
export type CodeSandboxTool=keyof typeof inputs;
export const codeSandboxToolNames=new Set<string>(Object.keys(inputs));
const operation:Record<CodeSandboxTool,string>={code_run:'exec',code_write_file:'write',code_read_file:'read',code_list_files:'list',code_reset:'reset',render_motion:'exec',code_import_file:'upload',code_export_file:'download',import_github_repo:'exec',start_preview:'exec'};
const str={type:'string'};
export const codeSandboxTools=[
 {name:'code_run',description:'Run a shell command (sh -lc) in this conversation’s isolated Linux sandbox, cwd /workspace. Node 24, npm/pnpm, Python 3, pip, git, build tools, sqlite3, jq and ripgrep are installed. Returns exit code, stdout, stderr (long output is clipped in the middle) and timedOut. Use it to install, build, run and test code. Internet access depends on the server configuration: if a download fails, say so instead of guessing. Never print or request secrets.',input_schema:{type:'object',properties:{command:str,timeoutSeconds:{type:'integer',minimum:1,maximum:300}},required:['command'],additionalProperties:false}},
 {name:'code_write_file',description:'Create or replace one UTF-8 text file under /workspace (parent folders are created). Write complete file contents; there is no partial patch. Max 512 KiB.',input_schema:{type:'object',properties:{path:str,content:str},required:['path','content'],additionalProperties:false}},
 {name:'code_read_file',description:'Read a UTF-8 text file under /workspace, 60000 characters at a time; follow nextOffset to continue.',input_schema:{type:'object',properties:{path:str,offset:{type:'integer',minimum:0}},required:['path'],additionalProperties:false}},
 {name:'code_list_files',description:'List the immediate entries of a directory under /workspace (default /workspace). Use code_run with find or rg for recursive searches.',input_schema:{type:'object',properties:{path:str},additionalProperties:false}},
 {name:'render_motion',description:'Render an HTML/CSS/JS motion-design composition from /workspace into a video (MP4 H.264, yuv420p, faststart) or a GIF with a deterministic virtual clock: CSS animations, Web Animations, requestAnimationFrame timelines (GSAP, anime.js, canvas) are captured frame by frame. Size the page body to width x height. Optional audio is mixed and loudness-normalised; optional poster saves a still. Then call code_export_file to deliver it.',input_schema:{type:'object',properties:{input:str,output:str,width:{type:'integer',minimum:64,maximum:3840},height:{type:'integer',minimum:64,maximum:3840},fps:{type:'integer',minimum:1,maximum:60},durationSeconds:{type:'number',minimum:0.2,maximum:180},audio:str,poster:str,quality:{type:'string',enum:['high','draft']}},required:['input','output','durationSeconds'],additionalProperties:false}},
 {name:'code_import_file',description:'Copy one of the user’s workspace files (by file id: photo, logo, video clip, music, document) into /workspace so it can be edited, cut, combined or used in a composition. Up to 200 MiB.',input_schema:{type:'object',properties:{fileId:str,path:str},required:['fileId','path'],additionalProperties:false}},
 {name:'code_export_file',description:'Deliver a finished file from /workspace (video, GIF, image, audio, subtitles, PDF, ZIP…) to the user’s Library as a downloadable file, and show it in the conversation. Up to 100 MiB for media.',input_schema:{type:'object',properties:{path:str,title:str},required:['path'],additionalProperties:false}},
 {name:'import_github_repo',description:'Clone a GitHub repository (link or owner/repo; private ones use the user’s GitHub connection) into /workspace/repos/<name>, detect its stack, package manager, dev command, port and the keys listed in .env.example, and install its dependencies (install:false to skip). Returns the folder, the run plan and the install result. Fix install errors with code_run, then call start_preview.',input_schema:{type:'object',properties:{repo:str,ref:str,install:{type:'boolean'}},required:['repo'],additionalProperties:false}},
 {name:'start_preview',description:'Start the project’s development server in the background (command and port detected from package.json unless given), wait until it answers, and return a live preview link the user can open. Keys the user entered in the secure form are written to .env.local first. If it does not start, the log tail is returned: fix the cause and call again.',input_schema:{type:'object',properties:{dir:str,command:str,port:{type:'integer',minimum:1024,maximum:65535}},required:['dir'],additionalProperties:false}},
 {name:'code_reset',description:'Destroy this conversation’s sandbox container and start fresh on the next call. All files in /workspace are lost. Use only when the environment is broken.',input_schema:{type:'object',properties:{},additionalProperties:false}},
] as const;

export async function runCodeSandboxTool(env:Record<string,unknown>,session:CodeSandboxSession,name:string,input:unknown,signal?:AbortSignal,storage?:CodeSandboxStorage):Promise<Record<string,unknown>>{
 if(!codeSandboxToolNames.has(name))throw new AppError('Outil de bac à sable inconnu.',400,'sandbox_tool_unknown');
 if(!codeSandboxReady(env))throw new AppError('Le bac à sable de code n’est pas configuré sur ce serveur.',503,'sandbox_unavailable');
 const tool=name as CodeSandboxTool,parsed=inputs[tool].parse(input);
 if(tool==='import_github_repo')return importGithubRepo(env,session,parsed as {repo:string;ref?:string;install?:boolean},signal,storage);
 if(tool==='start_preview')return startPreview(env,session,parsed as {dir:string;command?:string;port?:number},signal,storage);
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

// ——— GitHub projects: clone, install, run, preview ———
const run=(env:Record<string,unknown>,session:CodeSandboxSession,command:string,timeoutSeconds:number,signal?:AbortSignal,storage?:CodeSandboxStorage)=>runCodeSandboxTool(env,session,'code_run',{command,timeoutSeconds},signal,storage) as Promise<{exitCode?:number;stdout?:string;stderr?:string}>;

async function importGithubRepo(env:Record<string,unknown>,session:CodeSandboxSession,p:{repo:string;ref?:string;install?:boolean},signal?:AbortSignal,storage?:CodeSandboxStorage){
 const {parseRepoUrl,projectPlan,envKeys}=await import('./github-core.mjs');
 const target=parseRepoUrl(p.repo);if(!target)throw new AppError('Lien GitHub non reconnu.',400,'github_link_invalid');
 const ref=p.ref||target.ref||'',dir='/workspace/repos/'+target.repo.replace(/[^A-Za-z0-9._-]/g,'-');
 const token=await storage?.githubToken?.().catch(()=>null)||null;
 // The token exists only for the clone, in a file readable by this container's user, deleted right after.
 const askpass=token?`umask 077; printf '%s\\n' '#!/bin/sh' ${quote('echo '+quote(token))} > /tmp/.braand-askpass; chmod 700 /tmp/.braand-askpass; trap 'rm -f /tmp/.braand-askpass' EXIT; export GIT_ASKPASS=/tmp/.braand-askpass; `:'';
 const clone=await run(env,session,`set -e; ${askpass}export GIT_TERMINAL_PROMPT=0; mkdir -p /workspace/repos; rm -rf ${quote(dir)}; git clone --depth 1 ${ref?'--branch '+quote(ref)+' ':''}${quote(`https://${token?'x-access-token@':''}github.com/${target.owner}/${target.repo}.git`)} ${quote(dir)} 2>&1 | tail -5; rm -f /tmp/.braand-askpass; cd ${quote(dir)}; echo "---COMMIT---"; git log -1 --format='%h %s'; echo "---FILES---"; git ls-files | head -3000; echo "---PKG---"; head -c 20000 package.json 2>/dev/null || true; echo; echo "---ENV---"; cat .env.example .env.sample .env.local.example .env.template 2>/dev/null | head -c 8000 || true`,120,signal,storage);
 const out=String(clone.stdout||'');
 if(clone.exitCode!==0||!out.includes('---COMMIT---'))throw new AppError(token?'Le dépôt n’a pas pu être cloné. Vérifiez le lien et l’accès de votre compte GitHub.':'Le dépôt n’a pas pu être cloné. S’il est privé, connectez votre compte GitHub dans Paramètres › Connexions.',400,'github_clone_failed');
 const section=(name:string,next:string)=>{const start=out.indexOf('---'+name+'---');if(start<0)return '';const from=start+name.length+7,end=next?out.indexOf('---'+next+'---',from):-1;return out.slice(from,end<0?undefined:end).trim();};
 const files=section('FILES','PKG').split('\n').filter(Boolean);let pkg:Record<string,unknown>|null=null;try{pkg=JSON.parse(section('PKG','ENV')||'null');}catch{pkg=null;}
 const plan=projectPlan(files,pkg),keys=envKeys(section('ENV',''));
 let install:{exitCode:number;tail:string}|null=null;
 if(p.install!==false&&plan.install&&!plan.monorepo){
  const result=await run(env,session,`cd ${quote(dir)} && CI=1 ${plan.install} > /tmp/braand-install.log 2>&1; code=$?; tail -c 3000 /tmp/braand-install.log; exit $code`,300,signal,storage);
  install={exitCode:Number(result.exitCode??1),tail:String(result.stdout||'').slice(-3000)};
 }
 return {dir,repo:`${target.owner}/${target.repo}`,commit:section('COMMIT','FILES'),files:files.length,plan,env:{keys:keys.map(k=>k.name),missing:keys.filter(k=>!k.hasDefault&&!k.public).map(k=>k.name)},install,
  note:install&&install.exitCode!==0?'L’installation a échoué : lis la fin du journal, corrige (version de Node, gestionnaire, dépendance), puis relance.':keys.some(k=>!k.hasDefault&&!k.public)?'Des clés sont nécessaires : propose à l’utilisateur de les saisir dans le formulaire sécurisé (request_env_keys) ou de lancer sans elles si le projet le permet ; ne les demande jamais dans la discussion.':'Prêt : appelle start_preview avec dir.'};
}

async function startPreview(env:Record<string,unknown>,session:CodeSandboxSession,p:{dir:string;command?:string;port?:number},signal?:AbortSignal,storage?:CodeSandboxStorage){
 if(!storage?.previewLink)throw new AppError('L’aperçu en direct n’est pas disponible ici.',503,'preview_unavailable');
 const values=await storage.envValues?.().catch(()=>({}))||{};
 if(Object.keys(values).length){
  const lines=Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
  await runCodeSandboxTool(env,session,'code_write_file',{path:p.dir.replace(/\/$/,'')+'/.env.local',content:lines},signal,storage);
 }
 let command=p.command,port=p.port;
 if(!command||!port){
  const {projectPlan}=await import('./github-core.mjs');
  const info=await run(env,session,`cd ${quote(p.dir)} && git ls-files 2>/dev/null | head -3000; ls -a; echo "---PKG---"; head -c 20000 package.json 2>/dev/null || true`,30,signal,storage);
  const [list,pkgText]=String(info.stdout||'').split('---PKG---');let pkg:Record<string,unknown>|null=null;try{pkg=JSON.parse((pkgText||'').trim()||'null');}catch{pkg=null;}
  const plan=projectPlan(list.split('\n').map(line=>line.trim()).filter(Boolean),pkg);
  port??=plan.port;
  if(!command){
   if(!plan.dev)throw new AppError('Aucune commande de lancement trouvée : indique command (par exemple "npm run dev").',400,'preview_command_missing');
   const args=/Next/.test(plan.framework||'')?`-H 0.0.0.0 -p ${port}`:/Vite|Vue|Astro|SvelteKit/.test(plan.framework||'')?`--host 0.0.0.0 --port ${port}`:'';
   command=args?(plan.manager==='npm'?`${plan.dev} -- ${args}`:`${plan.dev} ${args}`):plan.dev;
  }
 }
 const start=await run(env,session,`cd ${quote(p.dir)} && (kill $(cat /workspace/.braand-preview.pid 2>/dev/null) 2>/dev/null || true) && HOST=0.0.0.0 HOSTNAME=0.0.0.0 PORT=${port} BROWSER=none nohup sh -lc ${quote(command!)} > /workspace/.braand-preview.log 2>&1 & echo $! > /workspace/.braand-preview.pid; for i in $(seq 1 80); do if curl -s -o /dev/null --max-time 2 http://127.0.0.1:${port}/; then echo READY; exit 0; fi; sleep 2; done; echo NOT_READY; tail -c 3000 /workspace/.braand-preview.log; exit 1`,200,signal,storage);
 if(start.exitCode!==0||!String(start.stdout||'').includes('READY'))return {started:false,command,port,log:String(start.stdout||'').slice(-3000),note:'Le serveur ne répond pas : lis le journal, corrige la cause (clé manquante, port, dépendance), puis rappelle start_preview.'};
 const link=await storage.previewLink(session.sandboxName,port!);
 if(!link)throw new AppError('L’aperçu en direct n’est pas encore activé sur ce serveur.',503,'preview_unavailable');
 return {started:true,command,port,previewUrl:link.url,expiresAt:link.expiresAt,note:'Donne ce lien à l’utilisateur (« Ouvrir l’aperçu »). Il reste valable 2 heures ; le projet s’arrête après 10 minutes sans activité et se relance avec start_preview.'};
}
