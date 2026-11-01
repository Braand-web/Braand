import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Readable} from 'node:stream';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const bundle = await build({entryPoints: ['lib/browser-driver.ts'], bundle: true, platform: 'node', format: 'esm', write: false, external: ['@cloudflare/playwright']});
const {createBrowserDriver, redactBrowserText} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture() {
  const trace = {launches: [], connects: [], closes: 0, cdp: [], evaluations: 0, actions: [], contextOptions: [], history: []};
  const binding = {fetch: async () => { throw new Error('No paid/provider network in unit tests'); }};
  let nextTarget = 0;
  class FakePage {
    constructor(context) { this.context = context; this.target = `private-cdp-${++nextTarget}`; this.currentURL = 'about:blank'; this.routes = []; this.sockets = []; this.listeners = new Map(); this.raw = {title: 'Example', text: 'Welcome', elements: [{selector: 'html > body:nth-child(2) > button:nth-child(1)', role: 'button', name: 'Continue', sensitive: false}]}; this.mouse = {click: async (...args) => trace.actions.push(['pointer', ...args]), wheel: async (...args) => trace.actions.push(['scroll', ...args])}; this.keyboard = {insertText: async () => trace.actions.push(['human_type'])}; }
    url() { return this.currentURL; }
    async title() { return this.raw.title; }
    async evaluate(fn) { assert.equal(typeof fn, 'function'); assert.equal(fn.name, 'collectDOM'); trace.evaluations++; trace.collector = fn; return structuredClone(this.raw); }
    async route(pattern, callback) { assert.equal(pattern, '**/*'); this.routes.push(callback); }
    async routeWebSocket(pattern, callback) { assert.equal(pattern, '**/*'); this.sockets.push(callback); }
    on(event, callback) { this.listeners.set(event, callback); }
    off(event, callback) { if (this.listeners.get(event) === callback) this.listeners.delete(event); }
    async goto(url) { trace.actions.push(['navigate', url]); this.currentURL = url; if (this.navigationError) throw this.navigationError; }
    async bringToFront() { trace.actions.push(['select_tab', this.target]); }
    async close() { this.context.allPages.splice(this.context.allPages.indexOf(this), 1); }
    locator(selector) {
      const act = async (kind, value) => { trace.actions.push([kind, selector, value]); if (this.download) this.listeners.get('download')?.(this.download); if (this.actionError) throw this.actionError; };
      return {click: () => act('click'), fill: value => act('fill', value), press: key => act('press', key), selectOption: value => act('select', value), setInputFiles: file => act('upload', file)};
    }
    async screenshot(options) { trace.actions.push(['screenshot', options]); return Buffer.from('png'); }
  }
  const context = {
    allPages: [], routes: [], sockets: [], inits: [], listeners: new Map(),
    setDefaultTimeout(value) { assert.equal(value, 15_000); }, setDefaultNavigationTimeout(value) { assert.equal(value, 20_000); },
    async route(pattern, callback) { assert.equal(pattern, '**/*'); this.routes.push(callback); },
    async routeWebSocket(pattern, callback) { assert.equal(pattern, '**/*'); this.sockets.push(callback); },
    async addInitScript(fn) { assert.equal(typeof fn, 'function'); this.inits.push(fn); }, async clearPermissions() {},
    on(event, fn) { this.listeners.set(event, fn); }, pages() { return this.allPages; },
    async newPage() { const page = new FakePage(this); this.allPages.push(page); this.listeners.get('page')?.(page); return page; },
    async newCDPSession(page) { return {send: async (method, params) => { trace.cdp.push([method, params]); if (method === 'Target.getTargetInfo') return {targetInfo: {targetId: page.target}}; return {}; }, detach: async () => {}}; },
    async storageState(options) { assert.deepEqual(options, {indexedDB: true}); return this.state || {cookies: [], origins: []}; },
  };
  const browser = {
    connected: true, sessionId: () => 'provider-private-session', isConnected() { return this.connected; },
    async newContext(options) { trace.contextOptions.push(options); return context; },
    async close() { trace.closes++; this.connected = false; },
    async newBrowserCDPSession() { return {send: async method => { trace.cdp.push([method]); this.connected = false; }, detach: async () => {}}; },
  };
  const sdk = {
    async launch(endpoint, options) { assert.equal(typeof endpoint.fetch, 'function'); trace.launches.push(options); return browser; },
    async connect(_endpoint, options) { trace.connects.push(options); return browser; },
    async history() { if (trace.historyError) throw trace.historyError; return trace.history; },
  };
  const driver = createBrowserDriver(binding, sdk);
  return {driver, sdk, trace, context, browser, binding};
}

