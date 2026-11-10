// Braand administration: platform-wide figures and account controls.
// The administrator sees accounts, money, usage and health — never the
// content of conversations or files. Every action is validated, bounded and
// written to the audit log.
import {z} from 'zod';
import {AppError} from './core.mjs';
import {config,db,identity,uid} from './server';
import {releaseReadiness} from './billing';
import {modelReadiness} from './metering';
import {routingEnabled,routingReadiness} from './model-router';
import {APP_TRAFFIC_KEY} from './traffic-core.mjs';

export {PLATFORM_OWNER_IDS,platformAdminIds} from './platform-owners';
import {platformAdminIds} from './platform-owners';
const DAY=86400000;

export async function isPlatformAdmin(userId:string){return platformAdminIds().has(userId);}
export async function requirePlatformAdmin(request:Request){
 const who=await identity(request,'read');
 if(!platformAdminIds().has(who.user.userId))throw new AppError('Administration non autorisée.',403,'admin_forbidden');
 if(request.method!=='GET'&&request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('Origine non autorisée.',403);
 return who;
}

type Row=Record<string,unknown>;
const all=async<T=Row>(sql:string,...args:unknown[])=>(await db().prepare(sql).bind(...args).all<T>()).results;
const one=async<T=Row>(sql:string,...args:unknown[])=>await db().prepare(sql).bind(...args).first<T>();
const n=(value:unknown)=>Number(value)||0;
const credits=(units:unknown)=>Math.round(n(units))/100;

async function ensureBlocks(){await db().prepare('CREATE TABLE IF NOT EXISTS account_blocks(user_id TEXT PRIMARY KEY,reason TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL)').run();}
async function blockedIds(){try{return new Set((await all<{user_id:string}>('SELECT user_id FROM account_blocks')).map(r=>r.user_id));}catch{return new Set<string>();}}
export async function isAccountBlocked(userId:string){try{return !!(await one('SELECT 1 x FROM account_blocks WHERE user_id=?',userId));}catch{return false;}}

const PAID="('verified','fulfilled','paid','completed')";

/** Home: key figures, 30-day series and what needs attention. */
export async function adminOverview(now=Date.now()){
 const d7=now-7*DAY,d30=now-30*DAY,d1=now-DAY;
 const [users,active,runs,runs7,failed7,revenue,revenue30,lots,consumed,consumed30,ai30,aiAll,media30,alerts,refunds,failedOrders,failed24,blocked]=await Promise.all([
  one('SELECT COUNT(*) total,SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) new7,SUM(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END) verified FROM auth_users',d7),
  one('SELECT COUNT(DISTINCT workspace_id) n FROM runs WHERE created_at>?',d7),
  one('SELECT COUNT(*) n FROM runs'),one('SELECT COUNT(*) n FROM runs WHERE created_at>?',d7),
  one("SELECT COUNT(*) n FROM runs WHERE created_at>? AND status IN ('failed','error')",d7),
  one(`SELECT COALESCE(SUM(amount),0) xaf,COUNT(*) n FROM billing_orders WHERE status IN ${PAID}`),
  one(`SELECT COALESCE(SUM(amount),0) xaf FROM billing_orders WHERE status IN ${PAID} AND created_at>?`,d30),
  all('SELECT source,COALESCE(SUM(granted),0) granted,COALESCE(SUM(balance-reserved),0) remaining FROM credit_lots GROUP BY source'),
  one("SELECT COALESCE(SUM(actual),0) units FROM credit_holds WHERE status='settled'"),
  one("SELECT COALESCE(SUM(actual),0) units FROM credit_holds WHERE status='settled' AND created_at>?",d30),
  one("SELECT COALESCE(SUM(cost_xaf),0) xaf,COUNT(*) calls FROM provider_usage WHERE created_at>? AND status IN ('complete','estimated')",d30),
  one("SELECT COALESCE(SUM(cost_xaf),0) xaf FROM provider_usage WHERE status IN ('complete','estimated')"),
  one("SELECT COUNT(*) n,COALESCE(SUM(actual_units),0) units FROM agent_tool_usage WHERE created_at>?",d30),
  one("SELECT COUNT(*) n FROM operations_alerts WHERE status='open'").catch(()=>({n:0})),
  one("SELECT COUNT(*) n FROM billing_refunds WHERE status IN ('requested','pending','quoted','approved')"),
  one("SELECT COUNT(*) n FROM billing_orders WHERE status IN ('failed','expired') AND created_at>?",d7),
  one("SELECT COUNT(*) n FROM runs WHERE created_at>? AND status IN ('failed','error')",d1),
  blockedIds(),
 ]);
 const byDay=async(sql:string)=>Object.fromEntries((await all<{day:string;v:number}>(sql,d30)).map(r=>[r.day,n(r.v)]));
 const [signups,answers,cost,income]=await Promise.all([
  byDay("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) v FROM auth_users WHERE created_at>? GROUP BY day"),
  byDay("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) v FROM runs WHERE created_at>? GROUP BY day"),
  byDay("SELECT date(created_at/1000,'unixepoch') day,SUM(cost_xaf) v FROM provider_usage WHERE created_at>? AND status IN ('complete','estimated') GROUP BY day"),
  byDay(`SELECT date(created_at/1000,'unixepoch') day,SUM(amount) v FROM billing_orders WHERE created_at>? AND status IN ${PAID} GROUP BY day`),
 ]);
 const days=Array.from({length:30},(_,i)=>new Date(now-(29-i)*DAY).toISOString().slice(0,10));
 const granted=Object.fromEntries((lots as {source:string;granted:number;remaining:number}[]).map(l=>[l.source,{granted:credits(l.granted),remaining:credits(l.remaining)}]));
 const revenueAll=n(revenue?.xaf),costAll=n(aiAll?.xaf);
 return {
  generatedAt:now,
  users:{total:n(users?.total),new7:n(users?.new7),verified:n(users?.verified),active7:n(active?.n),blocked:blocked.size},
  answers:{total:n(runs?.n),last7:n(runs7?.n),failed7:n(failed7?.n),errorRate7:n(runs7?.n)?Math.round(n(failed7?.n)/n(runs7?.n)*1000)/10:0},
  money:{revenueXaf:revenueAll,revenue30Xaf:n(revenue30?.xaf),paidOrders:n(revenue?.n),aiCost30Xaf:Math.round(n(ai30?.xaf)),aiCostAllXaf:Math.round(costAll),aiCalls30:n(ai30?.calls),grossMarginXaf:Math.round(revenueAll-costAll)},
  credits:{bySource:granted,consumed:credits(consumed?.units),consumed30:credits(consumed30?.units)},
  media:{calls30:n(media30?.n),credits30:credits(media30?.units)},
  attention:{openAlerts:n((alerts as Row)?.n),pendingRefunds:n(refunds?.n),failedOrders7:n(failedOrders?.n),failedAnswers24:n(failed24?.n)},
  series:days.map(day=>({day,signups:signups[day]||0,answers:answers[day]||0,costXaf:Math.round(cost[day]||0),revenueXaf:income[day]||0})),
 };
}

/** Accounts with their key figures (no content). */
export async function adminUsers(query='',now=Date.now()){
 const q='%'+query.trim().toLowerCase().slice(0,80)+'%';
 const rows=await all<Row>(`SELECT u.id,u.email,u.created_at,u.verified_at,o.id organization_id,o.name organization,
  (SELECT COALESCE(SUM(CASE WHEN l.frozen=0 AND l.starts_at<=?1 AND (l.expires_at IS NULL OR l.expires_at>?1) THEN l.balance-l.reserved ELSE 0 END),0) FROM credit_lots l WHERE l.organization_id=o.id) available,
  (SELECT MAX(r.created_at) FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE w.organization_id=o.id) last_active,
  (SELECT COUNT(*) FROM runs r JOIN workspaces w ON w.id=r.workspace_id WHERE w.organization_id=o.id) answers,
  (SELECT COALESCE(SUM(cost_xaf),0) FROM provider_usage p WHERE p.organization_id=o.id) cost_xaf,
  (SELECT plan FROM billing_subscriptions s WHERE s.organization_id=o.id AND s.status='active' AND s.start_at<=?1 AND s.end_at>?1 ORDER BY s.end_at DESC LIMIT 1) plan
  FROM auth_users u LEFT JOIN organizations o ON o.owner_id=u.id WHERE lower(u.email) LIKE ?2 ORDER BY u.created_at DESC LIMIT 300`,now,q);
 const blocked=await blockedIds(),admins=platformAdminIds();
 return {users:rows.map(r=>({id:String(r.id),email:String(r.email),createdAt:n(r.created_at),verified:!!r.verified_at,organizationId:r.organization_id?String(r.organization_id):null,organization:r.organization?String(r.organization):null,credits:credits(r.available),lastActive:r.last_active?n(r.last_active):null,answers:n(r.answers),costXaf:Math.round(n(r.cost_xaf)),plan:r.plan?String(r.plan):null,blocked:blocked.has(String(r.id)),admin:admins.has(String(r.id))}))};
}

export async function adminUserDetail(userId:string,now=Date.now()){
 const user=await one<Row>('SELECT id,email,created_at,verified_at FROM auth_users WHERE id=?',userId);if(!user)throw new AppError('Compte introuvable.',404);
 const org=await one<Row>('SELECT id,name FROM organizations WHERE owner_id=?',userId);
 const orgId=org?String(org.id):'';
 const [lots,sessions,workspaces,orders,usage,members,block]=await Promise.all([
  all('SELECT id,source,granted,balance,reserved,frozen,starts_at,expires_at,created_at FROM credit_lots WHERE organization_id=? ORDER BY created_at DESC LIMIT 50',orgId),
  one('SELECT COUNT(*) n,MAX(created_at) last FROM auth_sessions WHERE user_id=? AND expires_at>?',userId,now),
  all('SELECT w.id,w.name,(SELECT COUNT(*) FROM runs r WHERE r.workspace_id=w.id) answers FROM workspaces w WHERE w.organization_id=?',orgId),
  all('SELECT id,status,amount,product,created_at FROM billing_orders WHERE organization_id=? ORDER BY created_at DESC LIMIT 20',orgId),
  all("SELECT json_extract(rate,'$.model') model,COUNT(*) calls,COALESCE(SUM(cost_xaf),0) xaf FROM provider_usage WHERE organization_id=? GROUP BY model ORDER BY xaf DESC",orgId),
  all('SELECT m.user_id,u.email,m.role,m.active,m.spend_limit FROM organization_members m LEFT JOIN auth_users u ON u.id=m.user_id WHERE m.organization_id=?',orgId),
  one('SELECT reason,created_at FROM account_blocks WHERE user_id=?',userId).catch(()=>null),
 ]);
 return {user:{id:String(user.id),email:String(user.email),createdAt:n(user.created_at),verified:!!user.verified_at},organization:org?{id:orgId,name:String(org.name)}:null,
  lots:(lots as Row[]).map(l=>({id:String(l.id),source:String(l.source),granted:credits(l.granted),balance:credits(n(l.balance)-n(l.reserved)),frozen:!!n(l.frozen),expiresAt:l.expires_at?n(l.expires_at):null,createdAt:n(l.created_at)})),
  sessions:{active:n(sessions?.n),last:sessions?.last?n(sessions.last):null},workspaces,orders,usage,members,blocked:block?{reason:String((block as Row).reason),since:n((block as Row).created_at)}:null};
}

async function audit(actor:string,action:string,target:string,detail:Record<string,unknown>){await db().prepare('INSERT INTO audit(id,workspace_id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?,?)').bind(uid(),'platform',actor,'admin.'+action,target,JSON.stringify(detail),Date.now()).run();}

export const adminActionInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('grant_credits'),userId:z.string().min(1).max(80),credits:z.number().positive().max(100000),reason:z.string().trim().min(3).max(300),expiresInDays:z.number().int().min(1).max(730).optional()}).strict(),
 z.object({action:z.literal('revoke_grant'),userId:z.string().min(1).max(80),lotId:z.string().min(1).max(200),reason:z.string().trim().min(3).max(300)}).strict(),
 z.object({action:z.literal('logout'),userId:z.string().min(1).max(80)}).strict(),
 z.object({action:z.literal('block'),userId:z.string().min(1).max(80),reason:z.string().trim().min(3).max(300)}).strict(),
 z.object({action:z.literal('unblock'),userId:z.string().min(1).max(80)}).strict(),
 z.object({action:z.literal('spend_limit'),userId:z.string().min(1).max(80),credits:z.number().min(0).max(1000000).nullable()}).strict(),
]);

