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

// Platform owner (verified account). Worker variables are full, so the owner
// is declared in code; OPS_ADMIN_IDS / BILLING_ADMIN_IDS still add admins.
export const PLATFORM_OWNER_IDS=['0301d63c-9f01-4181-bc06-1e1162d4908f'];
const DAY=86400000;

export function platformAdminIds(){const c=config();return new Set([...PLATFORM_OWNER_IDS,...[c.OPS_ADMIN_IDS,c.BILLING_ADMIN_IDS].flatMap(v=>(v||'').split(',')).map(v=>v.trim()).filter(Boolean)]);}
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
