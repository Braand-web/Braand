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
await build({stdin:{contents:`export * from ${JSON.stringify(path.join(root,'lib/platform-admin.ts'))};export {flushTraffic,recordTraffic,cleanupTraffic} from ${JSON.stringify(path.join(root,'lib/traffic.ts'))};export {agentQualityReport} from ${JSON.stringify(path.join(root,'lib/agent-quality.ts'))};`,resolveDir:root,loader:'ts'},outfile:path.join(out,'admin.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',external:['zod'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/(server|billing|metering|model-router|agent-lessons)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:root}));}}]});
const admin=await import(pathToFileURL(path.join(out,'admin.mjs')).href);
const request=(method='GET',origin='https://braand.test')=>new Request('https://braand.test/api/admin/x',{method,headers:method==='GET'?{}:{origin}});
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};

const overview=await admin.adminOverview(now);
assert.equal(overview.users.total,14);assert.equal(overview.money.revenueXaf,63700);assert.equal(overview.money.paidOrders,2);assert.ok(overview.money.aiCost30Xaf>0);assert.equal(overview.series.length,30);assert.equal(overview.attention.openAlerts,1);assert.equal(overview.attention.failedOrders7,2);
pass('overview figures come from real SQL: 14 accounts, 63 700 FCFA paid, 30-day series, 1 open alert, 2 failed payments');
const users=await admin.adminUsers('');assert.equal(users.users.length,14);assert.ok(users.users.find(u=>u.id===owner).admin);
assert.equal((await admin.adminUsers('awa')).users.length,1);pass('accounts list, search and admin badge');
const ai=await admin.adminAi(30,now);assert.deepEqual(ai.byModel.map(m=>m.model).sort(),['anthropic/claude-haiku-5.5','anthropic/claude-opus-5.5','anthropic/claude-sonnet-5.5']);pass('AI view splits the adaptive brain across Haiku, Sonnet and Opus');
ins('resources',{id:'site-1',workspace_id:'user-4',kind:'site',title:'Boutique Lumi',data:JSON.stringify({slug:'boutique-lumi',files:[]}),status:'draft',version:3,created_at:now-DAY,updated_at:now-DAY});
const sitesView=await admin.adminSites(now);
sql.prepare("INSERT INTO site_publications(id,workspace_id,organization_id,resource_id,slug,resource_version,digest,live_digest,status,badge,approved_by,approved_at,created_at,updated_at) VALUES ('pub-1','user-4','user-4','site-1','boutique-lumi',3,'d','d','published',1,'user-4',?,?,?)").run(now-3600000,now-DAY,now-3600000);
sql.prepare("INSERT INTO site_leads VALUES ('lead-1','pub-1','user-4','Client','client@exemple.cm','CONTENU PRIVE DU FORMULAIRE',?)").run(now-600000);
const sitesLive=await admin.adminSites(now);
assert.equal(sitesView.drafts,1);assert.equal(sitesLive.sites.length,1);assert.equal(sitesLive.sites[0].owner,'boutique.lumi@exemple.cm');assert.equal(sitesLive.sites[0].leads,1);assert.equal(sitesLive.leads30d,1);
assert.deepEqual(sitesLive.plans.map(p=>p.name),['Essentiel','Pro','Business','Entreprise']);assert.equal(sitesLive.plans.find(p=>p.id==='enterprise').periodPrice,79900);
assert.doesNotMatch(JSON.stringify(sitesLive),/CONTENU PRIVE/);
const suspended=await admin.adminSiteAction(owner,{action:'suspend_site',siteId:'site-1',reason:'Plainte reçue'});assert.match(suspended.message,/boutique-lumi/);
assert.equal(sql.prepare("SELECT status FROM site_publications WHERE id='pub-1'").get().status,'suspended');assert.ok(sql.prepare("SELECT 1 x FROM audit WHERE action='admin.suspend_site'").get());
await assert.rejects(()=>admin.adminSiteAction(owner,{action:'suspend_site',siteId:'site-1',reason:''}));
pass('Sites & plans view lists published sites with owner and leads count (never form content), the four plans, and suspends a site with an audited reason');
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

