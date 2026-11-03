// Actual proposal handler and provider validator, deterministic transport only.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mediaQuoteFingerprint} from '../lib/media-routing.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/media-approval-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
const fixture={env:{},resource:null,reservations:0,submissions:0,allowed:true};globalThis.__mediaApprovalFixture=fixture;
await build({entryPoints:[path.join(root,'app/api/proposals/[id]/route.ts')],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'private-media-fixture',setup(builder){
 builder.onResolve({filter:/^@\/lib\/(?:work|media-render|media-jobs|media-plans)$/},a=>({path:a.path,namespace:'platform-fixture'}));
 builder.onLoad({filter:/.*/,namespace:'platform-fixture'},a=>({contents:a.path.endsWith('/work')?'export async function linkMediaWork(){}export async function wakeWorkForResource(){}':a.path.endsWith('/media-plans')?'export async function approveMediaPlan(){throw Error("Not a media approval path");}export async function advanceMediaPlan(){throw Error("Not a media approval path");}export function mediaPlanState(){throw Error("Not a media approval path");}':a.path.endsWith('/media-render')?'export async function approveAssembly(){throw Error("Not a media approval path");}export async function assemblyState(){throw Error("Not a media approval path");}':'export async function pollMediaProposal(){throw Error("Polling is covered separately");}'}));
 builder.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'fixture'}));
 builder.onResolve({filter:/^@\/lib\/billing$/},()=>({path:'billing',namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='billing'?`export async function reserve(){globalThis.__mediaApprovalFixture.reservations++;return {id:'media-hold'};}export async function settleHold(){}`:`
 const f=globalThis.__mediaApprovalFixture;
 export const config=()=>f.env;
 export async function authorize(){if(!f.allowed)throw Object.assign(new Error('Approval denied'),{status:403,code:'forbidden'});}
 export async function identity(){await authorize();return {user:{userId:'user'},tenant:'workspace',organization:'organization'};}
 export const db=()=>({prepare(sql){return {bind(){return this;},async first(){return null;},async run(){return {meta:{changes:1}};}};}});
 export async function getResource(tenant){if(tenant!=='workspace')throw Error('Scope');return f.resource;}
 export async function updateResource(){return f.resource;}
 export async function auditLog(){}
 export async function unseal(){throw Error('No Meta in fixture');}
 export function failure(error){return Response.json({error:error.message,code:error.code},{status:error.status||500});}
 `}));
}}]});
const {POST}=await import(pathToFileURL(out).href);
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url)=>{assert.equal(url,'https://queue.fal.run/google/nano-banana-2.1');fixture.submissions++;return Response.json({request_id:'fixture-request'});};
const schema={type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string',maxLength:100},image_urls:{type:'array',maxItems:2,items:{type:'string',maxLength:200}}}};
const model=()=>({id:'google/nano-banana-2.1',name:'Test image',kind:'image',credits:6,costCeilingXaf:24,verifiedAt:new Date(Date.now()-1000).toISOString(),inputSchema:schema,description:'Fixture only'});
let selected,params,checks=0;
async function reset(input={prompt:'Product'}){selected=model();params=input;fixture.env={FAL_KEY:'fixture-not-a-key',FAL_CATALOG_JSON:JSON.stringify([selected])};fixture.resource={id:'proposal',kind:'proposal',version:1,status:'awaiting_approval',title:'Test',data:{kind:'media',title:'Test',rationale:'Test only',maxCredits:6,payload:{model:selected.id,input,quoteFingerprint:await mediaQuoteFingerprint(selected,input)}}};fixture.allowed=true;fixture.reservations=0;fixture.submissions=0;}
const request=()=>POST(new Request('http://localhost/api/proposals/proposal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1})}),{params:Promise.resolve({id:'proposal'})});
async function check(label,work){await reset();await work();checks++;console.log('PASS '+label);}
try{
 await check('Versioned model IDs with dots submit only after the exact valid quote is approved',async()=>{const response=await request();assert.equal(response.status,200);assert.equal(fixture.reservations,1);assert.equal(fixture.submissions,1);});
 await check('Tariff refresh invalidates the pending media quote before reservation or generation',async()=>{fixture.env.FAL_CATALOG_JSON=JSON.stringify([{...selected,costCeilingXaf:23}]);const response=await request();assert.equal(response.status,409);assert.equal((await response.json()).code,'media_stale_quote');assert.equal(fixture.reservations,0);assert.equal(fixture.submissions,0);});
 await check('Changed prompt invalidates the exact quoted arguments',async()=>{fixture.resource.data.payload.input={...params,prompt:'Another product'};const response=await request();assert.equal(response.status,409);assert.equal(fixture.submissions,0);});
 await check('Revoked approval rights block before credit reservation and transport',async()=>{fixture.allowed=false;const response=await request();assert.equal(response.status,403);assert.equal(fixture.reservations,0);assert.equal(fixture.submissions,0);});
 await check('Private reference destinations fail before either reservation or provider transport',async()=>{await reset({prompt:'Product',image_urls:['https://127.0.0.1/private.png']});const response=await request();assert.notEqual(response.status,200);assert.equal(fixture.reservations,0);assert.equal(fixture.submissions,0);});
 await check('Unpriced extra outputs are rejected even when the proposal resource has been tampered with',async()=>{fixture.resource.data.payload.input={prompt:'Product',num_images:100};const response=await request();assert.equal(response.status,409);assert.equal(fixture.reservations,0);assert.equal(fixture.submissions,0);});
 console.log(`${checks} media approval integration checks passed; zero real provider calls.`);
}finally{globalThis.fetch=originalFetch;delete globalThis.__mediaApprovalFixture;}
