import {config, db, uid, identity} from './server';
import {AppError} from './core.mjs';
import {enqueueOperationalNotification, dispatchOperationalNotifications, emailReadiness,enqueueQualityReport} from './notifications';
import {createEncryptedBackup, backupReadiness} from './backups';
import {browserCleanup} from './browser';
import {browserRPCCleanup} from './browser-runtime';
import {ensureModelPricing} from './model-pricing';
import {reconcileOpenRouterUsage} from './metering';

const encoder = new TextEncoder();
const reference = (value: string) => /^[a-zA-Z0-9:_-]{1,180}$/.test(value);

// Fixed-size digest comparison: no early-exit string comparison of the scheduler secret.
export async function requireOperationsScheduler(request: Request) {
  const secret = config().SCHEDULER_SECRET;
  if (!secret || secret.length < 32 || secret.length > 512) throw new AppError('Secret du planificateur à configurer.',503,'scheduler_configuration_missing');
  const provided = request.headers.get('authorization') || '';
  if (provided.length > 520) throw new AppError('Accès réservé au planificateur.',401);
  const [expected, actual] = await Promise.all(['Bearer ' + secret,provided].map(async value => new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))));
  let difference = 0;
  for (let index=0;index<expected.length;index++) difference |= expected[index] ^ actual[index];
  if (difference !== 0) throw new AppError('Accès réservé au planificateur.',401);
}
export async function requireOperationsAdmin(request: Request) {
  const who = await identity(request);
  const administrators = (config().OPS_ADMIN_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!administrators.includes(who.user.userId)) throw new AppError('Administration non autorisée.',403);
  return who;
}
export async function raiseOperationalAlert(id: string, category: string, target: string, now = Date.now()) {
  if (![id,category,target].every(reference)) throw new AppError('Référence d’alerte invalide.',400);
  await db().prepare("INSERT OR IGNORE INTO operations_alerts(id,category,target,first_seen_at,last_seen_at) VALUES (?,?,?,?,?)").bind(id,category,target,now,now).run();
  await db().prepare('UPDATE operations_alerts SET last_seen_at=?,observations=observations+1 WHERE id=?').bind(now,id).run();
  // Stable outbox key survives a crash between inserting an alert and queueing its email.
  // An email outage must not recursively generate an email about its own failed alert.
  if (category !== 'email_delivery_unknown') await enqueueOperationalNotification(id,{category,target},now);
  return {id};
}
export async function runTrackedJob(name: string, id: string, work: () => Promise<unknown>, now = Date.now()) {
  if (!reference(name) || !reference(id)) throw new AppError('Référence de tâche invalide.',400);
  await db().prepare("INSERT OR IGNORE INTO operations_jobs(id,name,status,created_at,updated_at) VALUES (?,?,'pending',?,?)").bind(id,name,now,now).run();
  // Unknown execution is not retried: financial/external work may already have completed.
  await db().prepare("UPDATE operations_jobs SET status='uncertain',error_code='job_interrupted',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND status='running' AND lease_until<=?").bind(now,id,now).run();
  const token = uid(), lock = await db().prepare("UPDATE operations_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND status='pending'").bind(token,now+120000,now,id).run();
  if (!lock.meta.changes) {
    const row = await db().prepare('SELECT status,error_code FROM operations_jobs WHERE id=?').bind(id).first<{status:string;error_code:string|null}>();
    if (row?.status === 'uncertain') await raiseOperationalAlert('job:' + id,'job_interrupted',id,now);
    return {id,status:row?.status || 'uncertain',replayed:true};
  }
  try {
    await work();
    await db().prepare("UPDATE operations_jobs SET status='completed',result='{}',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=? AND status='running'").bind(Date.now(),id,token).run();
    return {id,status:'completed',replayed:false};
  } catch (error) {
    const blocked = error instanceof AppError && error.status === 503;
    await db().prepare('UPDATE operations_jobs SET status=?,error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?')
      .bind(blocked?'blocked':'failed',blocked?'job_configuration_missing':'job_failed',Date.now(),id,token).run();
    await raiseOperationalAlert('job:' + id,blocked?'job_blocked':'job_failed',id,now);
    return {id,status:blocked?'blocked':'failed',replayed:false};
  }
}

