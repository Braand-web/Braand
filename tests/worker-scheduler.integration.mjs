// Exercise the real Worker scheduled handler; routing and storage are isolated.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const output=path.resolve('.local-build/worker-scheduler-test.mjs');
mkdirSync(path.dirname(output),{recursive:true});
const state={requests:[],alerts:[],cleanup:0,status:200};
globalThis.__schedulerFixture=state;
await build({entryPoints:['build/worker.ts'],outfile:output,bundle:true,platform:'node',format:'esm',define:{'import.meta.env.DEV':'false'},plugins:[{
  name:'isolated-scheduler-services',setup(builder){
    builder.onResolve({filter:/^(vinext\/server\/fetch-handler|\.\.\/lib\/(operations|browser-session-do|auth-runtime))$/},args=>({path:args.path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:
      args.path==='vinext/server/fetch-handler'?`export default {fetch:async request=>{globalThis.__schedulerFixture.requests.push(new URL(request.url).pathname);return Response.json({status:'fixture'},{status:globalThis.__schedulerFixture.status});}};`:
      args.path.endsWith('operations')?`export async function raiseOperationalAlert(id,category,target){globalThis.__schedulerFixture.alerts.push({id,category,target});}`:
      args.path.endsWith('auth-runtime')?`export function identityFreeHeaders(headers){return new Headers(headers);}export async function cleanupAuth(){globalThis.__schedulerFixture.cleanup++;}export async function handleAuth(){return null;}export async function authenticatedRequest(r){return r;}export async function authenticateRequest(request){return {request,setCookie:null};}`:
      'export class BrowserSession{}'
    }));
  }
}]});
const worker=(await import(pathToFileURL(output))).default;
const logs=[],originalError=console.error;
console.error=(...values)=>logs.push(values.join(' '));
const env={SCHEDULER_SECRET:'offline-scheduler-fixture-'.repeat(2),AUTONOMY_ENABLED:'false'};
async function tick(patch={}){
  state.requests.length=0;state.alerts.length=0;state.cleanup=0;
  const pending=[];
  worker.scheduled({scheduledTime:1_761_280_000_000},{...env,...patch},{waitUntil:promise=>pending.push(promise)});
  await Promise.all(pending);
}
let checks=0;
async function check(name,run){await run();checks++;console.log('PASS '+name);}
try{
  await check('closed autonomy performs housekeeping without running missions or raising a false alert',async()=>{
    await tick();assert.deepEqual(state.requests,['/api/internal/billing-tick','/api/internal/operations-tick']);assert.equal(state.cleanup,1);assert.deepEqual(state.alerts,[]);
  });
  await check('enabled autonomy remains scheduled, with no changes to billing or operations',async()=>{
    await tick({AUTONOMY_ENABLED:'true'});assert.deepEqual(state.requests,['/api/internal/billing-tick','/api/internal/mission-tick','/api/internal/operations-tick']);
  });
  await check('a real task error still raises an operational alert',async()=>{
    state.status=503;await tick({AUTONOMY_ENABLED:'true'});assert.deepEqual(state.alerts.map(x=>[x.category,x.target]),[['scheduled_task_failed','billing:503'],['scheduled_task_failed','missions:503'],['scheduled_task_failed','operations:503']],'the alert keeps the cause (status, then error code when the task gives one)');state.status=200;
  });
  await check('missing scheduler credentials cannot execute even housekeeping',async()=>{
    await tick({SCHEDULER_SECRET:''});assert.deepEqual(state.requests,[]);assert.equal(state.cleanup,0);
  });
  assert.ok(logs.length);assert.ok(logs.every(line=>!line.includes(env.SCHEDULER_SECRET)));
}finally{console.error=originalError;delete globalThis.__schedulerFixture;}
console.log(`${checks} Worker scheduler checks passed; no external services called.`);
