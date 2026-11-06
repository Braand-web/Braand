// Proactive watch, site figures and learning progress on the real schema
// (SQLite in memory): a drop and stopped contact requests become insights in
// the owner's workspace only, once per week, close by themselves when the
// figures recover; the owner sees the figures and what Braand learned.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/watch');mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const part of readFileSync(path.join(root,'drizzle',file),'utf8').split('--> statement-breakpoint'))try{sql.exec(part);}catch{/* idempotent */}
sql.exec('PRAGMA foreign_keys=OFF');
const {SITES_SCHEMA}=await import(pathToFileURL(path.join(root,'lib/site-files.mjs')).href);for(const s of SITES_SCHEMA)sql.exec(s);
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
globalThis.__watch={prepare:q=>statement(q),batch:async rows=>{const out=[];for(const r of rows)out.push(await r.run());return out;}};
await build({stdin:{contents:`export * from ${JSON.stringify(path.join(root,'lib/watch.ts'))};export * from ${JSON.stringify(path.join(root,'lib/site-insights.ts'))};export * from ${JSON.stringify(path.join(root,'lib/learning-progress.ts'))};`,resolveDir:root,loader:'ts'},outfile:path.join(out,'watch.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/server$/},()=>({path:'server',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db=()=>globalThis.__watch;',loader:'js'}));}}]});
const w=await import(pathToFileURL(path.join(out,'watch.mjs')).href);
const now=Date.parse('2026-11-20T10:00:00Z'),DAY=86400000,day=d=>new Date(now-d*DAY).toISOString().slice(0,10);
const ins=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES (${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
const publish=(id,ws,slug)=>ins('site_publications',{id,workspace_id:ws,organization_id:ws,resource_id:'r-'+id,slug,resource_version:1,digest:'d',live_digest:'d',status:'published',badge:1,created_at:now-40*DAY,updated_at:now-40*DAY});
publish('p1','ws-a','salon-awa');publish('p2','ws-b','boutique-lumi');publish('p3','ws-a','calme');
for(let d=1;d<=17;d++){
 ins('traffic_daily',{day:day(d),scope:'site',key:'salon-awa',dim:'views',value:'',n:d<=3?7:22});
 ins('traffic_daily',{day:day(d),scope:'site',key:'salon-awa',dim:'visitors',value:'',n:d<=3?5:15});
 ins('traffic_daily',{day:day(d),scope:'site',key:'boutique-lumi',dim:'views',value:'',n:30});
 ins('traffic_daily',{day:day(d),scope:'site',key:'calme',dim:'views',value:'',n:3});
 if(d>7&&d%3===0)ins('site_leads',{id:'lead-'+d,publication_id:'p2',workspace_id:'ws-b',name:'Client',email:'c@exemple.cm',message:'MESSAGE PRIVE',created_at:now-d*DAY});
}
ins('traffic_daily',{day:day(2),scope:'site',key:'salon-awa',dim:'source',value:'Facebook',n:9});
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};

const first=await w.scanSiteWatch(now);
assert.deepEqual(first,{skipped:false,raised:2,resolved:0});
assert.equal((await w.scanSiteWatch(now)).skipped,true,'at most once an hour');
assert.equal((await w.scanSiteWatch(now+3600000)).raised,0,'the same signal is not raised twice');
const a=await w.listInsights('ws-a',now),b=await w.listInsights('ws-b',now);
assert.equal(a.length,1);assert.equal(a[0].type,'site_traffic_drop');assert.equal(a[0].slug,'salon-awa');assert.equal(a[0].facts.changePercent,-68);assert.match(a[0].title,/baissé de 68 %/);
assert.equal(b.length,1);assert.equal(b[0].type,'site_leads_stopped');
assert.ok(!JSON.stringify(b).includes('MESSAGE PRIVE'),'never the content of a contact request');
assert.deepEqual(await w.listInsights('ws-c',now),[]);
pass('a real drop and stopped contact requests become one insight each, in the owner workspace only; a small site stays quiet');

const opened=await w.updateInsight('ws-a',a[0].id,'investigate',now);assert.equal(opened.status,'investigating');
await assert.rejects(()=>w.updateInsight('ws-b',a[0].id,'dismiss',now),/introuvable/,'another workspace cannot touch it');
await w.updateInsight('ws-b',b[0].id,'dismiss',now);assert.equal((await w.listInsights('ws-b',now)).length,0);
pass('the owner analyses or dismisses an insight; another workspace cannot');

// Two days later the visits are back: the insight closes by itself with the figures.
const later=now+2*DAY;for(let d=0;d<=1;d++)for(const k of ['views'])sql.prepare("INSERT INTO traffic_daily(day,scope,key,dim,value,n) VALUES (?,'site','salon-awa',?,'',?) ON CONFLICT(day,scope,key,dim,value) DO UPDATE SET n=excluded.n").run(new Date(later-(d+1)*DAY).toISOString().slice(0,10),k,25);
sql.prepare("UPDATE traffic_daily SET n=25 WHERE key='salon-awa' AND dim='views' AND day=?").run(new Date(later-3*DAY).toISOString().slice(0,10));
const back=await w.scanSiteWatch(later);assert.equal(back.resolved,1);
const resolved=(await w.listInsights('ws-a',later)).find(i=>i.id===a[0].id);assert.equal(resolved.status,'resolved');assert.ok(resolved.result.lastViews3d>=48);
pass('when the visits recover, Braand closes the insight by itself and keeps the result');

const traffic=await w.siteTraffic('ws-b','boutique-lumi',30,now);
assert.equal(traffic.totals.views,17*30);assert.equal(traffic.totals.leads,3);assert.equal(traffic.series.length,30);
await assert.rejects(()=>w.siteTraffic('ws-a','boutique-lumi',30,now),/introuvable/,'only sites of this workspace');
assert.equal((await w.siteTraffic('ws-a','salon-awa',30,now)).sources[0].label,'Facebook');
pass('site figures: visits, contact requests count and sources, for the owner only');

// Learning progress: corrections per 10 answers fall from the first weeks to the last.
for(let i=0;i<40;i++)ins('runs',{id:'run-'+i,workspace_id:'ws-a',conversation_id:'c',status:'completed',created_at:now-(i<20?6:1)*7*DAY+i*1000,updated_at:now});
for(let i=0;i<6;i++)ins('resources',{id:'k-'+i,workspace_id:'ws-a',kind:'knowledge',title:'Correction',data:JSON.stringify({content:'Toujours vouvoyer les clients '+i,learning:{kind:i<5?'correction':'preference'}}),status:'saved',created_at:now-(i<4?6:1)*7*DAY,updated_at:now});
ins('resources',{id:'skill-1',workspace_id:'ws-a',kind:'skill',title:'Publications Facebook',data:JSON.stringify({changeLog:[{at:now-8*DAY*7,by:'user',reason:'Création'},{at:now-DAY,by:'Amélioration Braand',reason:'Ajout : vouvoyer les clients'}]}),status:'ready',created_at:now-60*DAY,updated_at:now});
const progress=await w.learningProgress('ws-a',8,now);
assert.equal(progress.totals.answers,40);assert.equal(progress.totals.corrections,5);assert.equal(progress.totals.methodChanges,1);
assert.equal(progress.correctionsPer10.before,2);assert.equal(progress.correctionsPer10.after,0.5);assert.equal(progress.correctionsPer10.trend,'improving');
assert.match(progress.recentMethodChanges[0].reason,/vouvoyer/);
assert.deepEqual((await w.learningProgress('ws-b',8,now)).totals,{answers:0,corrections:0,preferences:0,methodChanges:0});
pass('learning progress: corrections per 10 answers 2 → 0,5, the method improved from a correction, per workspace');
console.log(checks+' watch, site figures and learning checks passed on the real schema.');