async function opened() { const f = fixture(); const result = await f.driver.open({allowedDomains: ['example.com']}); return {...f, sessionId: result.sessionId, page: f.context.allPages[0]}; }
const errorCode = code => error => error.code === code;

test('pinned SDK lifecycle assumptions are verified against its installed provider implementation', async () => {
  const source = await readFile(createRequire(import.meta.url).resolve('@cloudflare/playwright'), 'utf8');
  const launch = source.slice(source.indexOf('async function launch('), source.indexOf('async function acquire('));
  const connect = source.slice(source.indexOf('async function connect('), source.indexOf('async function launch('));
  assert.match(launch, /method: "Browser\.close"/);
  assert.match(launch, /browserImpl\.options\.browserProcess = \{ close: doClose, kill: doClose \}/);
  assert.doesNotMatch(connect, /browserProcess/);
});

test('launch latches exact native hostname guardrails and a retained native SW-blocked context', async () => {
  const f = await opened();
  assert.deepEqual(f.trace.launches, [{guardrails: {allowedDomains: ['example.com']}, keep_alive: 60_000}]);
  assert.deepEqual(f.trace.contextOptions, [{serviceWorkers: 'block', acceptDownloads: true,viewport:{width:1280,height:720}}]);
  assert.equal(f.trace.closes, 0);
  assert.ok(f.context.routes.length && f.page.routes.length && f.context.sockets.length && f.page.sockets.length);
  assert.equal(f.context.inits[0].name, 'installPageRestrictions');
  assert.ok(f.trace.cdp.some(([method]) => method === 'Network.setBypassServiceWorker'));
});

test('context and page guards reject HTTP, active schemes, local/private hosts, disallowed redirects and SW scripts', async () => {
  const f = await opened();
  for (const handler of [f.context.routes[0], f.page.routes[0]]) {
    for (const url of ['http://example.com/', 'https://evil.com/redirect', 'https://127.0.0.1/', 'https://localhost/', 'data:text/html,x', 'javascript:alert(1)', 'file:///etc/passwd', 'https://example.com:444/']) {
      const calls = [];
      await handler({request: () => ({url: () => url, headers: () => ({}),method:()=>'GET'}), abort: async reason => calls.push(reason), continue: async () => calls.push('continue')});
      assert.deepEqual(calls, ['blockedbyclient'], url);
    }
    const calls = [];
    await handler({request: () => ({url: () => 'https://example.com/script.js', headers: () => ({'service-worker': 'script'}),method:()=>'GET'}), abort: async reason => calls.push(reason), continue: async () => calls.push('continue')});
    assert.deepEqual(calls, ['blockedbyclient']);
    await handler({request: () => ({url: () => 'https://example.com/image.png', headers: () => ({}),method:()=>'GET'}), abort: async () => assert.fail(), continue: async () => calls.push('continue')});
    assert.equal(calls.at(-1), 'continue');
  }
  let closed = 0;
  await f.context.sockets[0]({close: () => {closed++;}});
  assert.equal(closed, 1);
});

test('observations have stable public refs and redact secret patterns without provider/CDP IDs', async () => {
  const f = await opened();
  f.page.currentURL = 'https://example.com/account?token=private#secret';
  f.page.raw.text = 'OTP 123456 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.sig';
  f.page.raw.elements[0].name = 'code 998877 sk-secretvalue';
  const first = await f.driver.observe(f.sessionId);
  const second = await createBrowserDriver(f.binding, f.sdk).observe(f.sessionId);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.elements, second.elements);
  assert.equal(first.url, 'https://example.com/account');
  const serialized = JSON.stringify(first);
  for (const secret of ['provider-private-session', 'private-cdp-', '123456', '998877', 'secretvalue', 'eyJhbG', '?token=']) assert.ok(!serialized.includes(secret), secret);
  assert.ok(first.elements[0].ref.startsWith('e0_'));
  assert.equal(f.trace.launches.length, 1);
  assert.equal(f.trace.connects.length, 0);
});

