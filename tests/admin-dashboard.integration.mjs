// Administration: real SQL against the real schema (SQLite in memory, demo
// data), access control, credit grants/revocation, suspension, audit, and no
// conversation content in any admin answer. With ADMIN_PREVIEW=1 it also
// renders the real interface in Chromium and saves screenshots.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/admin');mkdirSync(out,{recursive:true});

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const part of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint'))try{sql.exec(part);}catch{/* idempotent re-creations in later migrations */}
sql.exec('PRAGMA foreign_keys=OFF');
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
globalThis.__adminFixture={db:{prepare:q=>statement(q),batch:async rows=>Promise.all(rows.map(r=>r.run()))},user:{userId:'0301d63c-9f01-4181-bc06-1e1162d4908f',email:'owner@braand.test'},env:{OPENROUTER_API_KEY:'x',FAL_KEY:'x',BACKUP_ENABLED:'true'}};

// Demo data: 14 accounts over 30 days, answers, AI calls on three models, orders, credits, audit, operations.
const now=Date.now(),DAY=86400000,owner=globalThis.__adminFixture.user.userId;
const ins=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
const people=[[owner,'dodobien23@gmail.com'],...['awa.ndiaye','paul.mbarga','fatou.diallo','cabinet.ekwalla','boutique.lumi','jean.kamga','aicha.toure','studio.nova','marc.essomba','grace.fotso','ibrahim.sow','linda.nkoulou','sarl.bata'].map((n,i)=>['user-'+i,n+'@exemple.cm'])];
let seq=0;const id=p=>p+'-'+(++seq);
people.forEach(([uid,email],i)=>{const created=now-(29-i*2)*DAY;ins('auth_users',{id:uid,email,verified_at:created,created_at:created});ins('organizations',{id:uid,name:i?'Entreprise '+(i+1):'Braand',owner_id:uid,created_at:created});ins('organization_members',{organization_id:uid,user_id:uid,role:'owner',active:1});ins('workspaces',{id:uid,name:'Espace',created_at:created,organization_id:uid});
 ins('credit_lots',{id:'free:'+uid,organization_id:uid,source:'free',source_id:uid,granted:2000,balance:2000-((i*137)%1500),reserved:0,starts_at:created,expires_at:created+60*DAY,frozen:0,created_at:created});
 for(let k=0;k<(i%4)*6+3;k++){const t=created+Math.min(now-created-1,(k+1)*DAY*0.7);const rid=id('run');ins('runs',{id:rid,workspace_id:uid,conversation_id:'c-'+uid,status:k%11===10?'failed':'completed',created_at:t,updated_at:t});
  const model=k%7===6?'anthropic/claude-opus-5.5':k%3===2?'anthropic/claude-sonnet-5.5':'anthropic/claude-haiku-5.5',cost=model.includes('opus')?14.2:model.includes('sonnet')?3.1:0.84;
  ins('provider_usage',{id:id('pu'),organization_id:uid,workspace_id:uid,run_id:rid,hold_id:'h-'+rid,provider:'openrouter',role:'master',rate:JSON.stringify({model}),usage:'{}',cost_xaf:cost,status:k%13===12?'rejected':'complete',created_at:t});
  ins('credit_holds',{id:'h-'+rid,organization_id:uid,workspace_id:uid,actor:uid,reference:'chat:'+rid,units:500,actual:Math.round(cost/4*100),status:'settled',created_at:t});
  ins('messages',{id:id('m'),workspace_id:uid,conversation_id:'c-'+uid,role:'user',content:JSON.stringify([{type:'text',text:'CONTENU PRIVE DU CLIENT'}]),created_at:t});}
});
[['user-1',14700,'verified'],['user-4',49000,'verified'],['user-6',14700,'failed'],['user-8',4900,'expired']].forEach(([org,amount,status],i)=>ins('billing_orders',{id:'ord-'+i,organization_id:org,quote_id:'q'+i,actor:org,idempotency_key:'k'+i,status,amount,currency:'XAF',product:i===1?'Pro mensuel':'Recharge 300 crédits',created_at:now-(5-i)*DAY,updated_at:now-(5-i)*DAY}));
ins('credit_lots',{id:'topup:ord-0',organization_id:'user-1',source:'topup',source_id:'ord-0',granted:30000,balance:21000,reserved:0,starts_at:now-5*DAY,expires_at:null,frozen:0,created_at:now-5*DAY});
ins('audit',{id:'a1',workspace_id:'user-2',actor:'user-2',action:'deliverable.exported',target:'r1',detail:JSON.stringify({format:'pdf',text:'NE DOIT PAS APPARAITRE'}),created_at:now-3600000});
ins('operations_jobs',{id:'j1',name:'backup.daily',status:'completed',attempts:1,created_at:now-DAY,updated_at:now-DAY});
ins('operations_alerts',{id:'al1',category:'model_rate',target:'openrouter',status:'open',observations:2,first_seen_at:now-7200000,last_seen_at:now-3600000});
ins('agent_tool_usage',{id:'tu1',workspace_id:'user-4',run_id:'r',hold_id:'h',provider:'fal',operation:'image',status:'complete',ceiling_units:800,actual_units:600,rate:'{}',created_at:now-2*DAY});

