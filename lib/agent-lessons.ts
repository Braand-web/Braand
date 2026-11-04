// Automatic operational lessons: agents learn from their own tool failures.
// Each failure is reduced to structured, non-sensitive facts (tool name, error
// code, invalid field paths and expected values from the tool schema). User
// text, tool outputs, web content and error prose never enter a lesson, so a
// lesson cannot leak data across workspaces nor be used to inject
// instructions. A pattern becomes a lesson only once repeated, is shown to
// every agent while it keeps happening, and retires by itself when it stops.
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {AppError} from './core.mjs';

const STORE='internal/agent-lessons.json',MAX_PATTERNS=200,MAX_LESSONS=8,MIN_OCCURRENCES=3,ACTIVE_DAYS=14,DAY=86400000,RELOAD=300000;
const fieldSchema=z.object({path:z.string().max(120),expected:z.string().max(120).optional()}).strict();
const patternSchema=z.object({key:z.string().max(400),tool:z.string().max(80),code:z.string().max(80),fields:z.array(fieldSchema).max(6),count:z.number().int().nonnegative(),recovered:z.number().int().nonnegative(),firstSeen:z.number(),lastSeen:z.number()}).strict();
const storeSchema=z.object({version:z.literal(1),patterns:z.array(patternSchema).max(MAX_PATTERNS)}).strict();
type Pattern=z.infer<typeof patternSchema>;
type Bucket={get(key:string):Promise<{text():Promise<string>;size:number}|null>;put(key:string,value:string):Promise<unknown>};

const SAFE=/^[a-zA-Z0-9_.:\-[\]]{1,120}$/;
const bucket=()=>(env as unknown as {BUCKET?:Bucket}).BUCKET;
let cache:{patterns:Pattern[];at:number}={patterns:[],at:0};

/** Reduce an error to safe facts. Returns null when nothing safe can be learned. */
export function lessonFacts(tool:string,error:unknown):{code:string;fields:{path:string;expected?:string}[]}|null{
 if(!SAFE.test(tool))return null;
 const zod=error instanceof z.ZodError||(!!error&&typeof error==='object'&&(error as {name?:unknown}).name==='ZodError'&&Array.isArray((error as {issues?:unknown}).issues))?error as z.ZodError:null;
 if(zod){
  const fields=zod.issues.slice(0,6).map(issue=>{
   const path=issue.path.map(String).join('.')||'(entrée)';
   const expected='expected' in issue&&typeof issue.expected==='string'&&SAFE.test(issue.expected)?issue.expected:'options' in issue&&Array.isArray(issue.options)?issue.options.map(String).filter(o=>SAFE.test(o)).slice(0,8).join('|'):undefined;
   return {path:SAFE.test(path)||path==='(entrée)'?path:'(champ)',...(expected?{expected:expected.slice(0,120)}:{}),};
  });
  return {code:'invalid_input',fields};
 }
 const code=error instanceof AppError?error.code:error&&typeof error==='object'&&typeof (error as {status?:unknown}).status==='number'?(error as {code?:unknown}).code:undefined;
 if(typeof code==='string'&&SAFE.test(code))return {code,fields:[]};
 return null;
}

async function load(){const saved=await bucket()?.get(STORE);if(!saved||saved.size>262144)return [] as Pattern[];try{return storeSchema.parse(JSON.parse(await saved.text())).patterns;}catch{return [] as Pattern[];}}
async function save(patterns:Pattern[]){const now=Date.now();const kept=patterns.filter(p=>now-p.lastSeen<=60*DAY).sort((a,b)=>b.lastSeen-a.lastSeen).slice(0,MAX_PATTERNS);await bucket()?.put(STORE,JSON.stringify({version:1,patterns:kept}));cache={patterns:kept,at:now};}

/** Record a tool failure. Never throws: learning must not break a run. */
export async function recordToolFailure(tool:string,error:unknown,now=Date.now()){
 try{
  const facts=lessonFacts(tool,error);if(!facts||!bucket())return;
  const key=[tool,facts.code,...facts.fields.map(f=>f.path)].join('|').slice(0,400);
  const patterns=await load(),found=patterns.find(p=>p.key===key);
  if(found){found.count++;found.lastSeen=now;found.fields=facts.fields;}else patterns.push({key,tool,code:facts.code,fields:facts.fields,count:1,recovered:0,firstSeen:now,lastSeen:now});
  await save(patterns);
 }catch{/* Learning is best effort. */}
}

/** Record that a tool succeeded after failing earlier in the same run. */
export async function recordToolRecovery(tool:string){
 try{if(!bucket()||!SAFE.test(tool))return;const patterns=await load();const latest=patterns.filter(p=>p.tool===tool).sort((a,b)=>b.lastSeen-a.lastSeen)[0];if(!latest)return;latest.recovered++;await save(patterns);}catch{/* best effort */}
}

function sentence(p:Pattern){
 const fields=p.fields.map(f=>f.path+(f.expected?' (attendu : '+f.expected+')':'')).join(', ');
 const recovered=p.recovered>0?' Une correction a déjà réussi '+p.recovered+' fois : applique-la dès le premier appel.':'';
 if(p.code==='invalid_input')return '`'+p.tool+'` : paramètres souvent invalides ('+p.count+' fois) sur '+(fields||'l’entrée')+'. Vérifie ces champs avant d’appeler.'+recovered;
 return '`'+p.tool+'` échoue souvent avec le code `'+p.code+'` ('+p.count+' fois). Avant de l’appeler, vérifie que la capacité est prête et adapte ta demande ; sinon propose une alternative.'+recovered;
}

/** Active lessons for the system prompt (empty when nothing is repeated). */
export async function lessonsContext(now=Date.now()){
 try{
  if(now-cache.at>RELOAD){cache={patterns:await load(),at:now};}
  const active=cache.patterns.filter(p=>p.count>=MIN_OCCURRENCES&&now-p.lastSeen<=ACTIVE_DAYS*DAY).sort((a,b)=>b.count-a.count).slice(0,MAX_LESSONS);
  if(!active.length)return '';
  return 'LEÇONS APPRISES AUTOMATIQUEMENT (erreurs récentes répétées, données techniques uniquement) :\n- '+active.map(sentence).join('\n- ');
 }catch{return '';}
}

/** Read-only view for operators. */
export async function lessonPatterns(){return load();}
