// Decisions live in the conversation that prepared them: the queries that list
// a conversation's pending approvals (chat, background mission, browser,
// publications, replies) and find an item's conversation, on real SQLite.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/decisions');mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE resources(id TEXT PRIMARY KEY,workspace_id TEXT,kind TEXT,title TEXT,data TEXT,status TEXT);
CREATE TABLE runs(id TEXT PRIMARY KEY,workspace_id TEXT,conversation_id TEXT,status TEXT);
CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,type TEXT,data TEXT,created_at INTEGER);
CREATE TABLE agent_work(id TEXT PRIMARY KEY,workspace_id TEXT,conversation_id TEXT);
CREATE TABLE agent_work_artifacts(work_id TEXT,step_id TEXT,resource_id TEXT);
CREATE TABLE browser_sessions(id TEXT PRIMARY KEY,workspace_id TEXT,conversation_id TEXT,status TEXT,updated_at INTEGER);
CREATE TABLE social_posts(id TEXT PRIMARY KEY,batch_id TEXT,workspace_id TEXT,status TEXT);
CREATE TABLE social_replies(id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT);`);
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};}});
globalThis.__decisions={prepare:q=>statement(q)};
await build({entryPoints:[path.join(root,'lib/decisions.ts')],outfile:path.join(out,'decisions.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/server$/},()=>({path:'server',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db=()=>globalThis.__decisions;',loader:'js'}));}}]});
const {pendingDecisions,decisionOrigin}=await import(pathToFileURL(path.join(out,'decisions.mjs')));
const W='w1',C='conv-1',OTHER='conv-2';
const add=(table,row)=>{const keys=Object.keys(row);sql.prepare(`INSERT INTO ${table}(${keys})VALUES(${keys.map(()=>'?')})`).run(...Object.values(row));};
const result=(run,data)=>add('events',{run_id:run,type:'tool_result',data:JSON.stringify({result:data}),created_at:Date.now()});
add('runs',{id:'r1',workspace_id:W,conversation_id:C,status:'completed'});add('runs',{id:'r2',workspace_id:W,conversation_id:OTHER,status:'completed'});
// From the chat itself
add('resources',{id:'act-pending',workspace_id:W,kind:'connector_action',title:'',data:'{}',status:'pending'});result('r1',{id:'act-pending',kind:'connector_action'});
add('resources',{id:'act-done',workspace_id:W,kind:'connector_action',title:'',data:'{}',status:'completed'});result('r1',{id:'act-done',kind:'connector_action'});
add('resources',{id:'prop',workspace_id:W,kind:'proposal',title:'',data:JSON.stringify({kind:'media'}),status:'awaiting_approval'});result('r1',{id:'prop',kind:'proposal'});
add('resources',{id:'batch',workspace_id:W,kind:'social_batch',title:'',data:'{}',status:'awaiting_approval'});result('r1',{id:'batch',kind:'social_batch'});
add('social_posts',{id:'p1',batch_id:'batch',workspace_id:W,status:'draft'});
add('social_replies',{id:'reply',workspace_id:W,status:'draft'});result('r1',{id:'reply',commentId:'c1',status:'draft'});
// From a background mission of this conversation
add('agent_work',{id:'work',workspace_id:W,conversation_id:C});add('resources',{id:'act-mission',workspace_id:W,kind:'connector_action',title:'',data:'{}',status:'pending'});add('agent_work_artifacts',{work_id:'work',step_id:'s',resource_id:'act-mission'});
// The browser, started from the panel of this conversation
add('browser_sessions',{id:'browser',workspace_id:W,conversation_id:C,status:'awaiting_approval',updated_at:1});add('browser_sessions',{id:'browser-running',workspace_id:W,conversation_id:C,status:'running',updated_at:2});
// Another conversation and another workspace
add('resources',{id:'act-other',workspace_id:W,kind:'connector_action',title:'',data:'{}',status:'pending'});result('r2',{id:'act-other',kind:'connector_action'});
add('resources',{id:'act-foreign',workspace_id:'w2',kind:'connector_action',title:'',data:'{}',status:'pending'});result('r1',{id:'act-foreign',kind:'connector_action'});
// A batch already decided: no longer pending
add('resources',{id:'batch-done',workspace_id:W,kind:'social_batch',title:'',data:'{}',status:'awaiting_approval'});result('r1',{id:'batch-done',kind:'social_batch'});add('social_posts',{id:'p2',batch_id:'batch-done',workspace_id:W,status:'approved'});

const pending=await pendingDecisions(W,C);
assert.deepEqual(pending.map(item=>item.kind+':'+item.id).sort(),['browser_session:browser','connector_action:act-mission','connector_action:act-pending','proposal:prop','social_batch:batch','social_reply:reply'].sort());
console.log('PASS a conversation lists exactly its pending decisions: chat, background mission, browser, publications and replies');
assert.equal((await pendingDecisions(W,OTHER)).map(item=>item.id).join(),'act-other');
assert.deepEqual(await pendingDecisions('w2',C),[]);
console.log('PASS nothing crosses conversations or workspaces');
assert.equal(await decisionOrigin(W,'act-pending'),C);assert.equal(await decisionOrigin(W,'act-mission'),C);assert.equal(await decisionOrigin(W,'browser'),C);assert.equal(await decisionOrigin(W,'reply'),C);
assert.equal(await decisionOrigin(W,'made-by-hand'),null);assert.equal(await decisionOrigin('w2','act-pending'),null);
console.log('PASS any screen finds the conversation where an item is decided; hand-made items have none');
console.log('3 decision checks passed.');
