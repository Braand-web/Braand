// Suggestions board: the only code that reads or writes the feedback tables.
// The browser never touches the database; every rule, limit and right is
// checked here. Behind the admin switch platform_settings.feedback_enabled
// (off by default): members get 503 while it is off, admins can still prepare.
import {z} from 'zod';
import {config,db,uid} from './server';
import {AppError} from './core.mjs';
import {currentSubscription,type BillingIdentity} from './billing';
import {platformAdminIds} from './platform-owners';
import {FEEDBACK_SCHEMA,FEEDBACK_STATUSES} from './feedback-schema.mjs';
import {FEEDBACK_LIMITS,FeedbackRuleError,canSee,publicName,similarPosts,sortPosts,toPublicComment,toPublicPost,validateComment,validatePost,validateReason,SORTS,isStatus} from './feedback-rules.mjs';

type Post={id:string;author_id:string|null;author_name:string;type:string;title:string;body:string;private:number;status:string;duplicate_of:string|null;attachment_id:string|null;attachment_path:string|null;vote_count:number;paid_vote_count:number;comment_count:number;report_count:number;pinned:number;hidden_at:number|null;hidden_by:string|null;status_changed_at:number|null;last_activity_at:number;created_at:number;updated_at:number};
type Comment={id:string;post_id:string;author_id:string|null;author_name:string;body:string;is_team:number;pinned:number;hidden_at:number|null;hidden_by:string|null;created_at:number};
type Viewer={userId:string;team:boolean};
const UNAVAILABLE='Les suggestions arrivent bientôt.';
const PAGE=20,SCAN=500;