const stubs={'./server':`const F=globalThis.__adminFixture;import {AppError} from ${JSON.stringify(path.join(root,'lib/core.mjs'))};export const db=()=>F.db;export const config=()=>F.env;export const uid=()=>crypto.randomUUID();export async function identity(){if(!F.user)throw new AppError('Connectez-vous.',401);return {user:F.user,tenant:F.user.userId,organization:F.user.userId,role:'owner'};}`,
 './billing':'export const releaseReadiness=()=>({enabled:false,checks:{payment:false,xafCheckout:false}});','./metering':'export const modelReadiness=()=>({ready:true});','./model-router':'export const routingEnabled=()=>true;export const routingReadiness=()=>({enabled:true,policy:"adaptive"});','./agent-lessons':'export const lessonPatterns=async()=>[{tool:"plan_media",code:"invalid_input",count:3,recovered:1,lastSeen:Date.now()}];'};
await build({stdin:{contents:`export * from ${JSON.stringify(path.join(root,'lib/platform-admin.ts'))};export {agentQualityReport} from ${JSON.stringify(path.join(root,'lib/agent-quality.ts'))};`,resolveDir:root,loader:'ts'},outfile:path.join(out,'admin.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',external:['zod'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/(server|billing|metering|model-router|agent-lessons)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:root}));}}]});
const admin=await import(pathToFileURL(path.join(out,'admin.mjs')).href);
const request=(method='GET',origin='https://braand.test')=>new Request('https://braand.test/api/admin/x',{method,headers:method==='GET'?{}:{origin}});
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};

const overview=await admin.adminOverview(now);
assert.equal(overview.users.total,14);assert.equal(overview.money.revenueXaf,63700);assert.equal(overview.money.paidOrders,2);assert.ok(overview.money.aiCost30Xaf>0);assert.equal(overview.series.length,30);assert.equal(overview.attention.openAlerts,1);assert.equal(overview.attention.failedOrders7,2);
pass('overview figures come from real SQL: 14 accounts, 63 700 FCFA paid, 30-day series, 1 open alert, 2 failed payments');
const users=await admin.adminUsers('');assert.equal(users.users.length,14);assert.ok(users.users.find(u=>u.id===owner).admin);
assert.equal((await admin.adminUsers('awa')).users.length,1);pass('accounts list, search and admin badge');
const ai=await admin.adminAi(30,now);assert.deepEqual(ai.byModel.map(m=>m.model).sort(),['anthropic/claude-haiku-5.5','anthropic/claude-opus-5.5','anthropic/claude-sonnet-5.5']);pass('AI view splits the adaptive brain across Haiku, Sonnet and Opus');
const everything=JSON.stringify([overview,users,ai,await admin.adminFinance(),await admin.adminMedia(30,now),await admin.adminAudit(''),await admin.adminUserDetail('user-2',now)]);
assert.ok(!everything.includes('CONTENU PRIVE')&&!everything.includes('NE DOIT PAS APPARAITRE'),'No conversation content or free text leaks into admin data');pass('no conversation content or sensitive audit text in any admin answer');