export async function scanOperationalIncidents(now = Date.now()) {
  // Periodic jobs use a fresh slot ID. Recover all expired leases, not just the
  // current slot, and retain uncertainty instead of replaying external effects.
  await db().prepare("UPDATE operations_jobs SET status='uncertain',error_code='job_interrupted',lease_token=NULL,lease_until=0,updated_at=? WHERE status='running' AND lease_until<=?").bind(now,now).run();
  const checks = [
    {category:'payment_event_failed',query:"SELECT id FROM billing_events WHERE status='dead' ORDER BY created_at LIMIT 50",args:[]},
    {category:'provider_cost_unknown',query:"SELECT id FROM provider_usage WHERE status IN ('unknown','pending') AND created_at<? ORDER BY created_at LIMIT 50",args:[now-3600000]},
    {category:'provider_cost_unknown',query:"SELECT 'hold:'||id id FROM credit_holds WHERE status='needs_reconciliation' AND created_at<? ORDER BY created_at LIMIT 50",args:[now-3600000]},
    {category:'job_interrupted',query:"SELECT id FROM operations_jobs WHERE status='uncertain' ORDER BY updated_at LIMIT 50",args:[]},
    {category:'job_interrupted',query:"SELECT 'work:'||id id FROM agent_work WHERE status='needs_reconciliation' ORDER BY updated_at LIMIT 50",args:[]},
    {category:'job_interrupted',query:"SELECT 'work-outbox:'||id id FROM agent_work_outbox WHERE status='failed' ORDER BY created_at LIMIT 50",args:[]},
    {category:'job_interrupted',query:"SELECT 'social:'||id id FROM social_posts WHERE status='uncertain' ORDER BY updated_at LIMIT 50",args:[]},
    {category:'provider_cost_unknown',query:"SELECT 'tool:'||id id FROM agent_tool_usage WHERE status IN ('unknown','pending') AND created_at<? ORDER BY created_at LIMIT 50",args:[now-3600000]},
    {category:'email_delivery_unknown',query:"SELECT id FROM notification_outbox WHERE status IN ('uncertain','failed') ORDER BY created_at LIMIT 50",args:[]},
  ];
  let observed = 0;
  for (const check of checks) {
    const result = await db().prepare(check.query).bind(...check.args).all<{id:string}>();
    for (const row of result.results) {
      // The identifier enters notifications, never a supplier payload, key, address or error body.
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(row.id)))).map(value => value.toString(16).padStart(2,'0')).join('');
      await raiseOperationalAlert(check.category + ':' + hash,check.category,hash,now); observed++;
    }
  }
  return {observed};
}
export async function runOperationsTick(now = Date.now()) {
  const slot = Math.floor(now / 300000);
  const pricing=config().MODEL_PRICING_REFRESH_JSON?await runTrackedJob('model_pricing','model_pricing:'+slot,()=>ensureModelPricing(now),now):{status:'disabled'};
  const usage=await runTrackedJob('model_usage','model_usage:'+slot,()=>reconcileOpenRouterUsage(undefined,10),now);
  const monitor = await runTrackedJob('monitor','monitor:' + slot,() => scanOperationalIncidents(now),now);
  const browser = await runTrackedJob('browser_cleanup','browser_cleanup:' + slot,async() => {await browserCleanup(now);await browserRPCCleanup(now);},now);
  let backup: {id?:string;status:string;replayed?:boolean} = {status:'disabled'};
  if (config().BACKUP_ENABLED === 'true') backup = await runTrackedJob('backup','backup:' + new Date(now).toISOString().slice(0,10).replaceAll('-',''),() => createEncryptedBackup(now),now);
  // Weekly agent quality report, Mondays from 06:00 UTC, once per ISO week.
  let quality: {status:string;replayed?:boolean} = {status:'skipped'};
  const date = new Date(now);
  if (date.getUTCDay() === 1 && date.getUTCHours() >= 6) {
    const week = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())).toISOString().slice(0,10).replaceAll('-','');
    quality = await runTrackedJob('quality_report','quality:' + week,async() => {const {agentQualityReport,qualitySummaryText}=await import('./agent-quality');const report=await agentQualityReport(7,now);await enqueueQualityReport('quality:' + week,qualitySummaryText(report),now);return {total:report.total};},now) as {status:string};
  }
  const notifications = await dispatchOperationalNotifications(10,now);
  return {monitor,backup,notifications,browser,pricing,usage,quality};
}
export async function operationsSummary() {
  const [jobs,alerts,notifications,backups] = await Promise.all([
    db().prepare('SELECT id,name,status,attempts,error_code,created_at,updated_at FROM operations_jobs ORDER BY updated_at DESC LIMIT 100').all(),
    db().prepare('SELECT id,category,target,status,observations,first_seen_at,last_seen_at FROM operations_alerts ORDER BY status=\'resolved\',last_seen_at DESC LIMIT 100').all(),
    db().prepare('SELECT id,status,attempts,error_code,created_at,updated_at FROM notification_outbox ORDER BY created_at DESC LIMIT 100').all(),
    db().prepare('SELECT id,status,bytes,tables_count,rows_count,objects_count,created_at FROM operations_backups ORDER BY created_at DESC LIMIT 20').all(),
  ]);
  return {readiness:{email:emailReadiness(),backup:backupReadiness()},jobs:jobs.results,alerts:alerts.results,notifications:notifications.results,backups:backups.results};
}