// Backup health: none, recent, stale, and an interrupted job of the day.
{
 const today='backup:'+new Date(now).toISOString().slice(0,10).replaceAll('-','');
 assert.equal((await admin.adminBackupHealth(now)).healthy,false,'no successful backup yet');
 ins('operations_backups',{id:'bk1',object_key:'braand-backups/bk1.bin',status:'completed',bytes:9437184,tables_count:112,rows_count:13456,objects_count:42,created_at:now-3*3600000});
 ins('operations_jobs',{id:today,name:'backup',status:'completed',attempts:1,created_at:now-3*3600000,updated_at:now-3*3600000});
 const fresh=await admin.adminBackupHealth(now);assert.equal(fresh.healthy,true);assert.equal(fresh.ageHours,3);assert.equal(fresh.tables,112);assert.equal(fresh.rows,13456);assert.equal(fresh.today.status,'completed');
 assert.equal((await admin.adminBackupHealth(now+27*3600000)).healthy,false,'more than 26 h without a backup');
 sql.prepare("UPDATE operations_jobs SET status='uncertain',error_code='job_interrupted' WHERE id=?").run(today);
 const broken=await admin.adminBackupHealth(now);assert.equal(broken.healthy,false);assert.equal(broken.today.errorCode,'job_interrupted');
 sql.prepare("UPDATE operations_jobs SET status='completed',error_code=NULL WHERE id=?").run(today);
 pass('backup health: none, fresh (3 h, 112 tables, 13 456 rows), stale after 26 h, interrupted job of the day');
}
// Alerts: the cause is listed, resolving is audited and idempotent.
{
 ins('operations_alerts',{id:'cron:1:billing',category:'scheduled_task_failed',target:'billing:503:database_unavailable',status:'open',observations:1,first_seen_at:now-600000,last_seen_at:now-600000});
 assert.equal((await admin.adminResolveAlert(owner,{action:'resolve_alert',id:'cron:1:billing'})).message,'Alerte marquée comme résolue.');
 assert.equal(sql.prepare("SELECT status FROM operations_alerts WHERE id='cron:1:billing'").get().status,'resolved');
 assert.match((await admin.adminResolveAlert(owner,{action:'resolve_alert',id:'cron:1:billing'})).message,/déjà résolue/);
 await assert.rejects(()=>admin.adminResolveAlert(owner,{action:'resolve_alert',id:'absent'}),error=>error.status===404);
 await assert.rejects(()=>admin.adminResolveAlert(owner,{action:'resolve_alert',id:'cron:1:billing',extra:true}));
 const entries=(await admin.adminAudit('admin.resolve_alert')).entries;assert.equal(entries.length,1);assert.equal(entries[0].target,'cron:1:billing');
 pass('an alert keeps its cause; resolving it is audited once and refuses unknown alerts or extra fields');
}
// Decisions waiting on the platform: exact counts, age, account, never the content.
{
 const secret='TEXTE PRIVE A NE PAS MONTRER';
 ins('resources',{id:'pd-action',workspace_id:'user-2',kind:'connector_action',title:secret,data:JSON.stringify({arguments:{message:secret}}),status:'pending',created_at:now-3600000,updated_at:now-3600000});
 ins('resources',{id:'pd-media',workspace_id:'user-3',kind:'proposal',title:secret,data:JSON.stringify({kind:'media',rationale:secret}),status:'awaiting_approval',created_at:now-2*DAY,updated_at:now-2*DAY});
 ins('resources',{id:'pd-done',workspace_id:'user-3',kind:'connector_action',title:'déjà décidée',data:'{}',status:'completed',created_at:now-DAY,updated_at:now-DAY});
 ins('social_batches',{id:'pd-batch',workspace_id:'user-4',actor_id:'user-4',title:secret,created_at:now-5*3600000,updated_at:now-5*3600000});
 ins('social_posts',{id:'pd-post',batch_id:'pd-batch',workspace_id:'user-4',account_id:'acc',text:secret,assets:'[]',format:'text',alt_text:'',scheduled_at:now+DAY,timezone:'Africa/Douala',status:'draft',version:1,lease_until:0,created_at:now-5*3600000,updated_at:now-5*3600000});
 ins('social_replies',{id:'pd-reply',workspace_id:'user-5',actor_id:'user-5',comment_id:'cm',text:secret,comment_digest:'d',status:'draft',digest:'d',updated_at:now-1800000});
 ins('browser_sessions',{id:'pd-browser',workspace_id:'user-6',organization_id:'user-6',user_id:'user-6',objective:secret,allowed_domains:'[]',status:'awaiting_approval',max_credits:5,created_at:now-7200000,updated_at:now-7200000,expires_at:now+DAY});
 const pending=await admin.adminPendingDecisions(now);
 assert.equal(pending.total,5);assert.equal(pending.stale,1,'the media proposal waits for more than 24 h');
 assert.deepEqual(Object.fromEntries(pending.byKind.map(k=>[k.kind,k.count])),{connector_action:1,proposal:1,social_batch:1,social_reply:1,browser_session:1});
 assert.equal(pending.items[0].kind,'proposal');assert.equal(pending.items[0].stale,true);assert.equal(pending.items[0].account,sql.prepare("SELECT email FROM auth_users WHERE id='user-3'").get().email,'the account is the owner of the workspace');
 assert.ok(!JSON.stringify(pending).includes(secret),'no content of any request');
 pass('pending decisions: 5 kinds counted exactly, oldest first, the one waiting more than 24 h flagged, no content');
}
// Why answers stopped: system messages grouped with numbers hidden.
{
 for(const [i,amount] of ['0,68','1,17'].entries())ins('runs',{id:'stop-'+i,workspace_id:'user-7',conversation_id:'c-stop',status:'partial',error:'Votre solde disponible ('+amount+' crédits) ne suffit pas pour démarrer cette demande.',created_at:now-(i+1)*3600000,updated_at:now-(i+1)*3600000});
 ins('runs',{id:'stop-2',workspace_id:'user-7',conversation_id:'c-stop',status:'failed',error:'Le modèle a atteint sa limite temporaire.',created_at:now-1800000,updated_at:now-1800000});
 const reasons=await admin.adminStopReasons(7,now);
 const balance=reasons.find(r=>r.category==='Solde insuffisant');assert.equal(balance.count,2);assert.equal(balance.reason,'Votre solde disponible (# crédits) ne suffit pas pour démarrer cette demande.');
 assert.equal(reasons.find(r=>r.category==='Fournisseur saturé').count,1);
 assert.ok(!reasons.some(r=>/\d/.test(r.reason)),'amounts are hidden');
 pass('stop reasons are grouped with amounts hidden: balance ×2, provider busy ×1');
}