export async function adminAction(actorId:string,raw:unknown){
 const p=adminActionInput.parse(raw),now=Date.now();
 const user=await one<Row>('SELECT id,email FROM auth_users WHERE id=?',p.userId);if(!user)throw new AppError('Compte introuvable.',404);
 const org=await one<Row>('SELECT id FROM organizations WHERE owner_id=?',p.userId);
 if(p.action==='grant_credits'){
  if(!org)throw new AppError('Ce compte n’a pas encore d’espace : il doit se connecter une première fois.',409,'organization_missing');
  const id='admin_grant:'+uid(),units=Math.round(p.credits*100),expires=p.expiresInDays?now+p.expiresInDays*DAY:null;
  await db().batch([
   db().prepare('INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,reserved,starts_at,expires_at,frozen,created_at) VALUES (?,?,?,?,?,?,0,?,?,0,?)').bind(id,org.id,'admin_grant',actorId,units,units,now,expires,now),
   db().prepare('INSERT INTO credit_ledger(id,organization_id,lot_id,kind,units,reference,created_at) VALUES (?,?,?,?,?,?,?)').bind(uid(),org.id,id,'grant',units,'admin:'+actorId,now),
  ]);
  await audit(actorId,'grant_credits',p.userId,{credits:p.credits,reason:p.reason,lotId:id,expiresAt:expires});
  return {ok:true,message:`${p.credits} crédits offerts à ${user.email}.`};
 }
 if(p.action==='revoke_grant'){
  const lot=await one<Row>("SELECT id,balance,reserved,organization_id FROM credit_lots WHERE id=? AND source='admin_grant'",p.lotId);
  if(!lot||lot.organization_id!==org?.id)throw new AppError('Seuls des crédits offerts depuis l’administration peuvent être retirés.',404);
  const free=n(lot.balance)-n(lot.reserved);if(free<=0)throw new AppError('Ces crédits ont déjà été utilisés.',409);
  await db().batch([
   db().prepare('UPDATE credit_lots SET balance=reserved WHERE id=? AND balance-reserved=?').bind(p.lotId,free),
   db().prepare('INSERT INTO credit_ledger(id,organization_id,lot_id,kind,units,reference,created_at) VALUES (?,?,?,?,?,?,?)').bind(uid(),lot.organization_id,p.lotId,'revoke',-free,'admin:'+actorId,now),
  ]);
  await audit(actorId,'revoke_grant',p.userId,{lotId:p.lotId,credits:free/100,reason:p.reason});
  return {ok:true,message:`${free/100} crédits non utilisés retirés.`};
 }
 if(p.action==='logout'){
  await db().prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(p.userId).run();
  await audit(actorId,'logout',p.userId,{});return {ok:true,message:'Toutes les sessions de ce compte sont fermées.'};
 }
 if(p.action==='block'){
  if(platformAdminIds().has(p.userId))throw new AppError('Un compte administrateur ne peut pas être suspendu ici.',409);
  await ensureBlocks();
  await db().batch([db().prepare('INSERT OR REPLACE INTO account_blocks(user_id,reason,created_by,created_at) VALUES (?,?,?,?)').bind(p.userId,p.reason,actorId,now),db().prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(p.userId)]);
  await audit(actorId,'block',p.userId,{reason:p.reason});return {ok:true,message:'Compte suspendu : il ne peut plus se connecter.'};
 }
 if(p.action==='unblock'){
  await ensureBlocks();await db().prepare('DELETE FROM account_blocks WHERE user_id=?').bind(p.userId).run();
  await audit(actorId,'unblock',p.userId,{});return {ok:true,message:'Compte réactivé.'};
 }
 if(!org)throw new AppError('Ce compte n’a pas encore d’espace.',409);
 await db().prepare('UPDATE organization_members SET spend_limit=? WHERE organization_id=? AND user_id=?').bind(p.credits===null?null:Math.round(p.credits*100),org.id,p.userId).run();
 await audit(actorId,'spend_limit',p.userId,{credits:p.credits});
 return {ok:true,message:p.credits===null?'Limite de dépense retirée.':`Limite de dépense fixée à ${p.credits} crédits.`};
}