test('cold or disconnected ownership fails closed without reconnect, replay, or a new context', async () => {
  const f = await opened();
  await assert.rejects(createBrowserDriver({fetch: f.binding.fetch}, f.sdk).observe(f.sessionId), errorCode('browser_retained_session_required'));
  f.browser.connected = false;
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'navigate', url: 'https://example.com'}), errorCode('browser_retained_session_required'));
  assert.equal(f.trace.connects.length, 0);
  assert.equal(f.trace.launches.length, 1);
  assert.deepEqual(f.trace.actions, []);
});

test('target actions revalidate observation, refuse stale DOM and refuse credential/payment fields', async () => {
  const f = await opened();
  const observation = await f.driver.observe(f.sessionId);
  const command = {kind: 'fill', observationId: observation.id, targetRef: observation.elements[0].ref, value: 'ordinary'};
  f.page.raw.text = 'Changed';
  await assert.rejects(f.driver.command(f.sessionId, command), errorCode('browser_stale_observation'));
  assert.equal(f.trace.actions.length, 0);
  for (const inputType of ['password', 'text']) {
    f.page.raw.elements[0] = {...f.page.raw.elements[0], inputType, sensitive: true, name: '[champ privé — contrôle manuel]'};
    const fresh = await f.driver.observe(f.sessionId);
    await assert.rejects(f.driver.command(f.sessionId, {...command, observationId: fresh.id, targetRef: fresh.elements[0].ref}), errorCode('browser_human_required'));
  }
  assert.equal(f.trace.actions.length, 0);
});

test('a private form-state digest invalidates an approval without exposing the form state', async () => {
  const f = await opened();
  f.page.raw.stateFingerprint = 'private-form-digest-1';
  const observation = await f.driver.observe(f.sessionId);
  assert.ok(!JSON.stringify(observation).includes('private-form-digest-1'));
  f.page.raw.stateFingerprint = 'private-form-digest-2';
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'click', observationId: observation.id, targetRef: observation.elements[0].ref}), errorCode('browser_stale_observation'));
  assert.equal(f.trace.actions.length, 0);
});

test('the actual fixed DOM collector hides current field values and hashes changes to private/hidden form state', async () => {
  const f = await opened(); await f.driver.observe(f.sessionId);
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.attributes = {}; this.children = []; this.id = ''; this.textContent = ''; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    getBoundingClientRect() { return {width: 1, height: 1}; }
    closest() { return null; }
  }
  class Input extends Element { constructor() { super('input'); this.value = 'hunter-two-private'; this.checked = false; this.labels = []; this.attributes.type = 'password'; } }
  class Textarea extends Element {}
  class Select extends Element {}
  const html = new Element('html'), body = new Element('body'), input = new Input(), hidden = new Input(), button = new Element('button');
  hidden.attributes.type = 'hidden'; hidden.value = 'private-csrf-value'; button.textContent = 'Submit hunter-two-private';
  html.children = [body]; body.parentElement = html; body.children = [input, hidden, button]; for (const node of body.children) node.parentElement = body;
  const document = {title: 'hunter-two-private account', documentElement: html, body, getElementById: () => undefined, createTreeWalker: () => {let read = false; return {nextNode: () => {if (read) return null; read = true; return {nodeValue: 'Page echoes hunter-two-private', parentElement: body};}};}, querySelectorAll: selector => selector === 'input,textarea,select,[contenteditable]' ? [input, hidden] : selector === 'form,button,input[type=submit]' ? [button] : [input, button]};
  const globals = {document, HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select, NodeFilter: {SHOW_TEXT: 4}, getComputedStyle: () => ({visibility: 'visible', display: 'block'}), crypto: globalThis.crypto, TextEncoder};
  const collect = () => runInNewContext(`(${f.trace.collector.toString()})()`, globals);
  const first = await collect();
  assert.ok(!JSON.stringify(first).includes('hunter-two-private'));
  assert.ok(!JSON.stringify(first).includes('private-csrf-value'));
  assert.match(first.stateFingerprint, /^[0-9a-f]{64}$/);
  hidden.value = 'different-csrf';
  const second = await collect();
  assert.notEqual(first.stateFingerprint, second.stateFingerprint);
  assert.equal(first.elements[0].sensitive, true);
});

