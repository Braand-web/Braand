import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText,validatePost,validateComment,publicName,trendingScore,sortPosts,similarPosts,similarity,tokens,canSee,toPublicPost,toPublicComment,FeedbackRuleError,BUG_PROMPT} from '../lib/feedback-rules.mjs';

test('text is cleaned of control and bidirectional marks, blank lines are reduced',()=>{
 assert.equal(cleanText('  Bonjour\u0007\r\n\r\n\r\n\r\nmonde‮  '),'Bonjour\n\nmonde');
 assert.equal(cleanText('lien ‮gnp.exe‬'),'lien gnp.exe');
 assert.equal(cleanText('a⁦b⁩c‏d'),'abcd');
 assert.equal(cleanText('<b>gras</b>'),'<b>gras</b>','markup stays as text; it is escaped when displayed');
 assert.equal(cleanText(42),'');
});
test('a suggestion needs a type, a title of 8 to 120 characters and a usable bug report',()=>{
 const fail=(input,field)=>assert.throws(()=>validatePost(input),error=>error instanceof FeedbackRuleError&&error.field===field);
 fail({title:'Un titre assez long'},'type');
 fail({type:'feature',title:'Court'},'title');
 fail({type:'feature',title:'x'.repeat(121)},'title');
 fail({type:'feature',title:'Un titre assez long',body:'x'.repeat(5001)},'body');
 assert.throws(()=>validatePost({type:'bug',title:'Le bouton ne marche pas',body:'cassé'}),error=>error.message===BUG_PROMPT);
 fail({type:'feature',title:'Un titre assez long',security:true},'security');
 assert.deepEqual(validatePost({type:'feature',title:'  Exporter   en PDF  ',body:' Merci '}),{type:'feature',title:'Exporter en PDF',body:'Merci',private:false});
 assert.equal(validatePost({type:'bug',title:'Fuite de données possible',body:'Je voyais les fichiers d’un autre compte.',security:true}).private,true);
 assert.throws(()=>validateComment('   '),/Écrivez/);assert.throws(()=>validateComment('x'.repeat(3001)),/3 000/);
});
test('public names are first name and initial, never an e-mail',()=>{
 assert.equal(publicName('marie dupont'),'Marie D.');
 assert.equal(publicName('Jean-Paul  N’Diaye'),'Jean-Paul N.');
 assert.equal(publicName('Awa'),'Awa');
 assert.equal(publicName('awa@exemple.cm'),'Membre Braand');
 assert.equal(publicName('  <script> 123 '),'Script');
 assert.equal(publicName(''),'Membre Braand');assert.equal(publicName(null),'Membre Braand');
});
const H=3600000,now=Date.UTC(2026,10,5);
const post=(id,extra)=>({id,status:'new',vote_count:0,comment_count:0,pinned:0,created_at:now-10*H,last_activity_at:now-10*H,...extra});
test('trending weighs votes and replies against age and inactivity; pinned and open first',()=>{
 assert.ok(trendingScore(post('a',{vote_count:10}),now)>trendingScore(post('b',{vote_count:2}),now));
 assert.ok(trendingScore(post('new',{created_at:now-H,last_activity_at:now-H}),now)>trendingScore(post('old',{created_at:now-200*H,last_activity_at:now-200*H}),now));
 assert.ok(trendingScore(post('active',{last_activity_at:now}),now)>trendingScore(post('idle'),now));
 const sorted=sortPosts([post('done',{status:'done',vote_count:50}),post('open',{vote_count:1}),post('pin',{pinned:1})],'trending',now).map(p=>p.id);
 assert.deepEqual(sorted,['pin','open','done']);
 assert.deepEqual(sortPosts([post('a',{vote_count:1}),post('b',{vote_count:5,status:'done'})],'top',now).map(p=>p.id),['b','a']);
 assert.deepEqual(sortPosts([post('a',{comment_count:9}),post('b',{comment_count:2})],'discussed',now).map(p=>p.id),['a','b']);
 assert.deepEqual(sortPosts([post('old'),post('new',{created_at:now})],'recent',now).map(p=>p.id),['new','old']);
});
test('similar titles ignore accents, stop words and plurals; duplicates are excluded',()=>{
 assert.deepEqual(tokens('Les Exports en PDF des factures'),['export','pdf','facture']);
 assert.ok(similarity('Exporter les factures en PDF','Export PDF des factures')>=0.34);
 const posts=[post('1',{title:'Export PDF des factures'}),post('2',{title:'Mode sombre partout'}),post('3',{title:'Exporter facture PDF',status:'duplicate'})];
 assert.deepEqual(similarPosts('Pouvoir exporter les factures en PDF',posts).map(p=>p.id),['1']);
 assert.equal(similarPosts('xyz',posts).length,0);
 assert.equal(similarPosts('facture',Array.from({length:9},(_,i)=>post('p'+i,{title:'Facture numéro '+i}))).length,5);
});
test('hidden posts are for the team, private posts for their author and the team; no id leaks',()=>{
 const member={userId:'u1'},other={userId:'u2'},team={userId:'admin',team:true};
 const priv=post('p',{private:1,author_id:'u1'}),hidden=post('h',{hidden_at:now,author_id:'u1'});
 assert.equal(canSee(priv,member),true);assert.equal(canSee(priv,other),false);assert.equal(canSee(priv,team),true);
 assert.equal(canSee(hidden,member),false);assert.equal(canSee(hidden,team),true);
 const shown=toPublicPost({...post('x',{author_id:'u1',report_count:3,paid_vote_count:2,author_name:'Marie D.'})},other);
 for(const key of ['authorId','author_id','reportCount','paidVoteCount','hiddenAt'])assert.equal(key in shown,false,key);
 assert.equal(toPublicPost(post('x',{author_id:'u1'}),member).mine,true);
 assert.equal(toPublicPost(post('x',{author_id:'u1',report_count:3}),team).reportCount,3);
 assert.equal('authorId' in toPublicComment({id:'c',author_id:'u1',body:'b',author_name:'A',is_team:1},other),false);
});