/** Money: orders, subscriptions, refunds, credit lots and ledger movements. */
export async function adminFinance(){
 const [orders,subscriptions,refunds,lots,ledger,statuses]=await Promise.all([
  all('SELECT o.id,o.status,o.amount,o.product,o.created_at,u.email FROM billing_orders o LEFT JOIN organizations g ON g.id=o.organization_id LEFT JOIN auth_users u ON u.id=g.owner_id ORDER BY o.created_at DESC LIMIT 100'),
  all('SELECT s.id,s.plan,s.cycle,s.status,s.start_at,s.end_at,s.contract_price,u.email FROM billing_subscriptions s LEFT JOIN organizations g ON g.id=s.organization_id LEFT JOIN auth_users u ON u.id=g.owner_id ORDER BY s.start_at DESC LIMIT 100'),
  all('SELECT r.id,r.status,r.amount,r.reason,r.created_at,u.email FROM billing_refunds r LEFT JOIN organizations g ON g.id=r.organization_id LEFT JOIN auth_users u ON u.id=g.owner_id ORDER BY r.created_at DESC LIMIT 100'),
  all('SELECT source,COUNT(*) lots,COALESCE(SUM(granted),0) granted,COALESCE(SUM(balance-reserved),0) remaining FROM credit_lots GROUP BY source ORDER BY granted DESC'),
  all('SELECT l.kind,l.units,l.created_at,u.email FROM credit_ledger l LEFT JOIN organizations g ON g.id=l.organization_id LEFT JOIN auth_users u ON u.id=g.owner_id ORDER BY l.created_at DESC LIMIT 100'),
  all('SELECT status,COUNT(*) n,COALESCE(SUM(amount),0) xaf FROM billing_orders GROUP BY status'),
 ]);
 return {orders,subscriptions,refunds,ordersByStatus:statuses,lots:(lots as Row[]).map(l=>({source:String(l.source),lots:n(l.lots),granted:credits(l.granted),remaining:credits(l.remaining)})),ledger:(ledger as Row[]).map(l=>({kind:String(l.kind),credits:credits(l.units),createdAt:n(l.created_at),email:l.email?String(l.email):null})),readiness:releaseReadiness()};
}

