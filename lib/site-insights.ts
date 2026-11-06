// Measured figures of a published site for its owner: visits, visitors,
// sources, pages and contact requests per day. Only sites of this workspace;
// never the content of the contact messages.
import {db} from './server';
import {AppError} from './core.mjs';
import {TRAFFIC_SCHEMA} from './traffic-core.mjs';

const DAY = 86400000;
export const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);

export async function ensureTraffic() {await db().batch(TRAFFIC_SCHEMA.map(sql => db().prepare(sql))).catch(() => undefined);}

export async function siteTraffic(tenant: string, slug: string, days = 30, now = Date.now()) {
 const publication = await db().prepare("SELECT id,slug,resource_id,status,created_at FROM site_publications WHERE slug=? AND workspace_id=?").bind(slug, tenant).first<{id: string; slug: string; resource_id: string; status: string; created_at: number}>().catch(() => null);
 if (!publication) throw new AppError('Site publié introuvable dans cet espace.', 404, 'site_not_found');
 await ensureTraffic();
 const from = dayKey(now - (days - 1) * DAY);
 const rows = (await db().prepare("SELECT day,dim,value,n FROM traffic_daily WHERE scope='site' AND key=? AND day>=?").bind(slug, from).all<{day: string; dim: string; value: string; n: number}>()).results;
 const leads = (await db().prepare('SELECT created_at FROM site_leads WHERE publication_id=? AND created_at>=?').bind(publication.id, Date.parse(from + 'T00:00:00Z')).all<{created_at: number}>().catch(() => ({results: [] as {created_at: number}[]}))).results;
 const calendar = Array.from({length: days}, (_, i) => dayKey(now - (days - 1 - i) * DAY));
 const sum = (dim: string, day?: string) => rows.filter(r => r.dim === dim && (!day || r.day === day)).reduce((a, r) => a + Number(r.n || 0), 0);
 const top = (dim: string) => {const m = new Map<string, number>();for (const r of rows) if (r.dim === dim) m.set(r.value, (m.get(r.value) || 0) + Number(r.n || 0));return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({label, count}));};
 const leadsByDay = new Map<string, number>();for (const lead of leads) leadsByDay.set(dayKey(lead.created_at), (leadsByDay.get(dayKey(lead.created_at)) || 0) + 1);
 return {
  slug, status: publication.status, publishedAt: publication.created_at, days,
  totals: {views: sum('views'), visitors: sum('visitors'), leads: leads.length},
  series: calendar.map(day => ({day, views: sum('views', day), visitors: sum('visitors', day), leads: leadsByDay.get(day) || 0})),
  sources: top('source'), pages: top('page'), devices: top('device'),
  note: 'Mesuré par Braand (sans cookie). Le jour en cours est partiel. Les messages des demandes de contact ne sont pas lus ici.',
 };
}
