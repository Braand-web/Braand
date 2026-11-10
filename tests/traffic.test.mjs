import assert from 'node:assert/strict';
import test from 'node:test';
import {classify, pageShape, sourceOf, apiGroup, latencyBand, deviceOf, isBot, addCounters,APP_TRAFFIC_KEY,INTERNAL_TRAFFIC_COOKIE,hasInternalTrafficCookie,internalTrafficCookie} from '../lib/traffic-core.mjs';
import {PLATFORM_OWNER_IDS,platformAdminIdsFrom} from '../lib/platform-owner-ids.mjs';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const req = (path, headers = {}, extra = {}) => ({method: 'GET', url: new URL('https://braand.fun' + path), status: 200, ms: 120, headers: new Headers({'user-agent': CHROME, ...headers}), kind: 'app', contentType: 'text/html; charset=utf-8', country: 'CM', ownHosts: ['braand.fun'], ...extra});
const dims = result => Object.fromEntries(result.counters.map(c => [c.dim, c.value]));

test('a page visit counts a view with its page shape, source, device and country, and nothing identifying', () => {
  const result = classify(req('/aide?ref=abc', {referer: 'https://www.google.com/search?q=braand', 'cf-connecting-ip': '203.0.113.7'}));
  assert.deepEqual(dims(result), {views: '', page: '/aide', source: 'Google', device: 'Ordinateur', country: 'CM'});
  assert.ok(result.visitor);assert.equal('ip' in result.visitor, false);
  assert.equal(result.visitor.key,APP_TRAFFIC_KEY);
  assert.ok(!JSON.stringify(result.counters).includes('203.0.113.7') && !JSON.stringify(result.counters).includes('ref=abc'));
});

test('sources: utm first, social networks named, direct, other sites by domain, internal links not counted as visits', () => {
  const url = new URL('https://braand.fun/?utm_source=facebook');
  assert.equal(sourceOf(url, 'https://l.instagram.com/'), 'Facebook');
  assert.equal(sourceOf(new URL('https://braand.fun/'), 'https://l.facebook.com/'), 'Facebook');
  assert.equal(sourceOf(new URL('https://braand.fun/'), 'https://wa.me/123'), 'WhatsApp');
  assert.equal(sourceOf(new URL('https://braand.fun/'), null), 'Lien direct');
  assert.equal(sourceOf(new URL('https://braand.fun/'), 'https://blog.exemple.cm/article'), 'blog.exemple.cm');
  assert.equal(sourceOf(new URL('https://braand.fun/tarifs'), 'https://braand.fun/'), null);
  assert.deepEqual(classify(req('/tarifs', {referer: 'https://braand.fun/'})).counters.map(c => c.dim), ['internal']);
});

test('pages lose identifiers and parameters; robots, files, API calls and errors are not visits', () => {
  assert.equal(pageShape('/admin/users/8f14e45fceea167a5a36dedd4bea2543'), '/admin/users/:id');
  assert.equal(pageShape('/Aide/Facturation'), '/aide/facturation');
  assert.deepEqual(classify(req('/', {'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)'})).counters.map(c => c.dim), ['bot']);
  assert.equal(isBot(''), true);
  assert.deepEqual(classify(req('/fonts/Manrope.ttf', {}, {contentType: 'font/ttf'})).counters, []);
  assert.deepEqual(classify(req('/aide', {}, {status: 500})).counters, []);
  assert.deepEqual(classify(req('/', {}, {method: 'POST'})).counters, []);
  assert.equal(classify(req('/', {}, {status: 401})).counters[0].dim, 'views', 'the sign-in page is still a visit');
  assert.equal(deviceOf(IPHONE), 'Téléphone');assert.equal(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'Tablette');
});

test('API requests are grouped by route with status class and latency band; internal ticks are ignored', () => {
  assert.equal(apiGroup('/api/resources/8f14e45fceea167a5a36dedd4bea2543'), '/api/resources/:id');
  assert.equal(latencyBand(150), '< 200 ms');assert.equal(latencyBand(2500), '< 3 s');assert.equal(latencyBand(12000), '≥ 10 s');
  const api = classify(req('/api/billing/summary', {}, {status: 503, ms: 2400, contentType: 'application/json'}));
  assert.deepEqual(api.counters.map(c => [c.scope, c.key, c.dim, c.value, c.n]), [['api', '/api/billing/summary', 'requests', 'GET', 1], ['api', '/api/billing/summary', 'status', '5xx', 1], ['api', '/api/billing/summary', 'latency', '< 3 s', 1], ['api', '/api/billing/summary', 'ms_total', '', 2400]]);
  assert.equal(api.visitor, undefined);
  assert.deepEqual(classify(req('/api/internal/operations-tick')).counters, []);
});

test('a published site counts under its name, only for pages served', () => {
  const site = classify(req('/mon-salon/contact', {}, {kind: 'site', slug: 'mon-salon', url: new URL('https://braand-sites.workers.dev/mon-salon/contact')}));
  assert.deepEqual(site.counters.map(c => [c.scope, c.key, c.dim, c.value]).slice(0, 2), [['site', 'mon-salon', 'views', ''], ['site', 'mon-salon', 'page', '/contact']]);
  assert.deepEqual(classify(req('/mon-salon/', {}, {kind: 'site', slug: 'mon-salon', status: 304})).counters, []);
});

test('counters add up in memory before being written', () => {
  const map = new Map();
  addCounters(map, classify(req('/')).counters);addCounters(map, classify(req('/')).counters);
  const views = [...map.values()].find(c => c.dim === 'views');assert.equal(views.n, 2);
});

test('admin documents, API polling and identified admin browsers never enter traffic counters',()=>{
 for(const path of ['/admin','/admin/','/admin/users?email=hidden','/api/admin/traffic','/api/admin/me'])assert.deepEqual(classify(req(path)).counters,[]);
 for(const path of ['/','/aide','/api/chat']){
  assert.deepEqual(classify(req(path,{}, {internal:true})).counters,[]);
  assert.deepEqual(classify(req(path,{cookie:`other=x; ${INTERNAL_TRAFFIC_COOKIE}=1`})).counters,[]);
 }
 assert.ok(classify(req('/administration-guide')).visitor,'only the actual administration route is excluded');
 assert.ok(classify(req('/',{'x-braand-identity-id':PLATFORM_OWNER_IDS[0]})).visitor,'supplied identity headers are not evidence of admin status');
 assert.ok(classify(req('/',{cookie:INTERNAL_TRAFFIC_COOKIE+'=10'})).visitor);
 assert.equal(hasInternalTrafficCookie(new Headers({cookie:INTERNAL_TRAFFIC_COOKIE+'=1'})),true);
 assert.match(internalTrafficCookie(true),/^__Host-.*=1; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=7776000$/);
 assert.match(internalTrafficCookie(false),/Max-Age=0$/);
 const ids=platformAdminIdsFrom({OPS_ADMIN_IDS:' configured-admin, other ',BILLING_ADMIN_IDS:'billing-admin'});
 for(const id of [...PLATFORM_OWNER_IDS,'configured-admin','other','billing-admin'])assert.ok(ids.has(id));
});

test('HEAD probes and prefetches are not visitors; a normal external page remains countable',()=>{
 assert.deepEqual(classify(req('/',{},{method:'HEAD'})).counters,[]);
 assert.deepEqual(classify(req('/',{purpose:'prefetch'})).counters,[]);
 assert.deepEqual(classify(req('/',{'sec-purpose':'prefetch;prerender'})).counters,[]);
 assert.equal(classify(req('/')).visitor.key,APP_TRAFFIC_KEY);
});
