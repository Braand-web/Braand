// GitHub repositories, pure helpers: understand a repository link, summarise
// a project from its files (stack, scripts, how to run it, keys it needs).

/**
 * Accepts https://github.com/o/r(.git), …/tree/<ref>/<path>, …/blob/<ref>/<path>,
 * git@github.com:o/r.git and "o/r". Returns null for anything else.
 * @param {string} value
 * @returns {{owner:string,repo:string,ref:string|null,path:string}|null}
 */
export function parseRepoUrl(value) {
  const text = String(value || '').trim();
  const name = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
  const repoName = '[A-Za-z0-9._-]{1,100}';
  let m = text.match(new RegExp(`^git@github\\.com:(${name})/(${repoName}?)(?:\\.git)?$`));
  if (m) return {owner: m[1], repo: m[2].replace(/\.git$/, ''), ref: null, path: ''};
  m = text.match(new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${name})/(${repoName})(?:/(?:tree|blob)/([^/?#]+)(?:/([^?#]*))?)?/?(?:[?#].*)?$`));
  if (m) return {owner: m[1], repo: m[2].replace(/\.git$/, ''), ref: m[3] ? decodeURIComponent(m[3]) : null, path: m[4] ? decodeURIComponent(m[4]).replace(/\/$/, '') : ''};
  m = text.match(new RegExp(`^(${name})/(${repoName})$`));
  if (m && !m[2].includes('..')) return {owner: m[1], repo: m[2].replace(/\.git$/, ''), ref: null, path: ''};
  return null;
}

/** Keys an application expects, from .env.example (names only, never values). */
export function envKeys(text) {
  const keys = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{1,80})\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    keys.push({name: m[1], hasDefault: value !== '' && !/^(your|change|xxx|<|sk-|replace)/i.test(value), public: /^(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)/.test(m[1])});
  }
  return keys;
}

const FRAMEWORKS = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@remix-run/react', 'Remix'], ['astro', 'Astro'], ['@sveltejs/kit', 'SvelteKit'],
  ['vite', 'Vite'], ['react-scripts', 'Create React App'], ['@angular/core', 'Angular'], ['vue', 'Vue'], ['express', 'Express'],
  ['hono', 'Hono'], ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'],
];

/**
 * How to run a project, from its file list and package.json.
 * @param {string[]} paths
 * @param {Record<string, any>|null} pkg
 */
export function projectPlan(paths, pkg) {
  const has = name => paths.includes(name);
  const manager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : has('package-lock.json') || pkg ? 'npm' : null;
  const deps = {...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {})};
  const framework = FRAMEWORKS.find(([dep]) => dep in deps)?.[1] || (has('index.html') ? 'Site statique' : has('requirements.txt') || has('pyproject.toml') ? 'Python' : null);
  const scripts = pkg?.scripts || {};
  const script = ['dev', 'start', 'serve', 'preview'].find(name => typeof scripts[name] === 'string') || null;
  const run = manager === 'npm' ? 'npm run' : manager;
  const install = manager === 'npm' ? (has('package-lock.json') ? 'npm ci' : 'npm install') : manager === 'pnpm' ? 'pnpm install --frozen-lockfile' : manager === 'yarn' ? 'yarn install --frozen-lockfile' : manager === 'bun' ? 'bun install' : null;
  const port = /next|nuxt|remix|create react app|express|nestjs|hono|fastify/i.test(framework || '') ? 3000 : /vite|vue|sveltekit|astro/i.test(framework || '') ? 5173 : /angular/i.test(framework || '') ? 4200 : 3000;
  const database = ['prisma', 'drizzle-orm', '@supabase/supabase-js', 'mongoose', 'pg', 'mysql2', 'better-sqlite3', 'typeorm', 'sequelize'].filter(dep => dep in deps);
  return {
    manager, framework, install,
    dev: script && run ? `${run} ${script}` : framework === 'Site statique' ? 'npx --yes serve -l 3000 .' : null,
    port: framework === 'Site statique' ? 3000 : port,
    scripts: Object.fromEntries(Object.entries(scripts).slice(0, 20)),
    database, docker: has('Dockerfile') || has('docker-compose.yml') || has('compose.yaml'),
    monorepo: has('pnpm-workspace.yaml') || has('turbo.json') || has('lerna.json') || Array.isArray(pkg?.workspaces),
  };
}

const TEXT = /\.(?:[cm]?[jt]sx?|json|md|mdx|txt|ya?ml|toml|css|scss|html?|vue|svelte|astro|py|rb|go|rs|java|kt|php|sql|prisma|sh|env\.example|example|gitignore|dockerfile)$/i;
export function isTextPath(path) {return TEXT.test(path) || /(^|\/)(Dockerfile|Makefile|README|LICENSE|\.env\.example|\.env\.sample)$/i.test(path);}
