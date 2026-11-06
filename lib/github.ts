// Read any GitHub repository: public ones directly, private ones with the
// user's own GitHub connection. Read-only here; the token never leaves the
// server (not to the browser, the model or the sandbox).
import {AppError} from './core.mjs';
import {config, db, seal, unseal} from './server';
import {envKeys, isTextPath, parseRepoUrl, projectPlan} from './github-core.mjs';

const API = 'https://api.github.com', MAX_FILE = 60_000, MAX_TREE = 2000;
type Target = {owner: string; repo: string; ref: string | null; path: string};

export function repoTarget(value: string): Target {
 const target = parseRepoUrl(value);
 if (!target) throw new AppError('Lien GitHub non reconnu. Exemple : https://github.com/proprietaire/depot', 400, 'github_link_invalid');
 return target;
}

// ——— The user's own GitHub connection (private repositories, pull requests) ———
export const GITHUB_CONNECTION_SCHEMA = 'CREATE TABLE IF NOT EXISTS github_connections(user_id TEXT PRIMARY KEY,login TEXT NOT NULL,token TEXT NOT NULL,scopes TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)';
export async function githubToken(userId?: string | null) {
 if (!userId) return null;
 await db().prepare(GITHUB_CONNECTION_SCHEMA).run().catch(() => undefined);
 const row = await db().prepare('SELECT token FROM github_connections WHERE user_id=?').bind(userId).first<{token: string}>().catch(() => null);
 if (!row) return null;
 try {return await unseal(row.token);} catch {return null;}
}
export async function githubConnection(userId: string) {
 await db().prepare(GITHUB_CONNECTION_SCHEMA).run().catch(() => undefined);
 return db().prepare('SELECT login,scopes,created_at,updated_at FROM github_connections WHERE user_id=?').bind(userId).first<{login: string; scopes: string; created_at: number; updated_at: number}>();
}
export async function saveGithubConnection(userId: string, login: string, token: string, scopes: string) {
 await db().prepare(GITHUB_CONNECTION_SCHEMA).run();
 const now = Date.now(), sealed = await seal(token);
 await db().prepare('INSERT INTO github_connections(user_id,login,token,scopes,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET login=excluded.login,token=excluded.token,scopes=excluded.scopes,updated_at=excluded.updated_at').bind(userId, login, sealed, scopes, now, now).run();
}
export async function removeGithubConnection(userId: string) {
 await db().prepare(GITHUB_CONNECTION_SCHEMA).run().catch(() => undefined);
 await db().prepare('DELETE FROM github_connections WHERE user_id=?').bind(userId).run();
}
export function githubOAuthReady() {const c = config() as Record<string, unknown>;return typeof c.GITHUB_CLIENT_ID === 'string' && !!c.GITHUB_CLIENT_ID && typeof c.GITHUB_CLIENT_SECRET === 'string' && !!c.GITHUB_CLIENT_SECRET;}

// ——— REST calls ———
export async function githubRequest<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
 const headers: Record<string, string> = {Accept: 'application/vnd.github+json', 'User-Agent': 'Braand', 'X-GitHub-Api-Version': '2022-11-28'};
 const serverToken = (config() as Record<string, unknown>).GITHUB_READ_TOKEN;
 const auth = token || (typeof serverToken === 'string' && serverToken ? serverToken : null);
 if (auth) headers.Authorization = 'Bearer ' + auth;
 let response: Response;
 try {response = await fetch(API + path, {...init, headers: {...headers, ...(init.headers as Record<string, string> || {})}, signal: AbortSignal.timeout(12000)});}
 catch {throw new AppError('GitHub ne répond pas pour le moment. Réessayez dans un instant.', 503, 'github_unavailable');}
 if (response.status === 404) {await response.body?.cancel();throw new AppError(token ? 'Dépôt ou fichier introuvable, ou votre compte GitHub n’y a pas accès.' : 'Dépôt introuvable ou privé. Pour un dépôt privé, connectez votre compte GitHub dans Paramètres › Connexions.', 404, token ? 'github_not_found' : 'github_private_or_missing');}
 if (response.status === 401) {await response.body?.cancel();throw new AppError('La connexion GitHub a expiré. Reconnectez votre compte dans Paramètres › Connexions.', 401, 'github_reconnect');}
 if (response.status === 403 || response.status === 429) {await response.body?.cancel();throw new AppError('Trop de lectures GitHub en peu de temps. Réessayez dans quelques minutes, ou connectez votre compte GitHub pour lever cette limite.', 429, 'github_rate_limited');}
 if (!response.ok) {await response.body?.cancel();throw new AppError('GitHub a refusé la demande.', 502, 'github_failed');}
 return response.json() as Promise<T>;
}

type Repo = {full_name: string; private: boolean; description: string | null; default_branch: string; language: string | null; stargazers_count: number; pushed_at: string; html_url: string; size: number};
type TreeEntry = {path: string; type: 'blob' | 'tree'; size?: number};
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