/** AI: calls and cost by model, adaptive brain split, rejections. */
export async function adminAi(days=30,now=Date.now()){
 const since=now-days*DAY;
 const [byModel,byDay,status,runs]=await Promise.all([
  all("SELECT json_extract(rate,'$.model') model,COUNT(*) calls,COALESCE(SUM(cost_xaf),0) xaf,COALESCE(AVG(cost_xaf),0) avg FROM provider_usage WHERE created_at>? GROUP BY model ORDER BY calls DESC",since),
  all("SELECT date(created_at/1000,'unixepoch') day,json_extract(rate,'$.model') model,COUNT(*) calls,COALESCE(SUM(cost_xaf),0) xaf FROM provider_usage WHERE created_at>? GROUP BY day,model ORDER BY day",since),
  all('SELECT status,COUNT(*) n FROM provider_usage WHERE created_at>? GROUP BY status',since),
  one('SELECT COUNT(*) n FROM runs WHERE created_at>?',since),
 ]);
 // Why the brain moved up (or fell back), and how many delivered files passed their check.
 const [upgrades,fallbacks,fileChecks]=await Promise.all([
  all("SELECT json_extract(detail,'$.reason') reason,json_extract(detail,'$.tier') tier,COUNT(*) n FROM audit WHERE action='model.capacity' AND created_at>? GROUP BY reason,tier ORDER BY n DESC",since),
  all("SELECT json_extract(detail,'$.code') code,COUNT(*) n FROM audit WHERE action='model.capacity_fallback' AND created_at>? GROUP BY code ORDER BY n DESC",since),
  one("SELECT SUM(CASE WHEN action LIKE 'tool_failed.%' AND json_extract(detail,'$.code')='file_check_failed' THEN 1 ELSE 0 END) refused,SUM(CASE WHEN json_extract(detail,'$.check') IS NOT NULL THEN 1 ELSE 0 END) passed FROM audit WHERE created_at>? AND (action LIKE 'tool_failed.%' OR json_extract(detail,'$.check') IS NOT NULL)",since),
 ]);
 const total=(byModel as Row[]).reduce((s,r)=>s+n(r.xaf),0);
 const readiness=(()=>{try{return {model:modelReadiness(),routing:routingEnabled(config())?routingReadiness(config()):{enabled:false}};}catch{return {model:{ready:false},routing:{enabled:false}};}})();
 return {days,byModel:(byModel as Row[]).map(r=>({model:String(r.model||'inconnu'),calls:n(r.calls),costXaf:Math.round(n(r.xaf)*100)/100,avgXaf:Math.round(n(r.avg)*100)/100})),byDay,status,answers:n(runs?.n),costXaf:Math.round(total*100)/100,costPerAnswerXaf:n(runs?.n)?Math.round(total/n(runs?.n)*100)/100:0,readiness,upgrades:(upgrades as Row[]).map(r=>({reason:String(r.reason||'inconnu'),tier:String(r.tier||''),count:n(r.n)})),fallbacks:(fallbacks as Row[]).map(r=>({code:String(r.code||'inconnu'),count:n(r.n)})),fileChecks:{passed:n(fileChecks?.passed),refused:n(fileChecks?.refused)}};
}

