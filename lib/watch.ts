// Proactive watch: once an hour, Braand looks at every published site, raises
// an insight in the owner's workspace when visits drop or contact requests
// stop, and closes it by itself when the figures recover. An insight is only
// information: any fix is prepared in the conversation and published by the
// owner through the existing approval.
import {db} from './server';
import {AppError} from './core.mjs';
import {recovered, signalTitle, siteSignals} from './watch-core.mjs';
import {dayKey, ensureTraffic} from './site-insights';

const DAY = 86400000, HOUR = 3600000;
type Insight = {id: string; workspace_id: string; title: string; data: string; status: string; created_at: number; updated_at: number};

/** ISO-like week number, so one insight per site, type and week. */
const weekOf = (at: number) => {const d = new Date(at), start = Date.UTC(d.getUTCFullYear(), 0, 1);return d.getUTCFullYear() + '-' + String(Math.floor((at - start) / (7 * DAY))).padStart(2, '0');};

export async function scanSiteWatch(now = Date.now(), force = false) {
 // At most once an hour across Worker instances.
 const slot = String(Math.floor(now / HOUR));
 if (!force) {
  const claim = await db().prepare("INSERT INTO platform_settings(key,value,updated_at) VALUES ('watch_slot',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE platform_settings.value!=excluded.value").bind(slot, now).run();
  if (!claim.meta?.changes) return {skipped: true, raised: 0, resolved: 0};
 }
 await ensureTraffic();
 const first = dayKey(now - 17 * DAY), last = dayKey(now - DAY);
 const days = Array.from({length: 17}, (_, i) => dayKey(now - (17 - i) * DAY));
 const sites = (await db().prepare("SELECT id,workspace_id,slug FROM site_publications WHERE status='published' LIMIT 1000").all<{id: string; workspace_id: string; slug: string}>().catch(() => ({results: [] as {id: string; workspace_id: string; slug: string}[]}))).results;
 if (!sites.length) return {skipped: false, raised: 0, resolved: 0};
 const views = (await db().prepare("SELECT key,day,SUM(n) n FROM traffic_daily WHERE scope='site' AND dim='views' AND day>=? AND day<=? GROUP BY key,day").bind(first, last).all<{key: string; day: string; n: number}>()).results;
 const leads = (await db().prepare("SELECT publication_id,date(created_at/1000,'unixepoch') day,COUNT(*) n FROM site_leads WHERE created_at>=? AND created_at<? GROUP BY publication_id,day").bind(Date.parse(first + 'T00:00:00Z'), Date.parse(dayKey(now) + 'T00:00:00Z')).all<{publication_id: string; day: string; n: number}>().catch(() => ({results: [] as {publication_id: string; day: string; n: number}[]}))).results;
 const viewOf = new Map(views.map(r => [r.key + '|' + r.day, Number(r.n)])), leadOf = new Map(leads.map(r => [r.publication_id + '|' + r.day, Number(r.n)]));
 let raised = 0, resolved = 0;
 const open = (await db().prepare("SELECT id,workspace_id,title,data,status,created_at,updated_at FROM resources WHERE kind='insight' AND status IN ('open','investigating')").all<Insight>()).results;
 for (const site of sites) {
  const series = days.map(day => ({day, views: viewOf.get(site.slug + '|' + day) || 0, leads: leadOf.get(site.id + '|' + day) || 0}));
  for (const signal of siteSignals(series)) {
   if (open.some(i => i.workspace_id === site.workspace_id && JSON.parse(i.data).slug === site.slug && JSON.parse(i.data).type === signal.type)) continue;
   const id = `insight-${signal.type}-${site.slug}-${weekOf(now)}`;
   const data = {type: signal.type, slug: site.slug, publicationId: site.id, facts: signal.facts, detectedAt: now, window: {from: first, to: last}};
   const result = await db().prepare("INSERT OR IGNORE INTO resources (id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,'insight',?,?,'open',?,?)").bind(id, site.workspace_id, signalTitle(signal.type, site.slug, signal.facts), JSON.stringify(data), now, now).run();
   if (result.meta?.changes) raised++;
  }
  // Recovery of insights already raised for this site.
  for (const insight of open.filter(i => i.workspace_id === site.workspace_id && JSON.parse(i.data).slug === site.slug)) {
   const data = JSON.parse(insight.data);
   const last3 = series.slice(14).reduce((a, d) => a + d.views, 0), last7Leads = series.slice(10).reduce((a, d) => a + d.leads, 0);
   if (now - Number(data.detectedAt) > DAY && recovered(data.type, data.facts, last3, last7Leads)) {
    await db().prepare("UPDATE resources SET status='resolved',data=?,updated_at=? WHERE id=? AND status IN ('open','investigating')").bind(JSON.stringify({...data, result: {at: now, lastViews3d: last3, leadsLast7d: last7Leads}}), now, insight.id).run();
    resolved++;
   }
  }
 }
 // Insights nobody looked at expire after 21 days.
 await db().prepare("UPDATE resources SET status='expired',updated_at=? WHERE kind='insight' AND status IN ('open','investigating') AND created_at<?").bind(now, now - 21 * DAY).run();
 return {skipped: false, raised, resolved};
}

export type InsightView = {id: string; type: string; slug: string; title: string; status: string; facts: Record<string, number>; detectedAt: number; result?: Record<string, number>};
const view = (row: Insight): InsightView => {const data = JSON.parse(row.data);return {id: row.id, type: data.type, slug: data.slug, title: row.title, status: row.status, facts: data.facts, detectedAt: data.detectedAt, result: data.result};};

/** What Braand noticed in this workspace: open first, then recently resolved. */
export async function listInsights(tenant: string, now = Date.now()) {
 const rows = (await db().prepare("SELECT id,workspace_id,title,data,status,created_at,updated_at FROM resources WHERE workspace_id=? AND kind='insight' AND (status IN ('open','investigating') OR (status='resolved' AND updated_at>?)) ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END,created_at DESC LIMIT 20").bind(tenant, now - 14 * DAY).all<Insight>()).results;
 return rows.map(view);
}

export async function updateInsight(tenant: string, id: string, action: 'investigate' | 'dismiss', now = Date.now()) {
 const row = await db().prepare("SELECT id,workspace_id,title,data,status,created_at,updated_at FROM resources WHERE id=? AND workspace_id=? AND kind='insight'").bind(id, tenant).first<Insight>();
 if (!row) throw new AppError('Signal introuvable.', 404);
 const status = action === 'dismiss' ? 'dismissed' : 'investigating';
 if (row.status === 'open' || (row.status === 'investigating' && status === 'dismissed')) await db().prepare('UPDATE resources SET status=?,updated_at=? WHERE id=?').bind(status, now, id).run();
 return view({...row, status: row.status === 'open' || status === 'dismissed' ? status : row.status});
}