let ready:Promise<void>|null=null;
export function ensureFeedbackSchema(){
 ready??=db().batch(FEEDBACK_SCHEMA.map(sql=>db().prepare(sql))).then(()=>undefined).catch(error=>{ready=null;throw error;});
 return ready;
}
export async function feedbackEnabled(){
 try{return (await db().prepare("SELECT value FROM platform_settings WHERE key='feedback_enabled'").first<{value:string}>())?.value==='true';}catch{return false;}
}
const viewerOf=(who:BillingIdentity):Viewer=>({userId:who.user.userId,team:platformAdminIds().has(who.user.userId)});
/** Members get 503 while the switch is off or the tables are missing; the team can still prepare. */
async function open(who:BillingIdentity){
 const viewer=viewerOf(who);
 try{await ensureFeedbackSchema();}catch{throw new AppError(UNAVAILABLE,503,'feedback_unavailable');}
 if(!viewer.team&&!await feedbackEnabled())throw new AppError(UNAVAILABLE,503,'feedback_unavailable');
 return viewer;
}
const rule=<T>(fn:()=>T)=>{try{return fn();}catch(error){if(error instanceof FeedbackRuleError)throw new AppError(error.message,400,'feedback_invalid_'+error.field);throw error;}};
async function limit(kind:keyof typeof FEEDBACK_LIMITS,userId:string,now=Date.now()){
 const rule=FEEDBACK_LIMITS[kind],slot=Math.floor(now/rule.periodMs),bucket=`${kind}:${userId}:${slot}`;
 const row=await db().prepare('INSERT INTO feedback_rate_limits(bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(bucket,(slot+1)*rule.periodMs,rule.max).first<{count:number}>();
 if(!row)throw new AppError(rule.message,429,'feedback_rate_limited');
 if(Math.random()<0.02)await db().prepare('DELETE FROM feedback_rate_limits WHERE expires_at<?').bind(now).run();
}
async function postFor(id:string,viewer:Viewer){
 const post=await db().prepare('SELECT * FROM feedback_posts WHERE id=?').bind(id).first<Post>();
 // Invisible and missing answer the same way.
 if(!post||!canSee(post,viewer))throw new AppError('Suggestion introuvable.',404,'feedback_not_found');
 return post;
}
function visibility(viewer:Viewer){return viewer.team?{sql:'1=1',args:[] as unknown[]}:{sql:'hidden_at IS NULL AND (private=0 OR author_id=?)',args:[viewer.userId] as unknown[]};}
const listInput=z.object({q:z.string().max(120).optional(),type:z.enum(['feature','bug']).optional(),status:z.enum(FEEDBACK_STATUSES as unknown as [string,...string[]]).optional(),sort:z.enum(SORTS as unknown as [string,...string[]]).optional(),page:z.coerce.number().int().min(1).max(50).optional()});

export async function listFeedback(who:BillingIdentity,raw:unknown,now=Date.now()){
 const viewer=await open(who),p=listInput.parse(raw),seen=visibility(viewer);
 const where=[seen.sql],args=[...seen.args];
 if(p.type){where.push('type=?');args.push(p.type);}
 if(p.q?.trim()){where.push('(title LIKE ? ESCAPE \'\\\' OR body LIKE ? ESCAPE \'\\\')');const like='%'+p.q.trim().replace(/[\\%_]/g,m=>'\\'+m)+'%';args.push(like,like);}
 const counts=(await db().prepare(`SELECT status,COUNT(*) n FROM feedback_posts WHERE ${where.join(' AND ')} GROUP BY status`).bind(...args).all<{status:string;n:number}>()).results;
 if(p.status){where.push('status=?');args.push(p.status);}
 const rows=(await db().prepare(`SELECT * FROM feedback_posts WHERE ${where.join(' AND ')} ORDER BY pinned DESC,last_activity_at DESC LIMIT ${SCAN}`).bind(...args).all<Post>()).results;
 const page=p.page||1,sorted=sortPosts(rows,p.sort||'trending',now),slice=sorted.slice((page-1)*PAGE,page*PAGE);
 const voted=await votedSet(viewer.userId,slice.map(post=>post.id));
 if(page===1&&!p.q)await db().prepare('INSERT INTO feedback_visits(user_id,seen_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET seen_at=excluded.seen_at').bind(viewer.userId,now).run();
 return {posts:slice.map(post=>toPublicPost(post,viewer,{voted:voted.has(post.id),excerpt:post.body.slice(0,180)})),page,pages:Math.max(1,Math.ceil(sorted.length/PAGE)),total:sorted.length,statusCounts:Object.fromEntries(counts.map(row=>[row.status,row.n])),team:viewer.team};
}
async function votedSet(userId:string,ids:string[]){
 if(!ids.length)return new Set<string>();
 const rows=(await db().prepare(`SELECT post_id FROM feedback_votes WHERE user_id=? AND post_id IN (${ids.map(()=>'?').join(',')})`).bind(userId,...ids).all<{post_id:string}>()).results;
 return new Set(rows.map(row=>row.post_id));
}
export async function feedbackSummary(who:BillingIdentity){
 // Called on every page to decide whether to show the tab: a closed tab is an
 // ordinary answer, not an error in the member's console.
 let viewer:Awaited<ReturnType<typeof open>>;
 try{viewer=await open(who);}catch(error){if(error instanceof AppError&&error.code==='feedback_unavailable')return {enabled:false,team:false,newSinceVisit:0,unreadNotifications:0};throw error;}
 const seen=visibility(viewer);
 const visit=await db().prepare('SELECT seen_at FROM feedback_visits WHERE user_id=?').bind(viewer.userId).first<{seen_at:number}>();
 const fresh=await db().prepare(`SELECT COUNT(*) n FROM feedback_posts WHERE ${seen.sql} AND created_at>? AND (author_id IS NULL OR author_id!=?)`).bind(...seen.args,visit?.seen_at||0,viewer.userId).first<{n:number}>();
 const unread=await db().prepare('SELECT COUNT(*) n FROM feedback_notifications WHERE user_id=? AND read_at IS NULL').bind(viewer.userId).first<{n:number}>();
 return {enabled:await feedbackEnabled(),team:viewer.team,newSinceVisit:visit?fresh?.n||0:0,unreadNotifications:unread?.n||0};
}
export async function similarFeedback(who:BillingIdentity,title:string){
 const viewer=await open(who),seen=visibility(viewer);
 const rows=(await db().prepare(`SELECT * FROM feedback_posts WHERE ${seen.sql} AND status!='duplicate' ORDER BY vote_count DESC LIMIT ${SCAN}`).bind(...seen.args).all<Post>()).results;
 return {posts:similarPosts(String(title||'').slice(0,120),rows).map((post:Post)=>toPublicPost(post,viewer))};
}
export async function getFeedback(who:BillingIdentity,id:string){
 const viewer=await open(who),post=await postFor(id,viewer);
 const comments=(await db().prepare(`SELECT * FROM feedback_comments WHERE post_id=? ${viewer.team?'':'AND hidden_at IS NULL'} ORDER BY pinned DESC,created_at ASC LIMIT 500`).bind(id).all<Comment>()).results;
 const original=post.duplicate_of?await db().prepare('SELECT * FROM feedback_posts WHERE id=?').bind(post.duplicate_of).first<Post>():null;
 const voted=(await votedSet(viewer.userId,[id])).has(id);
 return {post:toPublicPost(post,viewer,{voted}),comments:comments.map(comment=>toPublicComment(comment,viewer)),original:original&&canSee(original,viewer)?toPublicPost(original,viewer):null,team:viewer.team};
}

const createInput=z.object({type:z.string(),title:z.string().max(400),body:z.string().max(12000).optional(),security:z.boolean().optional(),attachmentFileId:z.string().max(80).optional()}).strict();
const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
export async function createFeedback(who:BillingIdentity,raw:unknown,now=Date.now()){
 const viewer=await open(who),input=createInput.parse(raw),post=rule(()=>validatePost(input));
 let attachment:{id:string;key:string;bytes:ArrayBuffer;mime:string}|null=null;
 if(input.attachmentFileId){
  const file=await db().prepare("SELECT id,storage_key,size_bytes,detected_mime FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(input.attachmentFileId,who.tenant).first<{id:string;storage_key:string;size_bytes:number;detected_mime:string}>();
  if(!file||!IMAGE_TYPES.has(file.detected_mime))throw new AppError('La capture doit être une image PNG, JPEG ou WebP de votre bibliothèque.',400,'feedback_attachment_invalid');
  if(file.size_bytes>5*1024*1024)throw new AppError('La capture doit faire au plus 5 Mio.',413,'feedback_attachment_too_large');
  const object=await config().BUCKET?.get(file.storage_key);if(!object)throw new AppError('Capture introuvable. Importez-la à nouveau.',404);
  attachment={id:file.id,key:'',bytes:await object.arrayBuffer(),mime:file.detected_mime};
 }
 await limit('posts',viewer.userId,now);
 const id=uid(),paid=await currentSubscription(who.organization).then(sub=>sub?1:0).catch(()=>0),name=publicName((who.user as {fullName?:string|null}).fullName??null);
 if(attachment){attachment.key=`feedback/${id}/capture.${attachment.mime.split('/')[1]}`;await config().BUCKET!.put(attachment.key,attachment.bytes,{httpMetadata:{contentType:attachment.mime}});}
 await db().batch([
  db().prepare('INSERT INTO feedback_posts(id,author_id,author_name,type,title,body,private,status,attachment_id,attachment_path,last_activity_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'new\',?,?,?,?,?)').bind(id,viewer.userId,name,post.type,post.title,post.body,post.private?1:0,attachment?.id??null,attachment?.key??null,now,now,now),
  // The author supports their own suggestion.
  db().prepare('INSERT INTO feedback_votes(post_id,user_id,is_paid,created_at) VALUES (?,?,?,?)').bind(id,viewer.userId,paid,now),
 ]);
 return getFeedback(who,id);
}
export async function toggleVote(who:BillingIdentity,id:string,now=Date.now()){
 const viewer=await open(who),post=await postFor(id,viewer);
 if(post.status==='duplicate')throw new AppError('Cette suggestion est un doublon : votez pour l’originale.',409,'feedback_duplicate');
 await limit('votes',viewer.userId,now);
 const removed=await db().prepare('DELETE FROM feedback_votes WHERE post_id=? AND user_id=?').bind(id,viewer.userId).run();
 if(!removed.meta.changes){const paid=await currentSubscription(who.organization).then(sub=>sub?1:0).catch(()=>0);await db().prepare('INSERT OR IGNORE INTO feedback_votes(post_id,user_id,is_paid,created_at) VALUES (?,?,?,?)').bind(id,viewer.userId,paid,now).run();}
 const fresh=await db().prepare('SELECT vote_count FROM feedback_posts WHERE id=?').bind(id).first<{vote_count:number}>();
 return {voted:!removed.meta.changes,voteCount:fresh?.vote_count??0};
}
export async function addComment(who:BillingIdentity,id:string,raw:unknown,options:{asTeam?:boolean}={},now=Date.now()){
 const viewer=await open(who),post=await postFor(id,viewer),body=rule(()=>validateComment(z.object({body:z.string().max(8000)}).parse(raw).body));
 if(options.asTeam&&!viewer.team)throw new AppError('Réservé à l’équipe.',403);
 await limit('comments',viewer.userId,now);
 const commentId=uid(),name=options.asTeam?'Équipe Braand':publicName((who.user as {fullName?:string|null}).fullName??null);
 await db().prepare('INSERT INTO feedback_comments(id,post_id,author_id,author_name,body,is_team,created_at) VALUES (?,?,?,?,?,?,?)').bind(commentId,post.id,viewer.userId,name,body,options.asTeam?1:0,now).run();
 return getFeedback(who,id);
}
export async function reportFeedback(who:BillingIdentity,id:string,raw:unknown,now=Date.now()){
 const viewer=await open(who),post=await postFor(id,viewer),p=z.object({commentId:z.string().max(80).optional(),reason:z.string().max(1000).optional()}).strict().parse(raw),reason=rule(()=>validateReason(p.reason||''));
 if(p.commentId&&!await db().prepare('SELECT 1 x FROM feedback_comments WHERE id=? AND post_id=?').bind(p.commentId,post.id).first())throw new AppError('Réponse introuvable.',404);
 await limit('reports',viewer.userId,now);
 const result=await db().prepare('INSERT OR IGNORE INTO feedback_reports(id,post_id,comment_id,reporter_id,reason,created_at) VALUES (?,?,?,?,?,?)').bind(uid(),post.id,p.commentId??null,viewer.userId,reason,now).run();
 return {reported:true,alreadyReported:!result.meta.changes};
}
export async function listNotifications(who:BillingIdentity){
 const viewer=await open(who);
 const rows=(await db().prepare('SELECT n.id,n.post_id,n.status,n.read_at,n.created_at,p.title FROM feedback_notifications n JOIN feedback_posts p ON p.id=n.post_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 50').bind(viewer.userId).all<{id:string;post_id:string;status:string;read_at:number|null;created_at:number;title:string}>()).results;
 return {notifications:rows.map(row=>({id:row.id,postId:row.post_id,title:row.title,status:row.status,read:!!row.read_at,createdAt:row.created_at}))};
}
export async function readNotifications(who:BillingIdentity,raw:unknown,now=Date.now()){
 const viewer=await open(who),p=z.object({ids:z.array(z.string().max(80)).max(100).optional()}).strict().parse(raw);
 if(p.ids?.length)await db().prepare(`UPDATE feedback_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${p.ids.map(()=>'?').join(',')})`).bind(now,viewer.userId,...p.ids).run();
 else await db().prepare('UPDATE feedback_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now,viewer.userId).run();
 return {ok:true};
}
export async function feedbackAttachment(who:BillingIdentity,id:string){
 const viewer=await open(who),post=await postFor(id,viewer);
 const object=post.attachment_path?await config().BUCKET?.get(post.attachment_path):null;
 if(!object)throw new AppError('Capture introuvable.',404);
 return new Response(object.body,{headers:{'Content-Type':post.attachment_path!.endsWith('.png')?'image/png':post.attachment_path!.endsWith('.webp')?'image/webp':'image/jpeg','Content-Disposition':'inline','X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=300','Content-Security-Policy':"default-src 'none'; sandbox"}});
}

// ---------- Team (platform admins, checked by the routes) ----------
const adminInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('status'),postId:z.string().max(80),status:z.enum(FEEDBACK_STATUSES as unknown as [string,...string[]])}).strict(),
 z.object({action:z.literal('pin'),postId:z.string().max(80),pinned:z.boolean()}).strict(),
 z.object({action:z.literal('hide'),postId:z.string().max(80),hidden:z.boolean()}).strict(),
 z.object({action:z.literal('team_reply'),postId:z.string().max(80),body:z.string().max(8000)}).strict(),
 z.object({action:z.literal('merge'),sourceId:z.string().max(80),targetId:z.string().max(80)}).strict(),
 z.object({action:z.literal('hide_comment'),commentId:z.string().max(80),hidden:z.boolean()}).strict(),
 z.object({action:z.literal('pin_comment'),commentId:z.string().max(80),pinned:z.boolean()}).strict(),
 z.object({action:z.literal('resolve_report'),reportId:z.string().max(80)}).strict(),
 z.object({action:z.literal('toggle_flag'),enabled:z.boolean()}).strict(),
]);
type AdminAction=z.infer<typeof adminInput>;
/** Notifies the author and every voter (except the person who made the change). */
async function notifyStatus(postId:string,status:string,actor:string,now:number){
 await db().prepare("INSERT OR IGNORE INTO feedback_notifications(id,user_id,post_id,status,created_at) SELECT lower(hex(randomblob(16))),user_id,?,?,? FROM (SELECT user_id FROM feedback_votes WHERE post_id=? UNION SELECT author_id FROM feedback_posts WHERE id=? AND author_id IS NOT NULL) WHERE user_id!=?").bind(postId,status,now,postId,postId,actor).run();
}
/** D1 has no stored functions: the merge is one atomic batch, run only from the admin route. */
export async function mergeDuplicate(sourceId:string,targetId:string,actor:string,now=Date.now()){
 if(sourceId===targetId)throw new AppError('Une suggestion ne peut pas être fusionnée avec elle-même.',400,'feedback_merge_self');
 const [source,target]=await Promise.all([db().prepare('SELECT * FROM feedback_posts WHERE id=?').bind(sourceId).first<Post>(),db().prepare('SELECT * FROM feedback_posts WHERE id=?').bind(targetId).first<Post>()]);
 if(!source||!target)throw new AppError('Suggestion introuvable.',404);
 if(target.hidden_at||target.status==='duplicate')throw new AppError('La suggestion cible est masquée ou déjà un doublon.',409,'feedback_merge_target');
 if(source.status==='duplicate')throw new AppError('Cette suggestion est déjà un doublon.',409,'feedback_merge_source');
 await db().batch([
  db().prepare('INSERT OR IGNORE INTO feedback_votes(post_id,user_id,is_paid,created_at) SELECT ?,user_id,is_paid,created_at FROM feedback_votes WHERE post_id=?').bind(targetId,sourceId),
  db().prepare('DELETE FROM feedback_votes WHERE post_id=?').bind(sourceId),
  db().prepare("UPDATE feedback_posts SET status='duplicate',duplicate_of=?,status_changed_at=?,updated_at=? WHERE id=? AND status!='duplicate'").bind(targetId,now,now,sourceId),
  db().prepare('UPDATE feedback_posts SET last_activity_at=?,updated_at=? WHERE id=?').bind(now,now,targetId),
 ]);
 await notifyStatus(sourceId,'duplicate',actor,now);
 return {merged:true};
}
export async function adminFeedbackAction(actorId:string,raw:unknown,now=Date.now()):Promise<{ok:true;message:string}>{
 await ensureFeedbackSchema();const p:AdminAction=adminInput.parse(raw);
 const exists=async(id:string)=>{if(!await db().prepare('SELECT 1 x FROM feedback_posts WHERE id=?').bind(id).first())throw new AppError('Suggestion introuvable.',404);};
 switch(p.action){
  case 'status':{await exists(p.postId);if(!isStatus(p.status)||p.status==='duplicate')throw new AppError('Pour un doublon, utilisez la fusion.',400);const r=await db().prepare('UPDATE feedback_posts SET status=?,status_changed_at=?,updated_at=? WHERE id=? AND status!=?').bind(p.status,now,now,p.postId,p.status).run();if(r.meta.changes)await notifyStatus(p.postId,p.status,actorId,now);return {ok:true,message:'Statut mis à jour.'};}
  case 'pin':await exists(p.postId);await db().prepare('UPDATE feedback_posts SET pinned=?,updated_at=? WHERE id=?').bind(p.pinned?1:0,now,p.postId).run();return {ok:true,message:p.pinned?'Suggestion épinglée.':'Suggestion désépinglée.'};
  case 'hide':await exists(p.postId);await db().prepare('UPDATE feedback_posts SET hidden_at=?,hidden_by=?,updated_at=? WHERE id=?').bind(p.hidden?now:null,p.hidden?actorId:null,now,p.postId).run();return {ok:true,message:p.hidden?'Suggestion masquée.':'Suggestion visible à nouveau.'};
  case 'team_reply':{await exists(p.postId);const body=rule(()=>validateComment(p.body));await db().prepare("INSERT INTO feedback_comments(id,post_id,author_id,author_name,body,is_team,created_at) VALUES (?,?,?,'Équipe Braand',?,1,?)").bind(uid(),p.postId,actorId,body,now).run();return {ok:true,message:'Réponse de l’équipe publiée.'};}
  case 'merge':await mergeDuplicate(p.sourceId,p.targetId,actorId,now);return {ok:true,message:'Doublon fusionné : ses votes ont rejoint l’originale.'};
  case 'hide_comment':{const r=await db().prepare('UPDATE feedback_comments SET hidden_at=?,hidden_by=? WHERE id=?').bind(p.hidden?now:null,p.hidden?actorId:null,p.commentId).run();if(!r.meta.changes)throw new AppError('Réponse introuvable.',404);return {ok:true,message:p.hidden?'Réponse masquée.':'Réponse visible à nouveau.'};}
  case 'pin_comment':{const r=await db().prepare('UPDATE feedback_comments SET pinned=? WHERE id=?').bind(p.pinned?1:0,p.commentId).run();if(!r.meta.changes)throw new AppError('Réponse introuvable.',404);return {ok:true,message:p.pinned?'Réponse épinglée.':'Réponse désépinglée.'};}
  case 'resolve_report':{const r=await db().prepare('UPDATE feedback_reports SET resolved_at=?,resolved_by=? WHERE id=? AND resolved_at IS NULL').bind(now,actorId,p.reportId).run();if(!r.meta.changes)throw new AppError('Signalement introuvable ou déjà traité.',404);return {ok:true,message:'Signalement traité.'};}
  case 'toggle_flag':await db().prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES ('feedback_enabled',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(p.enabled?'true':'false',now).run();return {ok:true,message:p.enabled?'Suggestions ouvertes à tous les membres.':'Suggestions fermées aux membres.'};
 }
}
export async function adminFeedbackOverview(){
 await ensureFeedbackSchema();
 const [posts,reports,counts]=await Promise.all([
  db().prepare('SELECT * FROM feedback_posts ORDER BY report_count DESC,last_activity_at DESC LIMIT 200').all<Post>(),
  db().prepare('SELECT r.id,r.post_id,r.comment_id,r.reason,r.created_at,p.title,c.body comment_body FROM feedback_reports r JOIN feedback_posts p ON p.id=r.post_id LEFT JOIN feedback_comments c ON c.id=r.comment_id WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 100').all<Record<string,unknown>>(),
  db().prepare('SELECT status,COUNT(*) n FROM feedback_posts GROUP BY status').all<{status:string;n:number}>(),
 ]);
 const team={userId:'team',team:true};
 return {enabled:await feedbackEnabled(),posts:posts.results.map(post=>toPublicPost(post,team)),reports:reports.results.map(r=>({id:String(r.id),postId:String(r.post_id),commentId:r.comment_id?String(r.comment_id):null,reason:String(r.reason||''),title:String(r.title),comment:r.comment_body?String(r.comment_body).slice(0,200):null,createdAt:Number(r.created_at)})),statusCounts:Object.fromEntries(counts.results.map(r=>[r.status,r.n]))};
}
