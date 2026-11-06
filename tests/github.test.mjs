import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRepoUrl, envKeys, projectPlan, isTextPath} from '../lib/github-core.mjs';

test('repository links in every usual form', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/Braand-web/Nv-MULTI-MODELES.git'), {owner: 'Braand-web', repo: 'Nv-MULTI-MODELES', ref: null, path: ''});
  assert.deepEqual(parseRepoUrl('github.com/vercel/next.js/tree/canary/packages/next'), {owner: 'vercel', repo: 'next.js', ref: 'canary', path: 'packages/next'});
  assert.deepEqual(parseRepoUrl('https://github.com/o/r/blob/main/src/app.ts?plain=1'), {owner: 'o', repo: 'r', ref: 'main', path: 'src/app.ts'});
  assert.deepEqual(parseRepoUrl('git@github.com:o/r.git'), {owner: 'o', repo: 'r', ref: null, path: ''});
  assert.deepEqual(parseRepoUrl('Braand-web/braand'), {owner: 'Braand-web', repo: 'braand', ref: null, path: ''});
  for (const bad of ['https://gitlab.com/o/r', 'https://github.com/o', 'not a link', 'o/../r', '']) assert.equal(parseRepoUrl(bad), null, bad);
});

test('keys an app needs come from .env.example, names only', () => {
  const keys = envKeys('# Base\nDATABASE_URL=\nNEXT_PUBLIC_APP_URL=http://localhost:3000\nexport OPENAI_API_KEY="sk-..."\nAUTH_SECRET=your-secret\nnot a key\n');
  assert.deepEqual(keys.map(k => [k.name, k.hasDefault, k.public]), [['DATABASE_URL', false, false], ['NEXT_PUBLIC_APP_URL', true, true], ['OPENAI_API_KEY', false, false], ['AUTH_SECRET', false, false]]);
});

test('how to run a project: manager, framework, install and dev commands, port', () => {
  const next = projectPlan(['package.json', 'pnpm-lock.yaml', '.env.example'], {scripts: {dev: 'next dev', build: 'next build', 'db:migrate': 'drizzle-kit migrate'}, dependencies: {next: '15', 'drizzle-orm': '0.4', pg: '8'}});
  assert.deepEqual({m: next.manager, f: next.framework, i: next.install, d: next.dev, p: next.port, db: next.database}, {m: 'pnpm', f: 'Next.js', i: 'pnpm install --frozen-lockfile', d: 'pnpm dev', p: 3000, db: ['drizzle-orm', 'pg']});
  const vite = projectPlan(['package.json', 'package-lock.json'], {scripts: {dev: 'vite'}, devDependencies: {vite: '6'}});
  assert.deepEqual([vite.manager, vite.install, vite.dev, vite.port], ['npm', 'npm ci', 'npm run dev', 5173]);
  const site = projectPlan(['index.html', 'style.css'], null);
  assert.deepEqual([site.framework, site.dev, site.port], ['Site statique', 'npx --yes serve -l 3000 .', 3000]);
  assert.equal(projectPlan(['package.json', 'pnpm-workspace.yaml'], {}).monorepo, true);
  assert.equal(isTextPath('src/app/page.tsx'), true);assert.equal(isTextPath('public/logo.png'), false);assert.equal(isTextPath('.env.example'), true);
});