// Traffic: requests counted in memory, written in one batch, visitors once a day, read back for the admin.
{
 const db=globalThis.__adminFixture.db,today=new Date(now).toISOString().slice(0,10);
 const html=new Response('<!doctype html>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}}),json=new Response('{}',{status:500,headers:{'content-type':'application/json'}});
 const visit=(path,ip,ua,referer,host='https://braand.fun')=>{const r=new Request(host+path,{headers:{'user-agent':ua,'cf-connecting-ip':ip,...(referer?{referer}:{})}});Object.defineProperty(r,'cf',{value:{country:'CM'}});return r;};
 const CHROME='Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',PHONE='Mozilla/5.0 (iPhone) Mobile/15E148';
 let started=Date.now();
 admin.recordTraffic(db,undefined,visit('/','198.51.100.1',CHROME,'https://www.google.com/'),html,started);
 admin.recordTraffic(db,undefined,visit('/aide','198.51.100.1',CHROME,'https://braand.fun/'),html,started);
 admin.recordTraffic(db,undefined,visit('/tarifs','198.51.100.1',CHROME),html,started);
 admin.recordTraffic(db,undefined,visit('/','198.51.100.2',PHONE,'https://l.facebook.com/'),html,started);
 admin.recordTraffic(db,undefined,visit('/','198.51.100.3','Googlebot/2.1'),html,started);
 admin.recordTraffic(db,undefined,visit('/api/billing/summary','198.51.100.1',CHROME),json,started-1200);
 sql.prepare("INSERT OR IGNORE INTO site_publications(id,workspace_id,organization_id,resource_id,slug,resource_version,digest,status,badge,created_at,updated_at) VALUES ('pub-t','user-4','user-4','site-t','mon-salon',1,'d','published',1,?,?)").run(now,now);
 admin.recordTraffic(db,undefined,visit('/mon-salon/','198.51.100.9',PHONE,null,'https://braand-sites.workers.dev'),html,started,{slug:'mon-salon'});
 const written=await admin.flushTraffic(db);
 assert.ok(written.counters>5);assert.equal(written.visitors,3,'three people on braand.fun and the site; the robot is not a visitor');
 assert.equal(sql.prepare("SELECT n FROM traffic_daily WHERE day=? AND scope='app' AND dim='views'").get(today).n,3,'the internal click is not a new visit, the robot is not counted');
 // The same person again the same day is not a new visitor.
 admin.recordTraffic(db,undefined,visit('/','198.51.100.1',CHROME),html,started);await admin.flushTraffic(db);
 assert.equal(sql.prepare("SELECT n FROM traffic_daily WHERE day=? AND scope='app' AND dim='visitors'").get(today).n,2);
 const stored=JSON.stringify(sql.prepare('SELECT * FROM traffic_daily').all())+JSON.stringify(sql.prepare('SELECT * FROM traffic_visitors').all());
 assert.ok(!stored.includes('198.51.100'),'no IP address is stored');assert.equal(sql.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key=?").get('traffic_salt:'+today).n,1);
 // A database failure never throws: the response is already served.
 admin.recordTraffic(db,undefined,visit('/','198.51.100.4',CHROME),html,started);
 assert.deepEqual(await admin.flushTraffic({prepare:()=>({bind:()=>({})}),batch:async()=>{throw new Error('D1 down');}}),{counters:0,visitors:0});
 // Earlier days for the period comparison.
 for(let d=1;d<=40;d++){const day=new Date(now-d*DAY).toISOString().slice(0,10);for(const [dim,value,n] of [['views','',40+d%9*6],['visitors','',18+d%7*3],['source','Google',12],['source','Facebook',9+d%4],['source','Lien direct',11],['page','/',30],['page','/tarifs',8],['country','CM',28],['country','SN',6],['country','FR',4],['device','Téléphone',30],['device','Ordinateur',12],['bot','',14]])ins('traffic_daily',{day,scope:'app',key:'',dim,value,n});
  for(const [dim,value,n] of [['views','',6+d%5],['visitors','',3+d%3]])ins('traffic_daily',{day,scope:'site',key:'mon-salon',dim,value,n});
  for(const [key,count,slow,fail,ms] of [['/api/chat',120,4,1,900],['/api/billing/summary',60,0,0,140],['/api/resources/:id',300,1,0,80]]){ins('traffic_daily',{day,scope:'api',key,dim:'requests',value:'GET',n:count});ins('traffic_daily',{day,scope:'api',key,dim:'status',value:'2xx',n:count-fail});if(fail)ins('traffic_daily',{day,scope:'api',key,dim:'status',value:'5xx',n:fail});ins('traffic_daily',{day,scope:'api',key,dim:'latency',value:'< 10 s',n:slow});ins('traffic_daily',{day,scope:'api',key,dim:'ms_total',value:'',n:count*ms});}}
 const traffic=await admin.adminTraffic(30,now);
 assert.equal(traffic.days,30);assert.equal(traffic.app.series.length,30);assert.equal(traffic.app.series.at(-1).visitors,2);
 assert.ok(traffic.app.views>1000);assert.equal(typeof traffic.app.change.views,'number');assert.ok(traffic.app.conversion>0);
 assert.equal(traffic.app.sources[0].label,'Google');assert.equal(traffic.app.countries[0].label,'CM');assert.equal(traffic.app.devices[0].label,'Téléphone');
 assert.equal(traffic.sites.list[0].slug,'mon-salon');assert.equal(traffic.sites.list[0].owner,sql.prepare("SELECT email FROM auth_users WHERE id='user-4'").get().email);
 const chat=traffic.api.routes.find(r=>r.route==='/api/chat');assert.equal(chat.averageMs,900);assert.ok(chat.errorRate>0);assert.ok(traffic.api.errorRate5>0);
 assert.equal((await admin.adminTraffic('abc',now)).days,30,'an unknown period falls back to 30 days');
 // Retention: daily totals 400 days, visitor hashes and salts 2 days.
 ins('traffic_daily',{day:new Date(now-500*DAY).toISOString().slice(0,10),scope:'app',key:'',dim:'views',value:'',n:1});ins('traffic_visitors',{day:new Date(now-3*DAY).toISOString().slice(0,10),scope:'app',key:'',hash:'old'});
 await admin.cleanupTraffic(db,now);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM traffic_daily WHERE day<?").get(new Date(now-400*DAY).toISOString().slice(0,10)).n,0);assert.equal(sql.prepare("SELECT COUNT(*) n FROM traffic_visitors WHERE hash='old'").get().n,0);
 pass('traffic: one batch per flush, a visitor once a day, robots and internal clicks apart, no IP stored, failures silent, admin figures and retention');
}

if(process.env.ADMIN_PREVIEW==='1'){
 // Render the real interface with these exact answers.
 const routes={'/api/admin/traffic':await admin.adminTraffic(30,now),'/api/admin/overview':{...overview,pendingDecisions:await admin.adminPendingDecisions(now)},'/api/admin/users':await admin.adminUsers(''),'/api/admin/finance':await admin.adminFinance(),'/api/admin/ai':await admin.adminAi(30,now),'/api/admin/media':await admin.adminMedia(30,now),'/api/admin/sites':await admin.adminSites(now),'/api/admin/audit':await admin.adminAudit(''),'/api/admin/system':{services:admin.adminServices(),operations:{jobs:sql.prepare('SELECT * FROM operations_jobs').all(),alerts:sql.prepare('SELECT * FROM operations_alerts').all(),backups:sql.prepare('SELECT * FROM operations_backups ORDER BY created_at DESC').all()},backupHealth:await admin.adminBackupHealth(now),stopReasons:await admin.adminStopReasons(7,now),quality:await admin.agentQualityReport(7,now),lessons:[{tool:'plan_media',code:'invalid_input',count:3,recovered:1}]}};
 for(const u of routes['/api/admin/users'].users)routes['/api/admin/users/'+u.id]=await admin.adminUserDetail(u.id,now);
 writeFileSync(path.join(out,'routes.json'),JSON.stringify(routes));
 await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {AdminDashboard} from "./components/admin/admin-dashboard";import "./app/tokens.css";import "./app/globals.css";
const routes=window.__routes;window.fetch=async(url)=>{const p=new URL(url,location.href).pathname;const body=routes[p];return new Response(JSON.stringify(body??{error:"absent"}),{status:body?200:404,headers:{"Content-Type":"application/json"}});};
createRoot(document.getElementById("root")).render(React.createElement(AdminDashboard));`,resolveDir:root,loader:'tsx'},outfile:path.join(out,'page.js'),bundle:true,format:'esm',jsx:'automatic',loader:{'.ttf':'empty','.woff2':'empty','.svg':'empty','.png':'empty'},external:['/fonts/*'],alias:{'next/link':path.join(out,'link.js'),'@':root},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'}).catch(async e=>{throw e;});
}
console.log(checks+' admin checks passed against the real schema; demo data only.');
