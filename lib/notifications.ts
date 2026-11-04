import {config, db, uid} from './server';
import {AppError} from './core.mjs';

type AlertPayload = {category: string; target: string};
type OutboxRow = {id: string; template: string; payload: string; status: string; created_at: number; attempts: number};
const safeReference = (value: string) => /^[a-zA-Z0-9:_-]{1,180}$/.test(value);
const email = (value: string | undefined) => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);

export function emailReadiness() {
  const c = config();
  const mode = c.RESEND_MODE || 'disabled';
  if (!['sandbox','live'].includes(mode)) return {ready: false, reason: 'email_disabled', mode};
  if (!c.RESEND_API_KEY || !email(c.RESEND_FROM)) return {ready: false, reason: 'email_configuration_missing', mode};
  if (mode === 'sandbox') {
    if (!['test','staging'].includes(c.APP_ENV || '')) return {ready: false, reason: 'sandbox_environment_required', mode};
    if (!email(c.RESEND_TEST_RECIPIENT)) return {ready: false, reason: 'test_recipient_missing', mode};
  } else {
    if (c.APP_ENV !== 'production' || c.RESEND_LIVE_APPROVED !== 'true') return {ready: false, reason: 'live_email_not_approved', mode};
    if (!email(c.OPS_ALERT_EMAIL)) return {ready: false, reason: 'alert_recipient_missing', mode};
  }
  return {ready: true, reason: null, mode};
}

export async function enqueueOperationalNotification(id: string, payload: AlertPayload, now = Date.now()) {
  if (!safeReference(id) || !safeReference(payload.category) || !safeReference(payload.target)) throw new AppError('Référence de notification invalide.',400);
  await db().prepare("INSERT OR IGNORE INTO notification_outbox(id,template,payload,created_at,updated_at) VALUES (?,'operations_alert',?,?,?)")
    .bind(id, JSON.stringify(payload), now, now).run();
  return {id, queued: true};
}

/** Weekly quality summary for operators: aggregate figures only, fixed recipient. */
export async function enqueueQualityReport(id: string, text: string, now = Date.now()) {
  if (!safeReference(id) || text.length > 4000) throw new AppError('Rapport qualité invalide.',400);
  await db().prepare("INSERT OR IGNORE INTO notification_outbox(id,template,payload,created_at,updated_at) VALUES (?,'quality_report',?,?,?)")
    .bind(id, JSON.stringify({text}), now, now).run();
  return {id, queued: true};
}

// Only operational messages are supported here. No broadcast or arbitrary recipient/body API.
export async function dispatchOperationalNotifications(limit = 10, now = Date.now()) {
  const readiness = emailReadiness();
  // An interrupted POST might already have sent. Never automatically resend it.
  await db().prepare("UPDATE notification_outbox SET status='uncertain',error_code='delivery_unknown',lease_token=NULL,lease_until=0,updated_at=? WHERE status='sending' AND lease_until<=?").bind(now, now).run();
  const rows = await db().prepare("SELECT id,template,payload,status,created_at,attempts FROM notification_outbox WHERE status IN ('pending','blocked') ORDER BY created_at,id LIMIT ?")
    .bind(Math.max(1, Math.min(25, limit))).all<OutboxRow>();
  let sent = 0, blocked = 0, uncertain = 0, failed = 0;
  for (const row of rows.results) {
    if (!readiness.ready) {
      await db().prepare("UPDATE notification_outbox SET status='blocked',error_code=?,updated_at=? WHERE id=? AND status IN ('pending','blocked')").bind(readiness.reason, now, row.id).run();
      blocked++; continue;
    }
    const lease = uid();
    const claimed = await db().prepare("UPDATE notification_outbox SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,error_code=NULL,updated_at=? WHERE id=? AND status IN ('pending','blocked')")
      .bind(lease, now + 30000, now, row.id).run();
    if (!claimed.meta.changes) continue;
    const save = (status: string, code: string | null, providerId: string | null = null) => db().prepare('UPDATE notification_outbox SET status=?,error_code=?,provider_id=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?')
      .bind(status, code, providerId, Date.now(), row.id, lease).run();
    try {
      const parsed = JSON.parse(row.payload) as AlertPayload & {text?: string};
      const quality = row.template === 'quality_report' && typeof parsed.text === 'string' && parsed.text.length <= 4000;
      if (!quality && (row.template !== 'operations_alert' || !safeReference(parsed.category) || !safeReference(parsed.target))) {
        await save('failed','notification_invalid'); failed++; continue;
      }
      const payload = parsed;
      const c = config();
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: {'Authorization': 'Bearer ' + c.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'braand-ops/' + row.id},
        body: JSON.stringify({from: c.RESEND_FROM, to: [readiness.mode === 'sandbox' ? c.RESEND_TEST_RECIPIENT : c.OPS_ALERT_EMAIL],
          subject: quality ? 'Braand — rapport qualité des agents' : 'Braand — une intervention est nécessaire', text: quality ? String(payload.text) : `Une alerte technique requiert votre attention.\nCatégorie : ${payload.category}\nRéférence : ${payload.target}\nConsultez la console d’exploitation Braand. Aucun secret n’est inclus dans ce message.`}),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        // No blind retries, even for 5xx: a provider can fail after accepting a request.
        const unknown = response.status >= 500 || response.status === 408;
        await save(unknown ? 'uncertain' : 'failed', unknown ? 'delivery_unknown' : 'email_rejected');
        if (unknown) uncertain++; else failed++;
        continue;
      }
      const data: unknown = await response.json();
      const providerId = data && typeof data === 'object' && 'id' in data && typeof data.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(data.id) ? data.id : null;
      if (!providerId) {await save('uncertain','delivery_unknown'); uncertain++; continue;}
      await save('sent',null,providerId); sent++;
    } catch {await save('uncertain','delivery_unknown'); uncertain++;}
  }
  return {checked: rows.results.length, sent, blocked, uncertain, failed};
}
