// Exercise the actual workerd D1 binding, not just Node SQLite.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),scriptPath=path.join(root,'.local-build/agent-context-runtime.mjs');mkdirSync(path.dirname(scriptPath),{recursive:true});
await build({stdin:{contents:`
import {ensureContextSearchSchema} from './lib/agent-context-schema';
export default {async fetch(request,env){
 await env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS platform_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,workspace_id TEXT,kind TEXT,title TEXT,data TEXT,status TEXT,updated_at INTEGER)'),
  env.DB.prepare("INSERT OR IGNORE INTO resources VALUES ('memory-1','test-workspace','knowledge','Mémoire',?,'saved',1)").bind(JSON.stringify({projectId:'alpha',content:'Animation vérifiée'}))
 ]);
 const statuses=await Promise.all([ensureContextSearchSchema(env.DB),ensureContextSearchSchema(env.DB)]);
 const before=await env.DB.prepare("SELECT resource_id FROM agent_context_fts WHERE agent_context_fts MATCH 'animation'").all();
 await env.DB.prepare("UPDATE resources SET data=? WHERE id='memory-1'").bind(JSON.stringify({projectId:'alpha',content:'Nouveau contenu'})).run();
 const old=await env.DB.prepare("SELECT resource_id FROM agent_context_fts WHERE agent_context_fts MATCH 'animation'").all();
 const changed=await env.DB.prepare("SELECT resource_id FROM agent_context_fts WHERE agent_context_fts MATCH 'nouveau'").all();
 await env.DB.prepare("DELETE FROM resources WHERE id='memory-1'").run();
 const removed=await env.DB.prepare('SELECT resource_id FROM agent_context_fts').all();
 const marker=await env.DB.prepare("SELECT value FROM platform_settings WHERE key='agent_context_schema_v1'").first();
 return Response.json({statuses,before:before.results,old:old.results,changed:changed.results,removed:removed.results,marker:marker.value});
}};
`,resolveDir:root,loader:'ts'},outfile:scriptPath,bundle:true,platform:'browser',format:'esm'});
const mf=new Miniflare({modules:true,scriptPath,compatibilityDate:'2026-05-15',cf:false,d1Databases:['DB'],outboundService:()=>{throw Error('External network forbidden');}});
try{
 const response=await mf.dispatchFetch('https://fixture.invalid/');assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result.statuses,[{status:'applied'},{status:'applied'}]);assert.equal(result.marker,'ready');
 assert.deepEqual(result.before,[{resource_id:'memory-1'}]);assert.deepEqual(result.old,[]);assert.deepEqual(result.changed,[{resource_id:'memory-1'}]);assert.deepEqual(result.removed,[]);
 console.log('PASS real workerd D1 applies the atomic FTS migration, coalesces calls and maintains update/delete triggers');
}finally{await mf.dispose();}