test('fixed typed actions execute once, and unknown transport acknowledgement never retries', async () => {
  const f = await opened();
  let observation = await f.driver.observe(f.sessionId);
  await f.driver.command(f.sessionId, {kind: 'click', pageId: observation.pageId, observationId: observation.id, targetRef: observation.elements[0].ref});
  assert.equal(f.trace.actions.filter(([kind]) => kind === 'click').length, 1);
  observation = await f.driver.observe(f.sessionId);
  f.page.actionError = new Error('private provider CDP failure token=secret');
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'click', observationId: observation.id, targetRef: observation.elements[0].ref}), error => error.code === 'browser_transport_unknown' && !error.message.includes('private'));
  assert.equal(f.trace.actions.filter(([kind]) => kind === 'click').length, 2);
});

test('human pointer/type paths produce no DOM observation or authentication echo', async () => {
  const f = await opened();
  const first = await f.driver.command(f.sessionId, {kind: 'pointer', observationId: 'human', x: 2, y: 3});
  const second = await f.driver.command(f.sessionId, {kind: 'type', observationId: 'human', value: 'private-password-123456'});
  assert.equal(f.trace.evaluations, 0);
  assert.equal(first.observation.id, 'human_private');
  assert.equal(second.observation.text, '');
  assert.equal(second.observation.elements.length, 0);
  assert.ok(!JSON.stringify(second).includes('password'));
});

test('navigation and tabs retain stable public identities and reject out-of-domain navigation before actions', async () => {
  const f = await opened();
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'navigate', url: 'https://evil.com/'}));
  assert.equal(f.trace.actions.length, 0);
  const first = await f.driver.command(f.sessionId, {kind: 'navigate', url: 'https://example.com/start'});
  const second = await f.driver.command(f.sessionId, {kind: 'new_tab', url: 'https://example.com/next'});
  assert.equal(second.observation.tabs.length, 2);
  assert.notEqual(first.observation.pageId, second.observation.pageId);
  const selected = await f.driver.command(f.sessionId, {kind: 'select_tab', pageId: first.observation.pageId});
  assert.equal(selected.observation.pageId, first.observation.pageId);
  const closed = await f.driver.command(f.sessionId, {kind: 'close_tab', pageId: first.observation.pageId});
  assert.equal(closed.observation.tabs.length, 1);
});

test('storageState imports and exports native cookies/localStorage/IndexedDB only through private driver state', async () => {
  const f = fixture();
  const state = {cookies: [{name: 'auth', value: 'private-cookie', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax'}], origins: [{origin: 'https://example.com', localStorage: [{name: 'auth', value: 'private-local'}], indexedDB: [{name: 'auth', version: 1, stores: []}]}]};
  const {sessionId} = await f.driver.open({allowedDomains: ['example.com'], storageState: JSON.stringify(state)});
  assert.deepEqual(f.trace.contextOptions[0].storageState, state);
  f.context.state = state;
  assert.deepEqual(JSON.parse(await f.driver.storageState(sessionId)), state);
  const observation = await f.driver.observe(sessionId);
  assert.ok(!JSON.stringify(observation).includes('private-cookie'));
  await assert.rejects(f.driver.open({allowedDomains: ['example.com'], storageState: JSON.stringify({...state, origins: [{origin: 'https://evil.com', localStorage: []}]})}));
  assert.equal(f.trace.launches.length, 1);
});

test('uploads and downloads are bounded at 50 MiB; successful downloads clean provider artifacts', async () => {
  const f = await opened();
  const observation = await f.driver.observe(f.sessionId);
  const target = {observationId: observation.id, targetRef: observation.elements[0].ref};
  const calls = [];
  f.page.download = {url: () => 'https://example.com/download', createReadStream: async () => Readable.from([Buffer.from('file-data')]), failure: async () => null, suggestedFilename: () => '../private.txt', cancel: async () => calls.push('cancel'), delete: async () => calls.push('delete')};
  const result = await f.driver.command(f.sessionId, {kind: 'click', ...target});
  assert.equal(Buffer.from(result.download.bytes).toString(), 'file-data');
  assert.equal(result.download.mime, 'text/plain');
  assert.equal(result.download.name, '.._private.txt');
  assert.deepEqual(calls, ['delete']);
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'upload', ...target, fileId: 'f_1'}, {name: 'big', mime: 'text/plain', bytes: new Uint8Array(50 * 1024 * 1024 + 1)}), errorCode('browser_file_too_large'));
  f.page.download.createReadStream = async () => Readable.from([new Uint8Array(50 * 1024 * 1024 + 1)]);
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'click', ...target}), errorCode('browser_file_too_large'));
  assert.deepEqual(calls.slice(-2), ['cancel', 'delete']);
  f.page.download.url = () => 'data:text/plain,untrusted';
  await assert.rejects(f.driver.command(f.sessionId, {kind: 'click', ...target}), errorCode('browser_download_destination_blocked'));
});

