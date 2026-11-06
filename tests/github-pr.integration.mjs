// Pull requests prepared by Braand and project keys, with a simulated sandbox
// and GitHub: the proposal lists the exact files; nothing is pushed before
// approval; refusal pushes nothing; a GitHub connection is required; if the
// project changed since the proposal nothing is pushed; approval pushes the
// reviewed changes and opens the PR. Keys are sealed and never returned.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/github-pr');mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
const resources=new Map(),audits=[],commands=[],api=[];let fingerprint='f'.repeat(64),token='gho_token';
globalThis.__pr={resources,audits,commands,api,db:{prepare:q=>statement(q)},state:{get fp(){return fingerprint;},get token(){return token;}}};
const server=`import {AppError} from ${JSON.stringify(path.join(root,'lib/core.mjs'))};const S=globalThis.__pr;
export const db=()=>S.db;export const config=()=>({});export async function seal(v){return 'sealed:'+Buffer.from(v).toString('base64');}export async function unseal(v){return Buffer.from(v.slice(7),'base64').toString();}
export async function auditLog(t,a,action,target,detail){S.audits.push({action,target,detail});}
export async function createResource(t,kind,title,data,status){const r={id:'res-'+(S.resources.size+1),kind,title,data,status,version:1};S.resources.set(r.id,r);return r;}
export async function getResource(t,id){const r=S.resources.get(id);if(!r)throw new AppError('Introuvable',404);return structuredClone(r);}
export async function updateResource(t,id,version,patch){const r=S.resources.get(id);if(r.version!==version)throw new AppError('Version',409);Object.assign(r,patch,{version:r.version+1});return structuredClone(r);}`;
const sandbox=`const S=globalThis.__pr;export const codeSandboxReady=()=>true;export async function codeSandboxSession(t,c){return {calls:0,commandSeconds:0,sandboxName:'a'.repeat(40)};}
export async function runCodeSandboxTool(env,session,name,input){const c=input.command;S.commands.push(c);
 if(c.includes('---REMOTE---'))return {exitCode:0,stdout:'---REMOTE---\\nhttps://github.com/Awa/boutique.git\\n---STAT---\\n3\\t1\\tsrc/app/page.tsx\\n12\\t0\\tsrc/components/Hero.tsx\\n---NAMES---\\n M src/app/page.tsx\\nA  src/components/Hero.tsx\\n---FP---\\n'+'f'.repeat(64)+'\\n'};
 if(c.includes('PUSHED'))return c.includes(S.state.fp)?{exitCode:0,stdout:'PUSHED\\n'}:{exitCode:3,stdout:'CHANGED\\n'};
 return {exitCode:1,stdout:''};}`;