/** Media and paid tools: generations by provider/operation and status. */
export async function adminMedia(days=30,now=Date.now()){
 const since=now-days*DAY;
 const [byOperation,byStatus,proposals]=await Promise.all([
  all('SELECT provider,operation,COUNT(*) n,COALESCE(SUM(actual_units),0) units FROM agent_tool_usage WHERE created_at>? GROUP BY provider,operation ORDER BY n DESC LIMIT 50',since),
  all('SELECT status,COUNT(*) n FROM agent_tool_usage WHERE created_at>? GROUP BY status',since),
  all("SELECT json_extract(data,'$.kind') kind,status,COUNT(*) n FROM resources WHERE kind='proposal' AND created_at>? GROUP BY kind,status ORDER BY n DESC",since),
 ]);
 return {days,byOperation:(byOperation as Row[]).map(r=>({provider:String(r.provider),operation:String(r.operation),count:n(r.n),credits:credits(r.units)})),byStatus,proposals,falReady:!!config().FAL_KEY};
}

/** Audit trail: platform, workspace and billing actions (metadata only). */
export async function adminAudit(filter=''){
 const like='%'+filter.trim().slice(0,60)+'%';
 const [general,billing]=await Promise.all([
  all('SELECT a.id,a.actor,a.action,a.target,a.detail,a.created_at,u.email FROM audit a LEFT JOIN auth_users u ON u.id=a.actor WHERE a.action LIKE ? ORDER BY a.created_at DESC LIMIT 200',like),
  all('SELECT b.id,b.actor,b.action,b.target,b.detail,b.created_at,u.email FROM billing_audit b LEFT JOIN auth_users u ON u.id=b.actor WHERE b.action LIKE ? ORDER BY b.created_at DESC LIMIT 100',like),
 ]);
 const safeDetail=(value:unknown)=>{try{const d=JSON.parse(String(value||'{}'));return Object.fromEntries(Object.entries(d).filter(([k])=>!/token|secret|password|content|text|prompt/i.test(k)).slice(0,8));}catch{return {};}};
 return {entries:[...(general as Row[]).map(r=>({...r,source:'espace'})),...(billing as Row[]).map(r=>({...r,source:'facturation'}))].map((r:Row)=>({id:String(r.id),source:String(r.source),actor:r.email?String(r.email):String(r.actor),action:String(r.action),target:String(r.target),detail:safeDetail(r.detail),createdAt:n(r.created_at)})).sort((a,b)=>b.createdAt-a.createdAt).slice(0,250)};
}

/** Service status as yes/no flags, never a secret value. */
export function adminServices(){
 const c=config(),env=c as unknown as Record<string,unknown>;
 const has=(key:string)=>!!env[key];
 return {
  model:has('OPENROUTER_API_KEY')||has('ANTHROPIC_API_KEY'),adaptiveBrain:routingEnabled(c),media:has('FAL_KEY'),browser:has('BROWSER'),
  payments:releaseReadiness().enabled,backups:c.BACKUP_ENABLED==='true',connectors:has('COMPOSIO_API_KEY'),email:has('RESEND_API_KEY')||has('EMAIL_API_KEY'),
  storage:has('BUCKET'),workQueue:has('WORK_QUEUE'),codeSandbox:has('CODE_SANDBOX'),
 };
}

