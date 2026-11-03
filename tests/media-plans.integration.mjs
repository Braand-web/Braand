// Media plans: one approval, one budget, parallel steps, visual review with a
// corrected retry, validated fallback on provider refusal, step references
// and final settlement never above the approved budget. Deterministic fakes only.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/media-plans-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
const now=new Date().toISOString();
const schema={type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string',maxLength:4000},image_url:{type:'string',format:'uri'}}};
const catalog=[
 {id:'google/nano-banana-2.1',name:'Image A',kind:'image',credits:10,costCeilingXaf:30,verifiedAt:now,inputSchema:schema,description:'image',tasks:['image']},
 {id:'openai/gpt-image-2',name:'Image B',kind:'image',credits:12,costCeilingXaf:40,verifiedAt:now,inputSchema:schema,description:'image',tasks:['image']},
 {id:'bytedance/seedance-2.5/image-to-video',name:'Video',kind:'video',credits:40,costCeilingXaf:150,verifiedAt:now,inputSchema:{...schema,required:['prompt','image_url']},description:'video',tasks:['video_from_image']},
];
const f={env:{FAL_KEY:'fal-test',FAL_CATALOG_JSON:JSON.stringify(catalog),ANTHROPIC_API_KEY:'anthropic-test',LLM_PROVIDER:'anthropic'},resources:new Map(),ops:new Map(),holds:[],settled:[],nextId:1};
globalThis.__planFixture=f;

await build({entryPoints:[path.join(root,'lib/media-plans.ts')],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'error',plugins:[{name:'plan-fixture',setup(b){
 b.onResolve({filter:/^\.\/(server|billing|fal-storage|work|metering)$/},a=>({path:a.path.slice(2),namespace:'fx'}));
 b.onLoad({filter:/.*/,namespace:'fx'},a=>({loader:'js',contents:{
  billing:`const f=globalThis.__planFixture;export async function reserve(who,ref,units){f.holds.push({ref,units});return {id:'hold-1'};}export async function settleHold(id,units){f.settled.push({id,units});}`,
  'fal-storage':`export async function uploadLibraryFileToFal(t,id){return 'https://fal.media/files/library/'+id+'.png';}`,
  work:`export async function wakeWorkForResource(){}`,
  metering:`export function modelRate(){return {input:5,output:25,usdXaf:600,overheadXaf:0};}`,
  server:`const f=globalThis.__planFixture;
  export const config=()=>f.env;
  export async function authorize(){}
  export async function unseal(){throw Error("no meta");}
  export async function auditLog(){}
  export async function getResource(t,id){const r=f.resources.get(id);if(!r)throw Error('missing '+id);return structuredClone(r);}
  export async function createResource(tenant,kind,title,data,status){const id='res-'+(f.nextId++);const r={id,workspace_id:tenant,kind,title,data,status,version:1,created_at:0,updated_at:0};f.resources.set(id,r);return structuredClone(r);}
  export async function updateResource(t,id,version,patch){const r=f.resources.get(id);if(r.version!==version)throw Object.assign(Error('stale'),{status:409});Object.assign(r,patch.data?{data:patch.data}:{},patch.status?{status:patch.status}:{});r.version++;return structuredClone(r);}
  const stmt=(sql,args)=>({sql,args,async run(){if(/^INSERT OR IGNORE INTO operations/.test(sql)){if(f.ops.has(args[0]))return {meta:{changes:0}};f.ops.set(args[0],{status:sql.includes("'completed'")?'completed':sql.includes("'plan_running'")?'plan_running':'plan_submitting',amount:args[3],detail:args[4]});return {meta:{changes:1}};}
   if(/^UPDATE operations SET status='plan_waiting'/.test(sql)){const o=f.ops.get(args[2]);o.status='plan_waiting';o.external_id=args[0];}
   else if(/^UPDATE operations SET status='(rejected|needs_reconciliation)'/.test(sql)){f.ops.get(args[1]).status=sql.match(/status='(\\w+)'/)[1];}
   else if(/INTO resources/.test(sql)){f.resources.set(args[0],{id:args[0],workspace_id:args[1],kind:'media',title:args[2],data:JSON.parse(args[3]),status:'ready',version:1});}
   return {meta:{changes:1}};},
   async first(){if(/FROM operations WHERE id=/.test(sql))return f.ops.get(args[0])||null;return null;},async all(){return {results:[]};}});
  export const db=()=>({prepare(sql){return {bind(...args){return stmt(sql,args);}};},async batch(list){for(const s of list)await s.run();}});`,
 }[a.path]}));
}}]});
const plans=await import(pathToFileURL(out).href);

// Fake fal queue and review model.
const fal={submissions:[],reject:new Set(),results:new Map(),reviews:[]};let counter=0;
globalThis.fetch=async(url,init={})=>{
 const href=String(url);
 if(href.startsWith('https://queue.fal.run/')&&init.method==='POST'){
  const model=href.slice('https://queue.fal.run/'.length),body=JSON.parse(init.body);
  if(fal.reject.has(model))return Response.json({detail:'unsupported'},{status:422});
  const id='req-'+(++counter);fal.submissions.push({model,body,id});
  const ext=model.includes('video')?'mp4':'png';fal.results.set(id,{[ext==='mp4'?'video':'images']:ext==='mp4'?{url:`https://fal.media/files/${id}.mp4`}:[{url:`https://fal.media/files/${id}.png`}]});
  return Response.json({request_id:id});
 }
 if(href.includes('/requests/')){const id=decodeURIComponent(href.split('/requests/')[1].split('/')[0]);if(href.endsWith('/status'))return Response.json({status:'COMPLETED'});return Response.json(fal.results.get(id));}
 if(href==='https://api.anthropic.com/v1/messages'){
  const body=JSON.parse(init.body),image=body.messages[0].content.find(part=>part.type==='image').source.url;fal.reviews.push(image);
  // The first image of the hero step fails review once.
  const pass=!(image.endsWith('req-1.png'));
  return Response.json({usage:{input_tokens:1600,output_tokens:300},content:[{type:'text',text:JSON.stringify({pass,issues:pass?[]:['Texte du logo illisible'],fix:'Make the logo text crisp and legible.'})}]});
 }
 throw Error('Unexpected network call '+href);
};

const who={tenant:'workspace',organization:'org',role:'owner',user:{userId:'user',email:'',displayName:''}};
const steps=[
 {id:'hero',label:'Visuel héros',task:'image',input:{prompt:'Serum bottle on marble, softbox light, 85mm'},review:['Le logo est lisible']},
 {id:'ugc',label:'Variante lifestyle',task:'image',input:{prompt:'Woman applying serum in bathroom, phone photo'},references:[{field:'image_url',fileId:'file-logo'}]},
 {id:'motion',label:'Héros animé',task:'video_from_image',input:{prompt:'Slow push-in, light sweep'},references:[{field:'image_url',fromStep:'hero'}]},
];

await assert.rejects(plans.prepareMediaPlan('workspace',{title:'Lancement',rationale:'Test',steps,budgetCredits:20}),/au moins 66 crédits/);
const proposal=await plans.prepareMediaPlan('workspace',{title:'Lancement',rationale:'Test',steps,budgetCredits:90});
assert.equal(proposal.status,'awaiting_approval');assert.equal(proposal.data.kind,'media_plan');assert.equal(proposal.data.payload.expectedCredits,66);
assert.equal(fal.submissions.length,0,'Preparing a plan never generates');

await plans.approveMediaPlan(who,proposal.id,proposal.version);
assert.deepEqual(f.holds,[{ref:'media_plan:'+proposal.id+':1',units:9000}]);

let state=await plans.advanceMediaPlan('workspace',proposal.id);
assert.deepEqual(fal.submissions.map(s=>s.model),['google/nano-banana-2.1','google/nano-banana-2.1'],'Independent steps start in parallel');
assert.equal(fal.submissions[1].body.image_url,'https://fal.media/files/library/file-logo.png','Library references are sent to fal');
assert.equal(state.steps.find(s=>s.id==='motion').status,'pending','Dependent step waits');

state=await plans.advanceMediaPlan('workspace',proposal.id);
const hero=state.steps.find(s=>s.id==='hero');
assert.equal(hero.status,'running');assert.equal(hero.review.pass,false,'Review rejected the first hero');
assert.equal(state.steps.find(s=>s.id==='ugc').status,'done');

state=await plans.advanceMediaPlan('workspace',proposal.id);
assert.match(fal.submissions[2].body.prompt,/crisp and legible/,'Corrected prompt is resubmitted');
state=await plans.advanceMediaPlan('workspace',proposal.id);
assert.equal(state.steps.find(s=>s.id==='hero').status,'done');

const video=fal.submissions.at(-1);
assert.equal(video.model,'bytedance/seedance-2.5/image-to-video','The dependent video starts as soon as its reference is accepted');
assert.equal(video.body.image_url,'https://fal.media/files/req-3.png','Video uses the accepted hero output');
state=await plans.advanceMediaPlan('workspace',proposal.id);
assert.equal(state.status,'completed');
assert.equal(state.spent,10+10+3+10+3+40,'Two images, one corrected retry, two reviews at their real token cost and one video');
assert.deepEqual(f.settled,[{id:'hold-1',units:state.spent*100}]);
assert.ok(state.spent<=90);
assert.ok(f.resources.has('media:plan:'+proposal.id+':hero'),'Accepted outputs become library media');

// Fallback: a refused image model switches to the next validated model within the budget.
fal.submissions.length=0;fal.reject.add('google/nano-banana-2.1');f.holds.length=0;f.settled.length=0;
const second=await plans.prepareMediaPlan('workspace',{title:'Variante',rationale:'Test',steps:[{id:'a',label:'A',task:'image',input:{prompt:'Product on sand'}}],budgetCredits:30});
await plans.approveMediaPlan(who,second.id,second.version);
await plans.advanceMediaPlan('workspace',second.id);
await plans.advanceMediaPlan('workspace',second.id);
assert.deepEqual(fal.submissions.map(s=>s.model),['openai/gpt-image-2'],'Equivalent validated model after a refusal');
state=await plans.advanceMediaPlan('workspace',second.id);
assert.equal(state.status,'completed');assert.equal(state.spent,12);

console.log('PASS media plans: single approval, parallel steps, review and corrected retry, library and step references, validated fallback, budget-bounded settlement');
