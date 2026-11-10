// Counts traffic in memory per Worker instance and writes daily totals to D1
// in one batch every 30 s (or 200 events). A failure here never changes the
// response served. Visitors are counted with a hash of (daily salt, IP,
// browser): the salt is random, changes every day and is deleted after two
// days, so an IP cannot be recovered nor a person followed across days.
import {TRAFFIC_SCHEMA, addCounters, classify} from './traffic-core.mjs';

type Counter = {day: string; scope: string; key: string; dim: string; value: string; n: number};
type Visitor = {day: string; scope: string; key: string; ua: string; ip: string};
type DB = D1Database;

const FLUSH_MS = 30_000, FLUSH_EVENTS = 200, MAX_VISITORS = 2000;
let counters = new Map<string, Counter>(), visitors: Visitor[] = [], events = 0, lastFlush = Date.now(), ready: Promise<unknown> | null = null;
const salts = new Map<string, string>();

async function salt(db: DB, day: string) {
 const cached = salts.get(day);if (cached) return cached;
 const key = 'traffic_salt:' + day, fresh = crypto.randomUUID() + crypto.randomUUID();
 await db.prepare('INSERT OR IGNORE INTO platform_settings(key,value,updated_at) VALUES (?,?,?)').bind(key, fresh, Date.now()).run();
 const row = await db.prepare('SELECT value FROM platform_settings WHERE key=?').bind(key).first<{value: string}>();
 const value = row?.value || fresh;salts.set(day, value);return value;
}

async function hash(text: string) {
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
 return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}

/** Writes and clears the buffer. Exported for tests and the scheduled tick. */
export async function flushTraffic(db: DB) {
 if (!counters.size && !visitors.length) return {counters: 0, visitors: 0};
 const pending = [...counters.values()], people = visitors;
 counters = new Map();visitors = [];events = 0;lastFlush = Date.now();
 try {
  ready ??= db.batch(TRAFFIC_SCHEMA.map(sql => db.prepare(sql)));await ready;
  // Unique visitors first: a new hash for the day adds one visitor.
  const unique = new Map<string, {day: string; scope: string; key: string; hash: string}>();
  for (const person of people) {const h = await hash(await salt(db, person.day) + '|' + person.ip + '|' + person.ua);unique.set([person.day, person.scope, person.key, h].join('|'), {day: person.day, scope: person.scope, key: person.key, hash: h});}
  const rows = [...unique.values()];
  if (rows.length) {
   const results = await db.batch(rows.map(row => db.prepare('INSERT OR IGNORE INTO traffic_visitors(day,scope,key,hash) VALUES (?,?,?,?)').bind(row.day, row.scope, row.key, row.hash)));
   const added = new Map<string, Counter>();
   results.forEach((result, i) => {if (result.meta?.changes) addCounters(added, [{day: rows[i].day, scope: rows[i].scope, key: rows[i].key, dim: 'visitors', value: '', n: 1}]);});
   pending.push(...added.values());
  }
  if (pending.length) await db.batch(pending.map(c => db.prepare('INSERT INTO traffic_daily(day,scope,key,dim,value,n) VALUES (?,?,?,?,?,?) ON CONFLICT(day,scope,key,dim,value) DO UPDATE SET n=n+excluded.n').bind(c.day, c.scope, c.key, c.dim, c.value, c.n)));
  return {counters: pending.length, visitors: rows.length};
 } catch {ready = null;return {counters: 0, visitors: 0};}
}

type Context = {waitUntil(promise: Promise<unknown>): void};
/** Records one served request; never throws. */
export function recordTraffic(db: DB | undefined, ctx: Context | undefined, request: Request, response: Response, startedAt: number, site?: {slug: string}, internal = false) {
 try {
  if (!db) return;
  const url = new URL(request.url), cf = (request as Request & {cf?: {country?: string}}).cf;
  const {counters: added, visitor} = classify({method: request.method, url, status: response.status, ms: Date.now() - startedAt, headers: request.headers, kind: site ? 'site' : 'app', slug: site?.slug, contentType: response.headers.get('content-type'), country: cf?.country, ownHosts: ['braand.fun'], internal});
  if (!added.length) return;
  addCounters(counters, added);events++;
  if (visitor && visitors.length < MAX_VISITORS) visitors.push({...visitor, ip: request.headers.get('cf-connecting-ip') || ''});
  if (ctx && (events >= FLUSH_EVENTS || Date.now() - lastFlush >= FLUSH_MS)) ctx.waitUntil(flushTraffic(db));
 } catch {/* Measuring never breaks a page. */}
}

/** Daily totals kept 400 days, visitor hashes and salts 2 days. */
export async function cleanupTraffic(db: DB, now = Date.now()) {
 const day = (offset: number) => new Date(now - offset * 86400000).toISOString().slice(0, 10);
 await db.batch(TRAFFIC_SCHEMA.map(sql => db.prepare(sql)));
 await db.batch([
  db.prepare('DELETE FROM traffic_visitors WHERE day<?').bind(day(1)),
  db.prepare('DELETE FROM traffic_daily WHERE day<?').bind(day(400)),
  db.prepare("DELETE FROM platform_settings WHERE key LIKE 'traffic_salt:%' AND key<?").bind('traffic_salt:' + day(1)),
 ]);
}