/** Websites and plans: what is online, for whom, and the plan catalogue with live subscriptions. Never site content. */
export async function adminSites(now=Date.now()){
 const {SITES_SCHEMA}=await import('./site-files.mjs');const {PLANS,PLAN_ORDER}=await import('./billing-core.mjs');
 await db().batch(SITES_SCHEMA.map(sql=>db().prepare(sql)));
 const since=now-30*DAY;
 const [origin,drafts,byStatus,sites,leads,subscriptions]=await Promise.all([
  one<{value:string}>("SELECT value FROM platform_settings WHERE key='sites_origin'"),
  one("SELECT COUNT(*) n FROM resources WHERE kind='site' AND status!='deleted'"),
  all('SELECT status,COUNT(*) n FROM site_publications GROUP BY status'),
  all("SELECT p.resource_id id,p.slug,p.status,p.badge,p.approved_at,p.updated_at,r.title,u.email,(SELECT COUNT(*) FROM site_leads l WHERE l.publication_id=p.id) leads FROM site_publications p LEFT JOIN resources r ON r.id=p.resource_id LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN auth_users u ON u.id=o.owner_id ORDER BY p.updated_at DESC LIMIT 100"),
  one('SELECT COUNT(*) n FROM site_leads WHERE created_at>?',since),
  all("SELECT plan,COUNT(*) n FROM billing_subscriptions WHERE status='active' AND start_at<=?1 AND end_at>?1 GROUP BY plan",now),
 ]);
 const active=new Map((subscriptions as Row[]).map(r=>[String(r.plan),n(r.n)]));
 return {
  origin:origin?.value||null,drafts:n(drafts?.n),byStatus,leads30d:n(leads?.n),
  sites:(sites as Row[]).map(r=>({id:String(r.id),slug:String(r.slug),title:String(r.title||r.slug),status:String(r.status),badge:!!r.badge,owner:r.email?String(r.email):null,leads:n(r.leads),publishedAt:r.approved_at?n(r.approved_at):null,updatedAt:n(r.updated_at),url:origin?.value?`${origin.value}/${r.slug}/`:null})),
  plans:PLAN_ORDER.map(id=>{const p=PLANS[id as keyof typeof PLANS];return {id,name:p.name,periodPrice:p.periodPrice,annualPrice:p.annualPrice,credits:p.credits,members:p.members,spaces:p.spaces,projects:p.projects,storageGb:p.storage/1024**3,concurrency:p.concurrency,sites:p.sites,activeSubscriptions:active.get(id)||0};}),
 };
}
const siteActionInput=z.object({action:z.literal('suspend_site'),siteId:z.string().min(1).max(80),reason:z.string().trim().min(3).max(300)}).strict();
/** Takes a published site offline (abuse, complaint). The owner keeps the draft and can republish after review. */
export async function adminSiteAction(actorId:string,raw:unknown){
 const p=siteActionInput.parse(raw);
 const row=await one<Row>("SELECT id,slug,workspace_id FROM site_publications WHERE resource_id=?",p.siteId);if(!row)throw new AppError('Site introuvable.',404);
 await db().prepare("UPDATE site_publications SET status='suspended',updated_at=? WHERE resource_id=?").bind(Date.now(),p.siteId).run();
 await audit(actorId,'suspend_site',p.siteId,{slug:row.slug,reason:p.reason});
 return {ok:true,message:`Le site ${row.slug} n’est plus en ligne.`};
}

// ——— Operations health, decisions waiting and why answers stop ———

const BACKUP_STALE_MS = 26 * 3600 * 1000;
/** Last successful backup, today's job and a single healthy / not healthy verdict. */
export async function adminBackupHealth(now = Date.now()) {
 const today = 'backup:' + new Date(now).toISOString().slice(0, 10).replaceAll('-', '');
 const [last, job] = await Promise.all([
  one<{created_at: number; bytes: number; tables_count: number; rows_count: number; objects_count: number}>("SELECT created_at,bytes,tables_count,rows_count,objects_count FROM operations_backups WHERE status='completed' ORDER BY created_at DESC LIMIT 1").catch(() => null),
  one<{status: string; error_code: string | null; updated_at: number}>('SELECT status,error_code,updated_at FROM operations_jobs WHERE id=?', today).catch(() => null),
 ]);
 const age = last ? now - n(last.created_at) : null;
 const jobBad = !!job && ['uncertain', 'failed'].includes(job.status);
 return {
  healthy: age !== null && age <= BACKUP_STALE_MS && !jobBad,
  lastSuccessAt: last?.created_at ?? null, ageHours: age === null ? null : Math.round(age / 3600000),
  bytes: n(last?.bytes), tables: n(last?.tables_count), rows: n(last?.rows_count), objects: n(last?.objects_count),
  today: job ? {status: job.status, errorCode: job.error_code, updatedAt: job.updated_at} : null,
 };
}

export const resolveAlertInput = z.object({action: z.literal('resolve_alert'), id: z.string().min(1).max(200)}).strict();
/** An administrator marks an alert handled; written to the audit log. */
export async function adminResolveAlert(actorId: string, raw: unknown) {
 const p = resolveAlertInput.parse(raw);
 const alert = await one<{id: string; category: string; status: string}>('SELECT id,category,status FROM operations_alerts WHERE id=?', p.id);
 if (!alert) throw new AppError('Alerte introuvable.', 404);
 if (alert.status === 'resolved') return {ok: true, message: 'Cette alerte était déjà résolue.'};
 await db().prepare("UPDATE operations_alerts SET status='resolved' WHERE id=? AND status='open'").bind(p.id).run();
 await audit(actorId, 'resolve_alert', p.id, {category: alert.category});
 return {ok: true, message: 'Alerte marquée comme résolue.'};
}

