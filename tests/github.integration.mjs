// GitHub reading against a simulated GitHub API: overview of a public
// repository (stack, run plan, keys), tree, file read with offset, search,
// private repository without/with the user's connection, rate limit; the
// user's token is sealed at rest and never appears in any answer.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/github');mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
globalThis.__gh={db:{prepare:q=>statement(q)},env:{}};
await build({entryPoints:[path.join(root,'lib/github.ts')],outfile:path.join(out,'github.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/server$/},()=>({path:'server',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db=()=>globalThis.__gh.db;export const config=()=>globalThis.__gh.env;export async function seal(v){return "sealed:"+Buffer.from(v).toString("base64");}export async function unseal(v){return Buffer.from(v.slice(7),"base64").toString();}',loader:'js'}));}}]});
const gh=await import(pathToFileURL(path.join(out,'github.mjs')).href);
const b64=t=>Buffer.from(t).toString('base64');
const files={'package.json':JSON.stringify({scripts:{dev:'next dev','db:migrate':'drizzle-kit migrate'},dependencies:{next:'15','drizzle-orm':'0.4'}}),'.env.example':'DATABASE_URL=\nOPENAI_API_KEY=\nNEXT_PUBLIC_APP_URL=http://localhost:3000\n','README.md':'# Nv Multi Modèles\nChatbot multi-modèles.','src/app/page.tsx':'export default function Page(){return <h1>Bonjour Awa</h1>;}\n'.repeat(3)};
const calls=[];
globalThis.fetch=async(url,init={})=>{
 const u=new URL(url),auth=init.headers?.Authorization||null;calls.push({path:u.pathname+u.search,auth});
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 if(u.pathname.startsWith('/repos/Acme/limit'))return reply({message:'rate limit'},403);
 const priv=u.pathname.startsWith('/repos/Acme/secret');
 if(priv&&auth!=='Bearer gho_user_token')return reply({message:'Not Found'},404);
 const m=u.pathname.match(/^\/repos\/(Braand-web\/Nv-MULTI-MODELES|Acme\/secret)(\/.*)?$/);if(!m)return reply({message:'Not Found'},404);
 const rest=m[2]||'';
 if(!rest)return reply({full_name:m[1],private:priv,description:'Chatbot',default_branch:'main',language:'TypeScript',stargazers_count:3,pushed_at:'2026-11-01',html_url:'https://github.com/'+m[1],size:10});
 if(rest.startsWith('/git/trees/main'))return reply({truncated:false,tree:[...Object.keys(files).map(p=>({path:p,type:'blob',size:files[p].length})),{path:'src',type:'tree'},{path:'node_modules/x/index.js',type:'blob',size:1},{path:'public/logo.png',type:'blob',size:900}]});
 const c=rest.match(/^\/contents\/(.+)$/);if(c){const p=decodeURIComponent(c[1]);if(p==='src')return reply([{name:'page.tsx'}]);if(!(p in files))return reply({message:'Not Found'},404);return reply({type:'file',encoding:'base64',content:b64(files[p]),size:files[p].length});}
 return reply({message:'Not Found'},404);
};
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const o=await gh.repoOverview('https://github.com/Braand-web/Nv-MULTI-MODELES.git',null);
assert.equal(o.repo,'Braand-web/Nv-MULTI-MODELES');assert.equal(o.plan.framework,'Next.js');assert.equal(o.plan.dev,'npm run dev');assert.equal(o.plan.port,3000);assert.deepEqual(o.plan.database,['drizzle-orm']);
assert.deepEqual(o.env.keys.map(k=>k.name),['DATABASE_URL','OPENAI_API_KEY','NEXT_PUBLIC_APP_URL']);assert.match(o.readme,/Chatbot multi-modèles/);
assert.ok(!o.topLevel.includes('node_modules'),'dependencies folders are skipped');
pass('a public repository: what it is, how to run it and the keys it needs, without any account');
const tree=await gh.repoFiles('Braand-web/Nv-MULTI-MODELES',null,'src');assert.deepEqual(tree.entries.map(e=>e.path),['src/app/page.tsx','src']);
const read=await gh.repoRead('Braand-web/Nv-MULTI-MODELES',null,'src/app/page.tsx',null,10);assert.equal(read.offset,10);assert.match(read.content,/Bonjour Awa/);
await assert.rejects(()=>gh.repoRead('Braand-web/Nv-MULTI-MODELES',null,'../etc/passwd'),/invalide/);
await assert.rejects(()=>gh.repoRead('Braand-web/Nv-MULTI-MODELES',null,'src'),/dossier/);
const found=await gh.repoSearch('Braand-web/Nv-MULTI-MODELES',null,'bonjour');assert.equal(found.lineMatches[0].path,'src/app/page.tsx');assert.equal(found.lineMatches[0].line,1);
pass('tree, file read with offset, safe paths and search in the code');
await assert.rejects(()=>gh.repoOverview('Acme/secret',null),e=>e.code==='github_private_or_missing'&&/connectez votre compte GitHub/.test(e.message));
await gh.saveGithubConnection('user-1','awa','gho_user_token','repo');
const stored=sql.prepare('SELECT token FROM github_connections').get().token;assert.ok(!stored.includes('gho_user_token'),'the token is sealed at rest');
const token=await gh.githubToken('user-1');const priv=await gh.repoOverview('https://github.com/Acme/secret',token);assert.equal(priv.private,true);
assert.ok(!JSON.stringify(priv).includes('gho_user_token'),'the token never appears in an answer');
assert.equal(await gh.githubToken('user-2'),null);assert.equal((await gh.githubConnection('user-1')).login,'awa');
await gh.removeGithubConnection('user-1');assert.equal(await gh.githubToken('user-1'),null);
pass('a private repository needs the user’s GitHub connection; the token is sealed, used server-side only and removable');
await assert.rejects(()=>gh.repoOverview('Acme/limit',null),e=>e.code==='github_rate_limited');
await assert.rejects(()=>gh.repoOverview('https://gitlab.com/a/b',null),e=>e.code==='github_link_invalid');
globalThis.__gh.env.GITHUB_READ_TOKEN='server_read_token';calls.length=0;await gh.repoFiles('Braand-web/Nv-MULTI-MODELES',null);assert.ok(calls.every(c=>c.auth==='Bearer server_read_token'),'a server read token lifts the public rate limit');
pass('rate limit and invalid links are explained; an optional server read token is used for public repositories');
console.log(checks+' GitHub reading checks passed against a simulated GitHub API.');
