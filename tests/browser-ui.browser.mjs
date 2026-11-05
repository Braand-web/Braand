// Real React/Chromium, loopback fixtures, no live provider or payment calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const require = createRequire(import.meta.url);
const playwright = process.env.BRAAND_PLAYWRIGHT_MODULE;
const {chromium} = await import(playwright ? pathToFileURL(path.resolve(playwright)).href : require.resolve('playwright'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.tmp', 'browser-ui-browser');
await mkdir(output, {recursive: true});
await build({external: ['/fonts/*'],
  stdin: {
    contents: 'import React from "react";import {createRoot} from "react-dom/client";import BrowserPanel from "./components/browser-panel";import "./app/globals.css";import "./app/tokens.css";import "./components/ds/ds.css";import "./components/ds/bridge.css";import "./app/design-system.css";createRoot(document.getElementById("root")).render(<BrowserPanel conversationId="conversation-browser-fixture"/>);',
    resolveDir: root, loader: 'tsx',
  },
  outdir: output, entryNames: 'app', bundle: true, format: 'esm', jsx: 'automatic',
  alias: {'next/image': 'vinext/shims/image'},
  define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
});

const now = Date.now();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZsAAAAASUVORK5CYII=', 'base64');
const observation = {
  id: 'observation-fixture', pageId: 't_fixture', url: 'https://example.com/review', title: 'Page de test privée',
  tabs: [{id: 't_fixture', title: 'Page de test privée', url: 'https://example.com/review'}],
  elements: [{ref: 'e1_fixture', role: 'button', name: 'Envoyer le formulaire'}],
  text: 'Compte de test local. Aucune navigation réelle.', fingerprint: 'fixture-fingerprint', capturedAt: now,
};
const makeSession = (patch = {}) => ({
  id: 'session-fixture', version: 4, status: 'draft', objective: 'Consulter les informations de test',
  conversationId: 'conversation-browser-fixture', allowedDomains: ['example.com'], url: '', title: '', tabs: [],
  control: 'agent', maxCredits: 12, maxActions: 40, maxSeconds: 300, actionsUsed: 0, secondsUsed: 0,
  createdAt: now, updatedAt: now, expiresAt: now + 86_400_000, pendingAction: null, observation: null,
  captureId: null, resultReview: null, lastError: null, profileId: null, ...patch,
});
const makePending = (id, version, command) => ({
  id, version, status: 'pending', command,
  description: command.kind === 'fill' ? 'Renseigner le champ « Message public »' : 'Cliquer sur « Envoyer le formulaire » (button)',
  expiresAt: now + 300_000,
});
const artifact = {
  id: 'capture-fixture', kind: 'capture', name: 'Capture du navigateur.png', mime: 'image/png',
  size: png.length, createdAt: now, expiresAt: now + 86_400_000, fileId: null,
};
const mutations = [], requests = [], unknownAPI = [];
let ready = false, sessions = [makeSession()], profiles = [], agentSnapshots = 0, humanSnapshots = 0, artifactDownloads = 0;
let deferredHumanAction = null;
const json = (response, data, status = 200) => {
  response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(data));
};
const image = response => {
  response.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'private, no-store'});
  response.end(png);
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture.test');
    requests.push({path: url.pathname, query: url.search, method: request.method});
    const parts = url.pathname.split('/').filter(Boolean);
    let body = null;
    if (request.method === 'POST' || request.method === 'DELETE') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      body = text ? JSON.parse(text) : null;
      mutations.push({path: url.pathname, method: request.method, body});
    }
    if (url.pathname === '/api/browser' && request.method === 'GET') {
      json(response, {readiness: {ready, reasons: ready ? [] : ['staging', 'pricingValidated'], limits: {maxActions: 40, maxSeconds: 300, humanWaitSeconds: 180}}, sessions, profiles});
      return;
    }
    if (url.pathname === '/api/browser/profiles' && request.method === 'GET') { json(response, {profiles}); return; }
    if (url.pathname.startsWith('/api/browser/profiles/') && request.method === 'DELETE') {
      profiles = profiles.filter(profile => profile.id !== parts[3]);
      json(response, {deleted: true}); return;
    }
    if (url.pathname === '/api/browser/sessions' && request.method === 'POST') {
      sessions = [makeSession({objective: body.objective, allowedDomains: body.allowedDomains, maxCredits: body.maxCredits, profileId: body.profileId || null})];
      json(response, sessions[0]); return;
    }
    if (parts[0] === 'api' && parts[1] === 'browser' && parts[2] === 'sessions' && parts[3] === 'session-fixture') {
      if (parts.length === 4 && request.method === 'GET') { json(response, sessions[0]); return; }
      if(parts[4]==='view'){response.writeHead(200,{'content-type':'image/png','cache-control':'private, no-store'});response.end(png);return;}
      if (parts[4] === 'events') {
        const after = Number(url.searchParams.get('after') || 0);
        const events = after < 7 ? [{seq: 7, type: 'fixture_event', status: sessions[0].status, domain: 'example.com', createdAt: now}] : [];
        json(response, {events, cursor: 7}); return;
      }
      if (parts[4] === 'activate' && request.method === 'POST') {
        assert.equal(ready, true, 'Unready browser must never activate');
        assert.deepEqual(body, {approved: true, version: sessions[0].version});
        sessions = [makeSession({...sessions[0], status: 'running', version: sessions[0].version + 1, url: observation.url, title: observation.title, tabs: observation.tabs, observation})];
        json(response, sessions[0]); return;
      }
      if (parts[4] === 'actions' && parts.length === 6 && request.method === 'POST') {
        assert.equal(body.version, sessions[0].pendingAction.version);
        assert.equal(parts[5], sessions[0].pendingAction.id);
        assert.ok(['approve', 'reject'].includes(body.decision));
        if (body.decision === 'approve') assert.equal(body.approved, true);
        sessions = [makeSession({...sessions[0], status: 'running', version: sessions[0].version + 1, pendingAction: null})];
        json(response, sessions[0]); return;
      }
      if (parts[4] === 'actions' && parts.length === 5 && request.method === 'POST') {
        assert.equal(body.human, true, 'Human commands need an explicit top-level human gate');
        assert.equal(sessions[0].control, 'human');
        assert.ok(['pointer', 'type'].includes(body.command.kind));
        if (deferredHumanAction) {
          const release = deferredHumanAction;
          deferredHumanAction = null;
          release(() => json(response, sessions[0]));
        } else json(response, sessions[0]);
        return;
      }
      if (parts[4] === 'control' && request.method === 'POST') {
        assert.equal(body.version, sessions[0].version);
        if (body.action === 'remember') {
          assert.equal(body.consent, true);
          profiles = [{id: 'profile-fixture', name: body.name, updatedAt: now, expiresAt: now + 30 * 86_400_000}];
          json(response, {profile: profiles[0], session: sessions[0]}); return;
        }
        const human = body.action === 'takeover';
        if (body.action === 'confirm_result') assert.equal(body.approved, true);
        const status = body.action === 'confirm_result' ? 'completed' : body.action === 'stop' ? 'cancelled' : human ? 'awaiting_login' : body.action === 'pause' ? 'paused' : 'running';
        sessions = [makeSession({...sessions[0], status, version: sessions[0].version + 1, control: human ? 'human' : 'agent', observation: human || status === 'cancelled' ? null : observation, captureId: null, tabs: human ? [] : observation.tabs})];
        json(response, sessions[0]); return;
      }
      if (parts[4] === 'snapshot') {
        if (url.searchParams.get('human') === '1') {
          assert.equal(sessions[0].control, 'human'); humanSnapshots++; image(response);
        } else {
          assert.equal(sessions[0].control, 'agent'); agentSnapshots++;
          sessions[0].captureId = artifact.id;
          json(response, {artifact, captureId: artifact.id});
        }
        return;
      }
      if (parts[4] === 'artifacts' && parts.length === 5) { json(response, {artifacts: [artifact]}); return; }
      if (parts[4] === 'artifacts' && parts[5] === artifact.id && (parts.length === 6 || parts[6] === 'download')) {
        assert.equal(sessions[0].control, 'agent'); artifactDownloads++; image(response); return;
      }
    }
    if (url.pathname.startsWith('/api/')) { unknownAPI.push(url.pathname); json(response, {error: 'Unexpected fixture API'}, 404); return; }
    if (url.pathname === '/app.js' || url.pathname === '/app.css') {
      response.writeHead(200, {'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript'});
      response.end(await readFile(path.join(output, url.pathname.slice(1)))); return;
    }
    response.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'});
    response.end('<!doctype html><html lang="fr" data-design-system="muse"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Navigateur · Test local</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  } catch (error) {
    fixtureErrors.push(String(error));
    json(response, {error: 'Fixture assertion failed'}, 500);
  }
});
const fixtureErrors = [];
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const checks = [], pageErrors = [], externalRequests = [];
let browser, page;
try {
  try { browser = await chromium.launch({headless: true}); }
  catch { browser = await chromium.launch({headless: true, channel: 'msedge'}); }
  const context = await browser.newContext({viewport: {width: 1100, height: 900}});
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__browserStorageWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      window.__browserStorageWrites.push({key, value});
      return original.call(this, key, value);
    };
  });
  const reload = async () => {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/browser');
    await page.goto(origin);
    await loaded;
    await page.getByRole('heading', {name: 'Navigateur', exact: true}).waitFor();
  };
  const mutationCount = suffix => mutations.filter(request => request.path.endsWith(suffix)).length;
  const capture = name => page.screenshot({path: path.join(output, name), fullPage: true});
  const idle = () => page.locator('section[aria-label="Navigateur privé"][aria-busy="false"]').waitFor();
  const submit = async (button, suffix, method = 'POST') => {
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(suffix) && response.request().method() === method);
    await button.click();
    await response;
    await idle();
  };

  // Scenarios are deliberately separate mounts so the fixture always supplies
  // authoritative versions, including approval versions different from sessions.
  await reload();
  const activate = page.getByRole('button', {name: 'Activer la session', exact: true});
  await activate.waitFor();
  assert.equal(await activate.isDisabled(), true);
  assert.equal(mutationCount('/activate'), 0);
  await capture('not-ready-desktop.png');
  checks.push('Readiness failure disables activation and makes no paid request');

  ready = true; sessions = [];
  await reload();
  await page.getByRole('button', {name: 'Nouvelle session', exact: true}).click();
  await page.getByLabel('Objectif', {exact: true}).fill('Comparer les informations publiques de test');
  await page.getByLabel('Domaines autorisés', {exact: true}).fill('example.com');
  await page.getByLabel('Plafond de crédits', {exact: true}).fill('12');
  await submit(page.getByRole('button', {name: 'Créer le brouillon', exact: true}), '/sessions');
  await activate.waitFor();
  const created = mutations.find(request => request.path === '/api/browser/sessions');
  assert.deepEqual(created.body, {objective: 'Comparer les informations publiques de test', allowedDomains: ['example.com'], maxCredits: 12, conversationId: 'conversation-browser-fixture', profileId: null});
  assert.equal(mutationCount('/activate'), 0);
  checks.push('Draft creation attaches the conversation and domain/budget limits without activation');

  await activate.click();
  const confirm = page.getByRole('button', {name: 'Confirmer l’activation', exact: true});
  await confirm.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  assert.equal(mutationCount('/activate'), 0);
  await page.getByRole('checkbox', {name: /J’autorise cette session/}).check();
  await submit(confirm, '/activate');
  await page.getByRole('button', {name: 'Arrêter la session', exact: true}).waitFor();
  assert.deepEqual(mutations.find(request => request.path.endsWith('/activate')).body, {approved: true, version: 4});
  assert.equal(mutationCount('/activate'), 1);
  checks.push('Activation requires a separate explicit consent and submits the current version exactly once');

  const approvalCommand = {kind: 'fill', pageId: observation.pageId, observationId: observation.id, targetRef: 'e1_fixture', value: 'Texte public de test'};
  sessions = [makeSession({status: 'awaiting_approval', version: 20, url: observation.url, title: observation.title, tabs: observation.tabs,
    observation, pendingAction: makePending('approval-fixture', 9, approvalCommand)})];
  await reload();
  await page.getByText('Renseigner le champ « Message public »', {exact: true}).waitFor();
  await page.getByText('Détails exacts de la demande', {exact: true}).click();
  const pendingText = await page.locator('body').innerText();
  for (const exactArgument of ['fill', observation.id, observation.pageId, 'e1_fixture', 'Texte public de test']) {
    assert.ok(pendingText.includes(exactArgument), 'Approval must show the exact command argument: ' + exactArgument);
  }
  await capture('approval-desktop.png');
  await submit(page.getByRole('button', {name: 'Approuver cette action', exact: true}), '/actions/approval-fixture');
  await page.getByRole('button', {name: 'Arrêter la session', exact: true}).waitFor();
  assert.deepEqual(mutations.find(request => request.path.endsWith('/actions/approval-fixture')).body,
    {decision: 'approve', version: 9, approved: true});
  checks.push('Approval shows exact command arguments and sends action version with explicit approval');

  sessions = [makeSession({status: 'awaiting_approval', version: 30, url: observation.url, title: observation.title, tabs: observation.tabs,
    observation, pendingAction: makePending('rejection-fixture', 11, {kind: 'click', pageId: observation.pageId, observationId: observation.id, targetRef: 'e1_fixture'})})];
  await reload();
  await submit(page.getByRole('button', {name: 'Refuser', exact: true}), '/actions/rejection-fixture');
  await page.getByRole('button', {name: 'Arrêter la session', exact: true}).waitFor();
  const rejected = mutations.find(request => request.path.endsWith('/actions/rejection-fixture')).body;
  assert.equal(rejected.decision, 'reject');
  assert.equal(rejected.version, 11);
  assert.notEqual(rejected.approved, true);
  checks.push('Rejection resolves only the pending action using its own version');

  sessions = [makeSession({status: 'running', version: 40, url: observation.url, title: observation.title, tabs: observation.tabs, observation})];
  await reload();
  const screenshot = page.getByRole('button', {name: 'Actualiser la vue', exact: true});
  await submit(screenshot, '/snapshot', 'GET');
  await page.getByAltText('Capture privée de la page', {exact: true}).waitFor();
  await page.waitForFunction(() => Array.from(document.images).some(image => image.complete && image.naturalWidth > 0));
  assert.ok(agentSnapshots >= 1);
  assert.ok(artifactDownloads >= 1, 'Agent JSON snapshot must be followed by the authorized artifact image endpoint');
  await capture('running-desktop.png');
  checks.push('Agent snapshots use capture metadata then fetch the authorized artifact bytes');
  await page.getByRole('button',{name:'Suivre en direct',exact:true}).click();
  await page.waitForResponse(response=>response.url().includes('/view?')&&response.status()===200);
  await page.getByRole('button',{name:'Suspendre la vue en direct',exact:true}).click();
  checks.push('Live view uses authenticated private frames and can be suspended');

  await page.getByText('Mémoriser la connexion', {exact: true}).click();
  await page.getByLabel('Nom du profil', {exact: true}).fill('Compte privé de test');
  const rememberCount = mutationCount('/control');
  await page.getByRole('button', {name: 'Enregistrer le profil', exact: true}).click();
  assert.equal(mutationCount('/control'), rememberCount, 'Profile retention requires consent');
  await page.getByRole('checkbox', {name: 'Je souhaite conserver ma connexion dans un profil privé.', exact: true}).check();
  await submit(page.getByRole('button', {name: 'Enregistrer le profil', exact: true}), '/control');
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body,
    {action: 'remember', version: 40, name: 'Compte privé de test', consent: true});
  await page.getByText('Mes profils privés (1)', {exact: true}).click();
  await page.getByRole('button', {name: 'Supprimer le profil Compte privé de test', exact: true}).click();
  assert.equal(mutations.filter(request => request.method === 'DELETE').length, 0, 'Profile deletion needs its explicit second step');
  const deleted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/browser/profiles/profile-fixture' && response.request().method() === 'DELETE');
  await page.getByRole('button', {name: 'Confirmer la suppression', exact: true}).click();
  await deleted; await idle();
  assert.equal(profiles.length, 0);
  checks.push('Private profile retention requires named consent and deletion requires a separate confirmation');

  // Advance only the UI clock; the fixture still records actual HTTP requests.
  // This proves polling carries its cursor without a real five-second sleep.
  await page.clock.install();
  const eventPoll = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/events') && new URL(response.url()).searchParams.get('after') === '7');
  const overviewPoll = page.waitForResponse(response => new URL(response.url()).pathname === '/api/browser');
  await page.clock.fastForward(5_001);
  await Promise.all([eventPoll, overviewPoll]);
  checks.push('Session polling refreshes the overview and advances the event cursor');

  const pause = page.getByRole('button', {name: /Mettre en pause/});
  await submit(pause, '/control');
  await page.getByRole('button', {name: /Reprendre la session/}).waitFor();
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body, {action: 'pause', version: 40});
  await submit(page.getByRole('button', {name: 'Reprendre la session', exact: true}), '/control');
  await pause.waitFor();
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body, {action: 'resume', version: 41});
  checks.push('Pause and resume send the latest session version');

  await submit(page.getByRole('button', {name: 'Prendre le contrôle', exact: true}), '/control');
  await page.getByRole('button', {name: /Rendre le contrôle/}).waitFor();
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body, {action: 'takeover', version: 42});
  const agentSnapshotsBeforeHuman = agentSnapshots;
  await screenshot.click();
  await page.waitForFunction(() => Array.from(document.images).some(image => image.complete && image.naturalWidth > 0));
  assert.ok(humanSnapshots >= 1);
  assert.equal(agentSnapshots, agentSnapshotsBeforeHuman);
  const humanActionsBeforePoint = mutationCount('/actions');
  await page.getByAltText('Vue privée de la page sous contrôle humain', {exact: true}).click({position: {x: 10, y: 10}});
  assert.equal(mutationCount('/actions'), humanActionsBeforePoint, 'Selecting screenshot coordinates must not immediately click the remote page');
  await page.getByLabel('Point horizontal', {exact: true}).fill('24');
  await page.getByLabel('Point vertical', {exact: true}).fill('48');
  await submit(page.getByRole('button', {name: 'Cliquer dans la page', exact: true}), '/actions');
  const pointer = mutations.filter(request => request.path.endsWith('/actions')).at(-1).body;
  assert.equal(pointer.human, true);
  assert.equal(pointer.command.kind, 'pointer');
  assert.equal(pointer.command.x, 24);
  assert.equal(pointer.command.y, 48);

  const privateInput = page.getByLabel('Texte à saisir', {exact: true});
  await privateInput.waitFor();
  assert.equal(await privateInput.getAttribute('type'), 'password');
  const secret = 'fixture-private-code-486219';
  await privateInput.fill(secret);
  const capturedHumanAction = new Promise(resolve => { deferredHumanAction = resolve; });
  await page.getByRole('button', {name: 'Saisir dans la page', exact: true}).click();
  const releaseHumanAction = await capturedHumanAction;
  assert.equal(await privateInput.inputValue(), '', 'Private input must clear while its network request is still pending');
  const typed = mutations.filter(request => request.path.endsWith('/actions')).at(-1).body;
  assert.equal(typed.human, true);
  assert.equal(typed.command.kind, 'type');
  assert.equal(typed.command.value, secret);
  assert.equal((await page.locator('body').innerText()).includes(secret), false);
  assert.deepEqual(await page.evaluate(() => window.__browserStorageWrites), []);
  releaseHumanAction();
  await idle();
  await capture('human-control-desktop.png');
  checks.push('Human mode uses direct image snapshots and explicit pointer/type commands, clearing private text before response without browser storage');

  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Human controls must fit a 390px viewport');
  for (const name of ['Rendre le contrôle à Braand', 'Arrêter la session', 'Cliquer dans la page', 'Saisir dans la page']) {
    const button = page.getByRole('button', {name, exact: true});
    const bounds = await button.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44, 'Mobile controls need usable touch targets: ' + name);
    assert.equal(await button.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  }
  await capture('human-control-mobile.png');
  await submit(page.getByRole('button', {name: 'Rendre le contrôle à Braand', exact: true}), '/control');
  await page.getByRole('button', {name: /Prendre le contrôle/}).waitFor();
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body, {action: 'return', version: 43});
  assert.equal(await privateInput.count(), 0);
  checks.push('Returning control clears the private form and sends the current session version');

  await submit(page.getByRole('button', {name: 'Arrêter la session', exact: true}), '/control');
  await page.getByText('Arrêtée', {exact: true}).waitFor();
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body, {action: 'stop', version: 44});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Stopped state must fit a 390px viewport');
  await capture('stopped-mobile.png');
  checks.push('Stop uses the current session version and the mobile session has no horizontal overflow');

  const controlsBeforeResult = mutationCount('/control');
  sessions = [makeSession({status: 'paused', version: 60, url: observation.url, title: observation.title, tabs: observation.tabs,
    observation, resultReview: {summary: 'Les informations publiques ont été comparées. Vérifiez la page avant de terminer.', proposedAt: now}})];
  await reload();
  const resultConfirmation = page.getByRole('button', {name: 'Confirmer le résultat', exact: true});
  await resultConfirmation.waitFor();
  assert.equal(await resultConfirmation.isDisabled(), true);
  assert.equal(mutationCount('/control'), controlsBeforeResult, 'Displaying a proposed result must not confirm completion automatically');
  await page.getByRole('checkbox', {name: 'J’ai vérifié le résultat dans la page.', exact: true}).check();
  await submit(resultConfirmation, '/control');
  assert.deepEqual(mutations.filter(request => request.path.endsWith('/control')).at(-1).body,
    {action: 'confirm_result', version: 60, approved: true});
  await page.getByText('Terminée', {exact: true}).waitFor();
  checks.push('A proposed result becomes complete only after explicit verified-result consent');

  assert.deepEqual(unknownAPI, []);
  assert.deepEqual(fixtureErrors, []);
  assert.deepEqual(pageErrors, []);
  assert.ok(externalRequests.every(url => new URL(url).hostname === 'fonts.googleapis.com'), 'Unexpected external request attempted');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({checks, mutations: mutations.map(({path, method}) => ({path, method})), agentSnapshots, humanSnapshots, artifactDownloads, blockedExternalRequests: externalRequests.length, externalProviderCalls: 0}, null, 2));
  for (const check of checks) console.log('PASS ' + check);
} catch (error) {
  if (page) {
    await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 1800));
  }
  console.error(JSON.stringify({pageErrors, fixtureErrors, unknownAPI, requests: requests.map(request => request.path)}, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