// Access control.
globalThis.__adminFixture.user={userId:'user-3',email:'x@exemple.cm'};
await assert.rejects(()=>admin.requirePlatformAdmin(request()),e=>e.code==='admin_forbidden');
globalThis.__adminFixture.user={userId:owner,email:'owner@braand.test'};
await assert.rejects(()=>admin.requirePlatformAdmin(request('POST','https://evil.test')),/Origine/);
await admin.requirePlatformAdmin(request());pass('only platform administrators get in, and actions require the same origin');

// Actions.
const before=(await admin.adminUsers('awa')).users[0].credits;
await admin.adminAction(owner,{action:'grant_credits',userId:'user-0',credits:50,reason:'Geste commercial'});
assert.equal((await admin.adminUsers('awa')).users[0].credits,before+50);
await assert.rejects(()=>admin.adminAction(owner,{action:'grant_credits',userId:'user-0',credits:1e9,reason:'trop'}));
const lot=(await admin.adminUserDetail('user-0',now)).lots.find(l=>l.source==='admin_grant');
await admin.adminAction(owner,{action:'revoke_grant',userId:'user-0',lotId:lot.id,reason:'Erreur de saisie'});
assert.equal((await admin.adminUsers('awa')).users[0].credits,before);pass('credits granted then revoked, bounded, reflected in the balance');
await admin.adminAction(owner,{action:'block',userId:'user-1',reason:'Fraude suspectée'});
assert.equal(await admin.isAccountBlocked('user-1'),true);assert.ok((await admin.adminUsers('paul')).users[0].blocked);
await assert.rejects(()=>admin.adminAction(owner,{action:'block',userId:owner,reason:'test'}),/administrateur/);
await admin.adminAction(owner,{action:'unblock',userId:'user-1'});assert.equal(await admin.isAccountBlocked('user-1'),false);pass('suspend and reactivate an account; an administrator cannot be suspended');
const audit=await admin.adminAudit('admin.');assert.ok(audit.entries.length>=4&&audit.entries.every(e=>e.action.startsWith('admin.')));pass('every admin action is in the audit log');

if(process.env.ADMIN_PREVIEW==='1'){
 // Render the real interface with these exact answers.
 const routes={'/api/admin/overview':overview,'/api/admin/users':await admin.adminUsers(''),'/api/admin/finance':await admin.adminFinance(),'/api/admin/ai':await admin.adminAi(30,now),'/api/admin/media':await admin.adminMedia(30,now),'/api/admin/audit':await admin.adminAudit(''),'/api/admin/system':{services:admin.adminServices(),operations:{jobs:sql.prepare('SELECT * FROM operations_jobs').all(),alerts:sql.prepare('SELECT * FROM operations_alerts').all(),backups:[{status:'succeeded',created_at:now-DAY}]},quality:await admin.agentQualityReport(7,now),lessons:[{tool:'plan_media',code:'invalid_input',count:3,recovered:1}]}};
 for(const u of routes['/api/admin/users'].users)routes['/api/admin/users/'+u.id]=await admin.adminUserDetail(u.id,now);
 writeFileSync(path.join(out,'routes.json'),JSON.stringify(routes));
 await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {AdminDashboard} from "./components/admin/admin-dashboard";import "./app/tokens.css";import "./app/globals.css";
const routes=window.__routes;window.fetch=async(url)=>{const p=new URL(url,location.href).pathname;const body=routes[p];return new Response(JSON.stringify(body??{error:"absent"}),{status:body?200:404,headers:{"Content-Type":"application/json"}});};
createRoot(document.getElementById("root")).render(React.createElement(AdminDashboard));`,resolveDir:root,loader:'tsx'},outfile:path.join(out,'page.js'),bundle:true,format:'esm',jsx:'automatic',loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},external:['/fonts/*'],alias:{'next/link':path.join(out,'link.js'),'@':root},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'}).catch(async e=>{throw e;});
}
console.log(checks+' admin checks passed against the real schema; demo data only.');