async function repoMeta(t: Target, token: string | null) {return githubRequest<Repo>(`/repos/${t.owner}/${t.repo}`, token);}
async function repoTree(t: Target, ref: string, token: string | null) {
 const tree = await githubRequest<{tree: TreeEntry[]; truncated: boolean}>(`/repos/${t.owner}/${t.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
 const files = tree.tree.filter(e => !/(^|\/)(node_modules|\.git|dist|build|\.next|vendor)\//.test(e.path));
 return {entries: files.slice(0, MAX_TREE), total: files.length, truncated: tree.truncated || files.length > MAX_TREE};
}
async function fileText(t: Target, path: string, ref: string, token: string | null) {
 const file = await githubRequest<{type: string; encoding?: string; content?: string; size: number}>(`/repos/${t.owner}/${t.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, token);
 if (file.type !== 'file') throw new AppError('Ce chemin est un dossier : utilisez action tree avec ce chemin.', 400, 'github_not_a_file');
 if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new AppError('Fichier trop volumineux pour être lu ici (plus de 1 Mo).', 413, 'github_file_too_large');
 const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
 if (bytes.slice(0, 8000).includes(0)) throw new AppError('Fichier binaire : il ne se lit pas comme du texte.', 415, 'github_binary');
 return new TextDecoder().decode(bytes);
}

/** What the project is and how to run it: stack, scripts, keys it needs, README start. */
export async function repoOverview(value: string, token: string | null) {
 const t = repoTarget(value), meta = await repoMeta(t, token), ref = t.ref || meta.default_branch;
 const tree = await repoTree(t, ref, token), paths = tree.entries.filter(e => e.type === 'blob').map(e => e.path);
 const read = async (path: string) => paths.includes(path) ? fileText(t, path, ref, token).catch(() => null) : null;
 const envFile = ['.env.example', '.env.sample', '.env.local.example', '.env.template'].find(p => paths.includes(p));
 const [pkgText, env, readme] = await Promise.all([read('package.json'), envFile ? read(envFile) : null, read(paths.find(p => /^readme(\.md)?$/i.test(p)) || '')]);
 let pkg: Record<string, unknown> | null = null;try {pkg = pkgText ? JSON.parse(pkgText) : null;} catch {pkg = null;}
 const topLevel = [...new Set(paths.map(p => p.split('/')[0]))].slice(0, 60);
 return {
  repo: meta.full_name, url: meta.html_url, private: meta.private, description: meta.description, language: meta.language, ref, stars: meta.stargazers_count, lastPush: meta.pushed_at,
  files: tree.total, truncated: tree.truncated, topLevel,
  plan: projectPlan(paths, pkg), env: envFile ? {file: envFile, keys: envKeys(env || '')} : null,
  readme: readme ? readme.slice(0, 4000) : null,
  note: 'Lis les fichiers utiles avec action read (path), cherche avec action search. Ne prétends jamais ne voir que la page du dépôt.',
 };
}

export async function repoFiles(value: string, token: string | null, path = '', ref?: string | null) {
 const t = repoTarget(value), meta = await repoMeta(t, token), useRef = ref || t.ref || meta.default_branch;
 const tree = await repoTree(t, useRef, token), prefix = (path || t.path).replace(/^\/|\/$/g, '');
 const entries = tree.entries.filter(e => !prefix || e.path === prefix || e.path.startsWith(prefix + '/'));
 return {repo: meta.full_name, ref: useRef, path: prefix, count: entries.length, truncated: tree.truncated || entries.length > 400, entries: entries.slice(0, 400).map(e => ({path: e.path, type: e.type === 'tree' ? 'dir' : 'file', size: e.size ?? null}))};
}

export async function repoRead(value: string, token: string | null, path: string, ref?: string | null, offset = 0) {
 const t = repoTarget(value), useRef = ref || t.ref || (await repoMeta(t, token)).default_branch;
 const clean = path.replace(/^\/+/, '');
 if (!clean || clean.includes('..')) throw new AppError('Chemin de fichier invalide.', 400, 'github_path_invalid');
 const text = await fileText(t, clean, useRef, token), slice = text.slice(offset, offset + MAX_FILE);
 return {repo: `${t.owner}/${t.repo}`, ref: useRef, path: clean, size: text.length, offset, content: slice, nextOffset: offset + slice.length < text.length ? offset + slice.length : null};
}

/** Files whose path matches the query, and lines that contain it in up to 12 small text files. */
export async function repoSearch(value: string, token: string | null, query: string, ref?: string | null) {
 const t = repoTarget(value), useRef = ref || t.ref || (await repoMeta(t, token)).default_branch;
 const q = query.trim().toLowerCase();if (q.length < 2) throw new AppError('Recherche trop courte.', 400, 'github_query_short');
 const tree = await repoTree(t, useRef, token), files = tree.entries.filter(e => e.type === 'blob');
 const byPath = files.filter(e => e.path.toLowerCase().includes(q)).slice(0, 40).map(e => e.path);
 const candidates = files.filter(e => isTextPath(e.path) && (e.size ?? 0) < 60_000 && !/lock|\.min\./.test(e.path)).sort((a, b) => Number(/^(src|app|lib|pages|components)\//.test(b.path)) - Number(/^(src|app|lib|pages|components)\//.test(a.path))).slice(0, token ? 40 : 12);
 const matches: {path: string; line: number; text: string}[] = [];
 for (const file of candidates) {
  const text = await fileText(t, file.path, useRef, token).catch(() => '');
  text.split('\n').forEach((line, i) => {if (matches.length < 60 && line.toLowerCase().includes(q)) matches.push({path: file.path, line: i + 1, text: line.trim().slice(0, 200)});});
 }
 return {repo: `${t.owner}/${t.repo}`, ref: useRef, query, pathMatches: byPath, lineMatches: matches, scannedFiles: candidates.length, note: candidates.length < files.length ? 'Recherche dans le contenu limitée aux fichiers principaux ; lisez un fichier précis avec action read.' : undefined};
}