const PENDING_KINDS: {kind: string; label: string; sql: string}[] = [
 {kind: 'connector_action', label: 'Actions sur une application', sql: "SELECT workspace_id,created_at FROM resources WHERE kind='connector_action' AND status='pending'"},
 {kind: 'proposal', label: 'Créations média', sql: "SELECT workspace_id,created_at FROM resources WHERE kind='proposal' AND status='awaiting_approval'"},
 {kind: 'social_batch', label: 'Publications à programmer', sql: "SELECT b.workspace_id,MIN(p.created_at) created_at FROM social_batches b JOIN social_posts p ON p.batch_id=b.id AND p.status='draft' GROUP BY b.id"},
 {kind: 'social_reply', label: 'Réponses aux commentaires', sql: "SELECT workspace_id,updated_at created_at FROM social_replies WHERE status='draft'"},
 {kind: 'browser_session', label: 'Étapes du navigateur', sql: "SELECT workspace_id,updated_at created_at FROM browser_sessions WHERE status='awaiting_approval'"},
];
/** Every approval waiting on the platform: counts, age and account — never the content. */
export async function adminPendingDecisions(now = Date.now()) {
 const rows = (await Promise.all(PENDING_KINDS.map(async kind => (await all<{workspace_id: string; created_at: number}>(kind.sql).catch(() => [])).map(row => ({kind: kind.kind, label: kind.label, workspaceId: row.workspace_id, since: n(row.created_at)}))))).flat();
 const ids = [...new Set(rows.map(row => row.workspaceId))], owners = new Map<string, string | null>();
 for (let i = 0; i < ids.length; i += 90) { // D1 binds at most 100 parameters per query
  const part = ids.slice(i, i + 90);
  for (const row of await all<{id: string; email: string | null}>('SELECT w.id,u.email FROM workspaces w JOIN organizations o ON o.id=w.organization_id LEFT JOIN auth_users u ON u.id=o.owner_id WHERE w.id IN (' + part.map(() => '?').join(',') + ')', ...part).catch(() => [])) owners.set(row.id, row.email);
 }
 const byKind = PENDING_KINDS.map(kind => {const list = rows.filter(row => row.kind === kind.kind);return {kind: kind.kind, label: kind.label, count: list.length, oldest: list.length ? Math.min(...list.map(row => row.since)) : null};});
 return {
  total: rows.length, stale: rows.filter(row => now - row.since > DAY).length, byKind,
  items: rows.sort((a, b) => a.since - b.since).slice(0, 50).map(row => ({kind: row.kind, label: row.label, account: owners.get(row.workspaceId) || 'Espace sans propriétaire connu', since: row.since, stale: now - row.since > DAY})),
 };
}

const STOP_CATEGORIES: [RegExp, string][] = [[/solde|portefeuille|crédits? (?:disponible|insuffisant)/i, 'Solde insuffisant'], [/limite temporaire|surcharg|indisponible/i, 'Fournisseur saturé'], [/interrompu|coupure|réseau/i, 'Coupure'], [/budget prévu|plafond/i, 'Budget du message'], [/arrêt|annul/i, 'Arrêt demandé']];
/** Why answers stopped in the last days: system messages grouped (numbers hidden), never user content. */
export async function adminStopReasons(days = 7, now = Date.now()) {
 const rows = await all<{status: string; error: string | null; created_at: number}>("SELECT status,error,created_at FROM runs WHERE created_at>? AND status IN ('failed','partial','cancelled','error')", now - days * DAY).catch(() => []);
 const groups = new Map<string, {reason: string; category: string; count: number; last: number}>();
 for (const row of rows) {
  const reason = (row.error || (row.status === 'cancelled' ? 'Arrêtée à la demande de l’utilisateur' : 'Sans message')).replace(/\d+(?:[.,]\d+)?/g, '#').slice(0, 160);
  const category = STOP_CATEGORIES.find(([pattern]) => pattern.test(reason))?.[1] || 'Autre';
  const group = groups.get(reason) || {reason, category, count: 0, last: 0};
  group.count++; group.last = Math.max(group.last, n(row.created_at)); groups.set(reason, group);
 }
 return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20);
}

// ——— Traffic measured by Braand (daily totals, no IP, no content) ———

