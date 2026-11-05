// Suggestions board against real SQLite with the production schema and
// triggers: create (author votes), vote/unvote, limits, replies, reports,
// visibility, admin status change and notifications, duplicate merge, switch.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/feedback');mkdirSync(out,{recursive:true});
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
sql.exec("CREATE TABLE auth_users(id TEXT PRIMARY KEY,email TEXT);CREATE TABLE files(id TEXT,workspace_id TEXT,storage_key TEXT,size_bytes INTEGER,detected_mime TEXT,status TEXT)");
for(const id of ['marie','paul','awa','admin'])sql.prepare('INSERT INTO auth_users VALUES (?,?)').run(id,id+'@exemple.cm');
const statement=(query,args=[])=>({bind:(...v)=>statement(query,v),async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});
const D1={prepare:q=>statement(q),batch:async rows=>{sql.exec('BEGIN');try{const results=[];for(const row of rows)results.push(await row.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const objects=new Map();
globalThis.__fb={db:D1,env:{BUCKET:{async get(k){const b=objects.get(k);return b?{body:new Blob([b]).stream(),async arrayBuffer(){return b.slice().buffer;}}:null;},async put(k,v){objects.set(k,new Uint8Array(v));}}},paid:new Set(['org-paul'])};
const stubs={
 './server':`const F=globalThis.__fb;export const db=()=>F.db;export const config=()=>F.env;export const uid=()=>crypto.randomUUID();`,
 './billing':`export async function currentSubscription(org){return globalThis.__fb.paid.has(org)?{plan:'pro'}:null;}`,
 './platform-admin':`export const platformAdminIds=()=>new Set(['admin']);`,
};
await build({entryPoints:[path.join(root,'lib/feedback.ts')],outfile:path.join(out,'feedback.mjs'),bundle:true,platform:'node',format:'esm',external:['zod'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^\.\/(server|billing|platform-admin)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:root}));}}]});
const fb=await import(pathToFileURL(path.join(out,'feedback.mjs')));
const who=(id,name)=>({tenant:'ws-'+id,organization:'org-'+id,user:{userId:id,email:id+'@exemple.cm',displayName:id,fullName:name}});
const marie=who('marie','Marie Dupont'),paul=who('paul','Paul Mbarga'),awa=who('awa',null),admin=who('admin','Équipe');
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const post=id=>sql.prepare('SELECT * FROM feedback_posts WHERE id=?').get(id);
let idea,bug;
await check('members get 503 while the switch is off; the team can already prepare',async()=>{
 await assert.rejects(()=>fb.listFeedback(marie,{}),error=>error.status===503&&error.message==='Les suggestions arrivent bientôt.');
 assert.equal((await fb.listFeedback(admin,{})).posts.length,0);
 await fb.adminFeedbackAction('admin',{action:'toggle_flag',enabled:true});assert.equal(await fb.feedbackEnabled(),true);
});
await check('a suggestion is cleaned, signed with a public name and voted by its author',async()=>{
 idea=(await fb.createFeedback(marie,{type:'feature',title:'  Exporter les factures en PDF ',body:'Pour mon comptable.‮'})).post;
 assert.equal(idea.title,'Exporter les factures en PDF');assert.equal(idea.body,'Pour mon comptable.');assert.equal(idea.authorName,'Marie D.');assert.equal(idea.voteCount,1);assert.equal(idea.voted,true);assert.equal(idea.mine,true);
 assert.equal('authorId' in idea,false);
 await assert.rejects(()=>fb.createFeedback(marie,{type:'bug',title:'Bouton cassé partout',body:'bug'}),/ce que vous faisiez/);
 assert.equal((await fb.createFeedback(awa,{type:'feature',title:'Mode sombre partout'})).post.authorName,'Membre Braand');
});
await check('votes are one per person, counted by SQL with paying customers, refused on a duplicate',async()=>{
 const voted=await fb.toggleVote(paul,idea.id);assert.deepEqual(voted,{voted:true,voteCount:2});
 assert.equal(post(idea.id).paid_vote_count,1,'Paul is a paying customer');
 assert.deepEqual(await fb.toggleVote(paul,idea.id),{voted:false,voteCount:1});assert.equal(post(idea.id).paid_vote_count,0);
 await fb.toggleVote(paul,idea.id);
 assert.throws(()=>sql.prepare("UPDATE feedback_posts SET vote_count=-1 WHERE id=?").run(idea.id),/CHECK/);
});
await check('replies and reports keep counters and activity; one report per person and target',async()=>{
 const before=post(idea.id).last_activity_at;
 const detail=await fb.addComment(paul,idea.id,{body:'Oui, et en Excel aussi.'},{} ,Date.now()+1000);assert.equal(detail.post.commentCount,1);assert.equal(detail.comments[0].authorName,'Paul M.');assert.ok(post(idea.id).last_activity_at>before);
 await assert.rejects(()=>fb.addComment(paul,idea.id,{body:'Au nom de l’équipe'},{asTeam:true}),/équipe/);
 assert.deepEqual(await fb.reportFeedback(awa,idea.id,{reason:'Hors sujet'}),{reported:true,alreadyReported:false});
 assert.deepEqual(await fb.reportFeedback(awa,idea.id,{reason:'Encore'}),{reported:true,alreadyReported:true});
 assert.equal(post(idea.id).report_count,1);
});
await check('security bugs are private; hidden posts are for the team; members never get ids',async()=>{
 bug=(await fb.createFeedback(marie,{type:'bug',title:'Je vois les fichiers d’un autre compte',body:'En ouvrant la bibliothèque après connexion.',security:true})).post;
 assert.equal(bug.private,true);
 await assert.rejects(()=>fb.getFeedback(paul,bug.id),error=>error.status===404);
 assert.equal((await fb.getFeedback(marie,bug.id)).post.id,bug.id);assert.equal((await fb.getFeedback(admin,bug.id)).post.authorId,'marie');
 assert.ok(!(await fb.listFeedback(paul,{})).posts.some(p=>p.id===bug.id));
 await fb.adminFeedbackAction('admin',{action:'hide',postId:idea.id,hidden:true});
 assert.ok(!(await fb.listFeedback(paul,{})).posts.some(p=>p.id===idea.id));assert.ok((await fb.listFeedback(admin,{})).posts.some(p=>p.id===idea.id));
 await fb.adminFeedbackAction('admin',{action:'hide',postId:idea.id,hidden:false});
 const listed=JSON.stringify(await fb.listFeedback(paul,{}));assert.doesNotMatch(listed,/"authorId"|reportCount|paidVoteCount|marie@/);
});
await check('search, type filter, sorting and status counts',async()=>{
 const list=await fb.listFeedback(paul,{q:'facture',type:'feature'});assert.deepEqual(list.posts.map(p=>p.id),[idea.id]);assert.equal(list.statusCounts.new,1);
 await fb.adminFeedbackAction('admin',{action:'pin',postId:(await fb.listFeedback(paul,{sort:'recent'})).posts.at(-1).id,pinned:true});
 assert.equal((await fb.listFeedback(paul,{sort:'recent'})).posts[0].pinned,true);
 assert.equal((await fb.similarFeedback(paul,'Export des factures PDF')).posts[0].id,idea.id);
});
await check('an admin status change notifies the author and voters, and the summary counts it',async()=>{
 await fb.adminFeedbackAction('admin',{action:'status',postId:idea.id,status:'planned'});
 const notes=await fb.listNotifications(paul);assert.equal(notes.notifications[0].status,'planned');assert.equal(notes.notifications[0].postId,idea.id);
 assert.equal((await fb.listNotifications(marie)).notifications.length,1);
 assert.equal((await fb.feedbackSummary(paul)).unreadNotifications,1);
 await fb.readNotifications(paul,{});assert.equal((await fb.feedbackSummary(paul)).unreadNotifications,0);
 await fb.adminFeedbackAction('admin',{action:'team_reply',postId:idea.id,body:'Prévu pour décembre.'});
 assert.ok((await fb.getFeedback(paul,idea.id)).comments.some(c=>c.isTeam&&c.authorName==='Équipe Braand'));
 await assert.rejects(()=>fb.adminFeedbackAction('admin',{action:'status',postId:idea.id,status:'duplicate'}),/fusion/);
});
await check('merging a duplicate moves votes once per person and refuses forbidden targets',async()=>{
 const copy=(await fb.createFeedback(awa,{type:'feature',title:'Factures exportées en PDF'})).post;
 await fb.toggleVote(paul,copy.id);await fb.toggleVote(who('admin','A'),copy.id);
 assert.equal(post(idea.id).vote_count,2);assert.equal(post(copy.id).vote_count,3);
 await assert.rejects(()=>fb.mergeDuplicate(copy.id,copy.id,'admin'),/elle-même/);
 await fb.adminFeedbackAction('admin',{action:'hide',postId:bug.id,hidden:true});await assert.rejects(()=>fb.mergeDuplicate(copy.id,bug.id,'admin'),/masquée/);
 await fb.adminFeedbackAction('admin',{action:'merge',sourceId:copy.id,targetId:idea.id});
 assert.equal(post(copy.id).status,'duplicate');assert.equal(post(copy.id).duplicate_of,idea.id);assert.equal(post(copy.id).vote_count,0);
 assert.equal(post(idea.id).vote_count,4,'marie, paul (once), awa and admin');
 await assert.rejects(()=>fb.toggleVote(paul,copy.id),/doublon/);
 const detail=await fb.getFeedback(awa,copy.id);assert.equal(detail.original.id,idea.id);
 await assert.rejects(()=>fb.mergeDuplicate(idea.id,copy.id,'admin'),/déjà un doublon/);
 assert.ok((await fb.listNotifications(awa)).notifications.some(n=>n.status==='duplicate'));
});
await check('moderation: hide a reply, resolve a report; rate limits answer clearly',async()=>{
 const detail=await fb.getFeedback(admin,idea.id),reply=detail.comments.find(c=>!c.isTeam);
 await fb.adminFeedbackAction('admin',{action:'hide_comment',commentId:reply.id,hidden:true});
 assert.equal(post(idea.id).comment_count,1,'only the team reply stays visible');assert.ok(!(await fb.getFeedback(paul,idea.id)).comments.some(c=>c.id===reply.id));
 const report=(await fb.adminFeedbackOverview()).reports[0];await fb.adminFeedbackAction('admin',{action:'resolve_report',reportId:report.id});assert.equal(post(idea.id).report_count,0);
 for(let i=0;i<3;i++)await fb.createFeedback(marie,{type:'feature',title:'Idée numéro '+i+' complète'});
 await assert.rejects(()=>fb.createFeedback(marie,{type:'feature',title:'Sixième idée du jour'}),error=>error.status===429&&/5 suggestions/.test(error.message));
 await fb.adminFeedbackAction('admin',{action:'toggle_flag',enabled:false});await assert.rejects(()=>fb.feedbackSummary(paul),error=>error.status===503);
});
console.log(`${checks} suggestions checks passed against SQLite with the real triggers.`);
