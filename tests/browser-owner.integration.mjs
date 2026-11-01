// Execute the actual Durable Object dispatch/alarm implementation with a local
// storage fixture. This proves scheduling and serialization, not Cloudflare uptime.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),outfile=path.join(root,'.local-build/browser-owner-test.mjs');mkdirSync(path.dirname(outfile),{recursive:true});
const fixture={active:1,status:'running',provider_state:'open',provider_id:'retained',calls:[],turns:0,abort:0,fail:false,driver:null};globalThis.__browserOwnerFixture=fixture;
await build({nodePaths:process.env.BRAAND_TOOLCHAIN?[process.env.BRAAND_TOOLCHAIN]:[],entryPoints:[path.join(root,'lib/browser-session-do.ts')],outfile,bundle:true,format:'esm',platform:'node',plugins:[{name:'local-owner',setup(b){
 b.onResolve({filter:/^\.\/(browser-live|browser-credential-broker)$/},a=>({path:a.path,namespace:'auxiliary'}));b.onLoad({filter:/.*/,namespace:'auxiliary'},a=>({contents:a.path==='./browser-live'?'export async function browserLiveSocket(){return new Response(null,{status:409});}':'export class BrowserCredentialBroker {async handle(){return new Response(null,{status:403});}}'}));
 b.onResolve({filter:/^(?:cloudflare:workers|\.\/browser(?:-agent|-driver|-runtime)?)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='cloudflare:workers'?`export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}`:a.path==='./browser-driver'?`export function createBrowserDriver(){return globalThis.__browserOwnerFixture.driver;}`:a.path==='./browser-runtime'?`export const browserRPCPrefix=id=>'_browser_rpc/'+id+'/';export function runWithBrowserDriver(_id,_driver,work){return work();}`:a.path==='./browser-agent'?`export async function runBrowserAgentTurn(){const f=globalThis.__browserOwnerFixture;f.turns++;if(f.fail)throw Error('lost request');f.status='awaiting_approval';}`:`const f=globalThis.__browserOwnerFixture;export async function browserCleanup(){}export async function getBrowserExecution(){return f.active&&f.status==='running'?{session:{id:'job'}}:null;}export async function browserAbortExecution(){f.abort++;f.active=0;f.status='uncertain';}` }));
}}]});
const {BrowserSession}=await import(pathToFileURL(outfile).href),stored=new Map(),alarms=[];
const storage={async get(key){return stored.get(key);},async put(key,value){stored.set(key,value);},async setAlarm(at){alarms.push(at);}};
const env={BROWSER:{},DB:{prepare(){return {bind(){return {async first(){return {...fixture};}};}};}}};
let pendingResolve,concurrent=0,maxConcurrent=0;
fixture.driver={async observe(){concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);fixture.calls.push('observe');if(pendingResolve===undefined)await new Promise(resolve=>pendingResolve=resolve);concurrent--;return {title:'fixture'};},async open(){fixture.calls.push('open');return {sessionId:'retained'};},async close(){fixture.calls.push('close');return {status:'complete'};}};
const owner=new BrowserSession({storage},env),id='11111111-1111-4111-8111-111111111111';
const request=(path,body)=>new Request('https://browser.internal/'+path,{method:'POST',body:JSON.stringify(body)});
assert.equal((await owner.fetch(request('driver',{id,method:'evaluate',args:['document.cookie']}))).status,409);
const first=owner.fetch(request('driver',{id,method:'observe',args:['retained']}));
while(!pendingResolve)await new Promise(resolve=>setImmediate(resolve));
const second=owner.fetch(request('driver',{id,method:'observe',args:['retained']}));
pendingResolve();assert.equal((await first).status,200);assert.equal((await second).status,200);assert.equal(maxConcurrent,1);
assert.equal((await owner.fetch(request('wake',{id:'22222222-2222-4222-8222-222222222222'}))).status,409);
assert.equal((await owner.fetch(request('wake',{id}))).status,200);assert.ok(alarms.at(-1)>Date.now()-1000);
// No HTTP request or UI connection is present when this alarm advances the job.
await owner.alarm();assert.equal(fixture.turns,1);assert.equal(fixture.status,'awaiting_approval');const alarmCount=alarms.length;
await owner.alarm();assert.equal(fixture.turns,1);assert.ok(alarms.length>alarmCount);
fixture.status='running';fixture.fail=true;await owner.alarm();assert.equal(fixture.abort,1);assert.equal(fixture.status,'uncertain');await owner.alarm();assert.equal(fixture.turns,2);
console.log('PASS private owner RPC rejects arbitrary methods and foreign session identity');
console.log('PASS concurrent provider requests serialize through one owner');
console.log('PASS cloud alarm advances a job without any browser/UI request');
console.log('PASS approval waits keep a bounded watchdog without replaying a model turn');
console.log('PASS interrupted execution becomes uncertain and is never retried');
console.log('5 browser owner checks passed; external provider calls: 0.');