test('capture is binary only, masks form inputs, and does not evaluate DOM or leak cookies/CDP ids', async () => {
  const f = await opened();
  assert.equal(Buffer.from(await f.driver.capture(f.sessionId)).toString(), 'png');
  assert.equal(f.trace.evaluations, 0);
  const screenshot = f.trace.actions.find(([kind]) => kind === 'screenshot');
  assert.equal(screenshot[1].type, 'png');
  assert.equal(screenshot[1].mask.length, 2);
});

test('close really terminates launched provider browser; complete receipts use provider timestamps only', async () => {
  const f = await opened();
  f.trace.history = [{sessionId: 'provider-private-session', startTime: 1000, endTime: 2500}];
  assert.deepEqual(await f.driver.close(f.sessionId), {sessionId: f.sessionId, status: 'complete', milliseconds: 1500, source: 'provider_history'});
  assert.ok(f.trace.closes >= 1);
  assert.equal(f.trace.connects.length, 0);
  await assert.rejects(f.driver.observe(f.sessionId), errorCode('browser_retained_session_required'));
});

test('cold close sends real Browser.close instead of transport-only connect.close; missing receipts stay unknown', async () => {
  const f = await opened();
  const cold = createBrowserDriver({fetch: f.binding.fetch}, f.sdk);
  const result = await cold.close(f.sessionId);
  assert.deepEqual(f.trace.connects, [{sessionId: 'provider-private-session'}]);
  assert.ok(f.trace.cdp.some(([method]) => method === 'Browser.close'));
  assert.deepEqual(result, {sessionId: f.sessionId, status: 'unknown', source: 'provider_history'});
});

test('invalid/missing provider history never invents a complete usage receipt', async () => {
  for (const history of [[], [{sessionId: 'provider-private-session', startTime: NaN, endTime: 2000}], [{sessionId: 'provider-private-session', startTime: 2000, endTime: 1000}], [{sessionId: 'provider-private-session', startTime: 0, endTime: 8 * 86_400_000}]]) {
    const f = await opened(); f.trace.history = history;
    const result = await f.driver.close(f.sessionId);
    assert.equal(result.status, 'unknown');
    assert.equal(result.milliseconds, undefined);
  }
});

test('credential redaction handles JWTs, long tokens, OTPs, cards and URL query strings', () => {
  const result = redactBrowserText('OTP 123456 card 4242 4242 4242 4242 token=secret123 https://example.com/a?password=hunter#fragment');
  for (const text of ['123456', '4242', 'secret123', 'hunter', 'fragment']) assert.ok(!result.includes(text));
});

test('ordinary prices, years and campaign metrics survive credential redaction', () => {
  const text='En 2026 : 15000 impressions, 9900 FCFA et 1234 visites.';
  assert.equal(redactBrowserText(text),text);
  assert.ok(!redactBrowserText('code de connexion : 123456').includes('123456'));
});