const github=`import {AppError} from ${JSON.stringify(path.join(root,'lib/core.mjs'))};const S=globalThis.__pr;export async function githubToken(){return S.state.token;}
export async function githubRequest(p,token,init={}){S.api.push({path:p,method:init.method||'GET',token});if(p==='/repos/Awa/boutique')return {default_branch:'main',permissions:{push:true}};if(p==='/repos/Awa/boutique/pulls')return {html_url:'https://github.com/Awa/boutique/pull/7',number:7};throw new AppError('x',404);}`;
await build({stdin:{contents:`export * from ${JSON.stringify(path.join(root,'lib/github-pr.ts'))};export * from ${JSON.stringify(path.join(root,'lib/code-env.ts'))};`,resolveDir:root,loader:'ts'},outfile:path.join(out,'pr.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',external:['zod'],plugins:[{name:'stubs',setup(b){
 for(const [name,contents] of [['server',server],['code-sandbox',sandbox],['github',github]]){b.onResolve({filter:new RegExp('^\\./'+name+'$')},()=>({path:name,namespace:'stub'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'stub'},()=>({contents,loader:'js',resolveDir:root}));}}}]});
const pr=await import(pathToFileURL(path.join(out,'pr.mjs')).href);
const who={tenant:'ws-1',user:{userId:'user-1'}};
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const proposal=await pr.proposeChanges('ws-1','conv-1',{dir:'/workspace/repos/boutique',title:'Ajouter la section Hero',description:'Nouvelle bannière d’accueil.'});
assert.equal(proposal.kind,'github_pr');assert.equal(proposal.status,'awaiting_approval');assert.equal(proposal.data.repo,'Awa/boutique');
assert.deepEqual(proposal.data.files,[{path:'src/app/page.tsx',status:'M',added:3,removed:1},{path:'src/components/Hero.tsx',status:'A',added:12,removed:0}]);
assert.match(proposal.data.branch,/^braand\/ajouter-la-section-hero-[a-z0-9]+$/);assert.equal(api.length,0,'nothing sent to GitHub while preparing');assert.ok(!commands.some(c=>c.includes('git push')));
await assert.rejects(()=>pr.proposeChanges('ws-1','conv-1',{dir:'/etc',title:'Titre valide'}),/invalide/);
pass('the proposal lists the exact files changed and pushes nothing');
token=null;await assert.rejects(()=>pr.decideProposal(who,proposal.id,{decision:'approve',version:1}),e=>e.code==='github_reconnect');token='gho_token';
await assert.rejects(()=>pr.decideProposal(who,proposal.id,{decision:'approve',version:9}),e=>e.code==='github_pr_stale');
pass('approval needs the user’s GitHub connection and the reviewed version');
fingerprint='0'.repeat(64);await assert.rejects(()=>pr.decideProposal(who,proposal.id,{decision:'approve',version:1}),e=>e.code==='github_pr_stale');
assert.equal(resources.get(proposal.id).status,'stale');assert.ok(!api.some(a=>a.path.endsWith('/pulls')),'no pull request when the project changed');
pass('if the project changed since the proposal, nothing is pushed');
fingerprint='f'.repeat(64);const second=await pr.proposeChanges('ws-1','conv-1',{dir:'/workspace/repos/boutique',title:'Ajouter la section Hero'});
const done=await pr.decideProposal(who,second.id,{decision:'approve',version:1});
assert.equal(done.status,'completed');assert.equal(done.data.prUrl,'https://github.com/Awa/boutique/pull/7');
const push=commands.find(c=>c.includes('PUSHED')&&c.includes(second.data.branch));assert.ok(push.includes(' commit -q -m ')&&push.includes('rm -f /tmp/.braand-askpass'));
assert.equal(api.at(-1).method,'POST');assert.ok(audits.some(a=>a.action==='github.pr.created'));
await assert.rejects(()=>pr.decideProposal(who,second.id,{decision:'approve',version:2}),e=>e.code==='github_pr_decided');
pass('approval pushes exactly the reviewed changes and opens the pull request, once');
const third=await pr.proposeChanges('ws-1','conv-1',{dir:'/workspace/repos/boutique',title:'Autre essai'});const before=api.length;
assert.equal((await pr.decideProposal(who,third.id,{decision:'reject',version:1})).status,'rejected');assert.equal(api.length,before,'a refusal sends nothing');
pass('a refusal sends nothing to GitHub');
assert.deepEqual(await pr.saveEnvValues('ws-1','conv-1',{DATABASE_URL:'postgres://secret',bad_key:'x',EMPTY:''}),['DATABASE_URL']);
await pr.saveEnvValues('ws-1','conv-1',{OPENAI_API_KEY:'sk-secret'});
assert.deepEqual(await pr.loadEnvValues('ws-1','conv-1'),{DATABASE_URL:'postgres://secret',OPENAI_API_KEY:'sk-secret'});
assert.deepEqual((await pr.envKeyNames('ws-1','conv-1')).sort(),['DATABASE_URL','OPENAI_API_KEY']);
assert.ok(!sql.prepare('SELECT data FROM code_env').get().data.includes('secret'),'sealed at rest');
assert.deepEqual(await pr.loadEnvValues('ws-2','conv-1'),{},'per workspace and conversation');
await assert.rejects(()=>pr.saveEnvValues('ws-1','conv-1',{lower:'x'}),e=>e.code==='env_invalid');
pass('project keys are sealed per conversation; only their names are ever listed');
console.log(checks+' pull request and project key checks passed with a simulated sandbox and GitHub.');