const TRAFFIC_TABLES = ["CREATE TABLE IF NOT EXISTS traffic_daily(day TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,dim TEXT NOT NULL,value TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,scope,key,dim,value))"];
/** Visits of braand.fun, of the published sites and API health over 7, 30 or 90 days, compared with the period before. */
export async function adminTraffic(rawDays: unknown, now = Date.now()) {
 const days = [7, 30, 90].includes(Number(rawDays)) ? Number(rawDays) : 30;
 await db().batch(TRAFFIC_TABLES.map(sql => db().prepare(sql))).catch(() => undefined);
 const dayOf = (offset: number) => new Date(now - offset * DAY).toISOString().slice(0, 10);
 const from = dayOf(days - 1), previous = dayOf(2 * days - 1), to = dayOf(0);
 const calendar = Array.from({length: days}, (_, i) => dayOf(days - 1 - i));
 type T = {day: string; scope: string; key: string; dim: string; value: string; n: number};
 const rows = await all<T>('SELECT day,scope,key,dim,value,n FROM traffic_daily WHERE day>=? AND day<=?', previous, to).catch(() => [] as T[]);
 const measuredRows=rows.filter(r=>r.scope!=='app'||r.key===APP_TRAFFIC_KEY);
 const publicRows=measuredRows.filter(r=>r.scope==='app');
 const since=publicRows.length?publicRows.reduce((a,r)=>r.day<a?r.day:a,to):null;
 const previousCovered=since!==null&&since<=previous;
 const observedFrom=since&&since>from?since:from;
 const cur = measuredRows.filter(r => r.day >= from), prev = measuredRows.filter(r => r.day < from);
 const sum = (list: T[], scope: string, dim: string, key?: string) => list.filter(r => r.scope === scope && r.dim === dim && (key === undefined || r.key === key)).reduce((a, r) => a + n(r.n), 0);
 const top = (list: T[], scope: string, dim: string, limit = 10) => {const m = new Map<string, number>();for (const r of list) if (r.scope === scope && r.dim === dim) m.set(r.value, (m.get(r.value) || 0) + n(r.n));return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, count]) => ({label, count}));};
 const perDay = (scope: string, dim: string, value?: string) => {const m = new Map<string, number>();for (const r of cur) if (r.scope === scope && r.dim === dim && (value === undefined || r.value === value)) m.set(r.day, (m.get(r.day) || 0) + n(r.n));return m;};
 const change = (a: number, b: number) => b ? Math.round((a - b) / b * 1000) / 10 : null;
 // Signup events use the very same public measurement/version as visits. No
 // all-time account count, admin users or pre-instrumentation registrations.
 const signupByDay = perDay('app','signups');
 // braand.fun
 const views = sum(cur, 'app', 'views'), visitors = sum(cur, 'app', 'visitors'), bots = sum(cur, 'app', 'bot'), newUsers = sum(cur,'app','signups');
 const appViews = perDay('app', 'views'), appVisitors = perDay('app', 'visitors');
 // Published sites, with their owner (never their content)
 const siteKeys = [...new Set(cur.filter(r => r.scope === 'site').map(r => r.key))];
 const owners = new Map<string, string | null>();
 for (let i = 0; i < siteKeys.length; i += 90) {
  const part = siteKeys.slice(i, i + 90);
  for (const row of await all<{slug: string; email: string | null}>('SELECT p.slug,u.email FROM site_publications p LEFT JOIN organizations o ON o.id=p.organization_id LEFT JOIN auth_users u ON u.id=o.owner_id WHERE p.slug IN (' + part.map(() => '?').join(',') + ')', ...part).catch(() => [])) owners.set(row.slug, row.email);
 }
 const sites = siteKeys.map(slug => ({slug, owner: owners.get(slug) || null, views: sum(cur, 'site', 'views', slug), visitors: sum(cur, 'site', 'visitors', slug), lastDay: cur.filter(r => r.scope === 'site' && r.key === slug && r.dim === 'views').reduce((a, r) => r.day > a ? r.day : a, '')})).sort((a, b) => b.views - a.views);
 const siteViews = perDay('site', 'views');
 // API health
 const requests = sum(cur, 'api', 'requests'), status = (cls: string, list = cur) => list.filter(r => r.scope === 'api' && r.dim === 'status' && r.value === cls).reduce((a, r) => a + n(r.n), 0);
 const errors5 = status('5xx'), errors4 = status('4xx'), requestsBefore = sum(prev, 'api', 'requests');
 const apiByDay = perDay('api', 'requests'), api5ByDay = perDay('api', 'status', '5xx');
 const routes = [...new Set(cur.filter(r => r.scope === 'api').map(r => r.key))].map(key => {
  const count = sum(cur, 'api', 'requests', key), slow = cur.filter(r => r.scope === 'api' && r.key === key && r.dim === 'latency' && ['< 10 s', '≥ 10 s'].includes(r.value)).reduce((a, r) => a + n(r.n), 0);
  const failed = cur.filter(r => r.scope === 'api' && r.key === key && r.dim === 'status' && r.value === '5xx').reduce((a, r) => a + n(r.n), 0);
  return {route: key, requests: count, errorRate: count ? Math.round(failed / count * 1000) / 10 : 0, averageMs: count ? Math.round(sum(cur, 'api', 'ms_total', key) / count) : 0, slowRate: count ? Math.round(slow / count * 1000) / 10 : 0};
 }).sort((a, b) => b.requests - a.requests).slice(0, 30);
 return {
  days, from, to, since, observedFrom, measurement:APP_TRAFFIC_KEY,generatedAt: now,
  app: {
   views, visitors, bots, signups: newUsers, conversion: visitors ? Math.round(newUsers / visitors * 1000) / 10 : null,
   change: {views: previousCovered?change(views, sum(prev, 'app', 'views')):null, visitors: previousCovered?change(visitors, sum(prev, 'app', 'visitors')):null, signups: previousCovered?change(newUsers, sum(prev,'app','signups')):null},
   series: calendar.map(day => ({day, views: appViews.get(day) || 0, visitors: appVisitors.get(day) || 0, signups: signupByDay.get(day) || 0})),
   pages: top(cur, 'app', 'page'), sources: top(cur, 'app', 'source'), countries: top(cur, 'app', 'country'), devices: top(cur, 'app', 'device', 3),
  },
  sites: {views: sum(cur, 'site', 'views'), visitors: sum(cur, 'site', 'visitors'), count: sites.length, list: sites.slice(0, 50), series: calendar.map(day => ({day, views: siteViews.get(day) || 0}))},
  api: {
   requests, errors5, errors4, errorRate5: requests ? Math.round(errors5 / requests * 1000) / 10 : 0, errorRate4: requests ? Math.round(errors4 / requests * 1000) / 10 : 0, change: change(requests, requestsBefore),
   series: calendar.map(day => ({day, requests: apiByDay.get(day) || 0, errors: api5ByDay.get(day) || 0})), routes,
  },
 };
}
