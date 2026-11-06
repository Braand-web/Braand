// Changes Braand made to a GitHub project in this conversation's sandbox are
// proposed as a pull request: the user sees exactly which files change, and
// nothing is pushed before they approve. The approval is bound to a
// fingerprint of the changes, so what is pushed is what was shown.
import {z} from 'zod';
import {AppError} from './core.mjs';
import {auditLog, config, createResource, getResource, updateResource} from './server';
import {codeSandboxReady, codeSandboxSession, runCodeSandboxTool} from './code-sandbox';
import {githubRequest, githubToken} from './github';
import {parseRepoUrl} from './github-core.mjs';

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
type Change = {path: string; status: string; added: number; removed: number};
type ProposalData = {repo: string; dir: string; conversationId: string; branch: string; title: string; description: string; files: Change[]; fingerprint: string; defaultBranch?: string; prUrl?: string; error?: string};

async function sandboxRun(tenant: string, conversationId: string, command: string, timeoutSeconds = 60) {
 const env = config() as unknown as Record<string, unknown>;
 if (!codeSandboxReady(env)) throw new AppError('L’environnement de code n’est pas disponible pour le moment.', 503, 'sandbox_unavailable');
 const session = await codeSandboxSession(tenant, conversationId);
 return runCodeSandboxTool(env, session, 'code_run', {command, timeoutSeconds}) as Promise<{exitCode?: number; stdout?: string}>;
}

/** Fingerprint of the working tree changes (tracked diff + untracked file list). */
const FINGERPRINT = "{ git diff HEAD; git ls-files --others --exclude-standard; } | sha256sum | cut -c1-64";

export const proposeInput = z.object({dir: z.string().min(1).max(300), title: z.string().trim().min(4).max(120), description: z.string().trim().max(4000).optional()}).strict();

export async function proposeChanges(tenant: string, conversationId: string, raw: unknown) {
 const p = proposeInput.parse(raw);
 if (!/^\/workspace\/[\w./-]+$/.test(p.dir) || p.dir.includes('..')) throw new AppError('Dossier du projet invalide.', 400, 'github_dir_invalid');
 const result = await sandboxRun(tenant, conversationId, `cd ${quote(p.dir)} && echo "---REMOTE---" && git remote get-url origin && echo "---STAT---" && git add -N . && git diff HEAD --numstat && echo "---NAMES---" && git status --porcelain && echo "---FP---" && ${FINGERPRINT}`);
 const out = String(result.stdout || '');
 if (result.exitCode !== 0 || !out.includes('---FP---')) throw new AppError('Ce dossier n’est pas un dépôt Git cloné par Braand.', 400, 'github_dir_not_repo');
 const part = (a: string, b: string) => out.slice(out.indexOf('---' + a + '---') + a.length + 6, b ? out.indexOf('---' + b + '---') : undefined).trim();
 const target = parseRepoUrl(part('REMOTE', 'STAT').replace(/^https:\/\/[^@]+@/, 'https://'));
 if (!target) throw new AppError('Ce dépôt ne vient pas de GitHub.', 400, 'github_remote_invalid');
 const status = new Map(part('NAMES', 'FP').split('\n').filter(Boolean).map(line => [line.slice(3).trim(), line.slice(0, 2).trim()]));
 const files: Change[] = part('STAT', 'NAMES').split('\n').filter(Boolean).map(line => {const [a, r, ...name] = line.split('\t');const path = name.join('\t');return {path, status: status.get(path) || 'M', added: Number(a) || 0, removed: Number(r) || 0};}).slice(0, 200);
 if (!files.length) throw new AppError('Aucune modification à proposer dans ce projet.', 400, 'github_no_changes');
 const fingerprint = part('FP', '').slice(0, 64);
 const branch = 'braand/' + p.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now().toString(36).slice(-5);
 const data: ProposalData = {repo: `${target.owner}/${target.repo}`, dir: p.dir, conversationId, branch, title: p.title, description: p.description || '', files, fingerprint};
 return createResource(tenant, 'github_pr', p.title.slice(0, 160), data, 'awaiting_approval');
}

export async function decideProposal(who: {tenant: string; user: {userId: string}}, id: string, raw: unknown) {
 const p = z.object({decision: z.enum(['approve', 'reject']), version: z.number().int().positive()}).strict().parse(raw);
 const resource = await getResource(who.tenant, id);
 if (resource.kind !== 'github_pr') throw new AppError('Proposition introuvable.', 404);
 if (resource.status !== 'awaiting_approval') throw new AppError('Cette proposition a déjà été traitée.', 409, 'github_pr_decided');
 if (resource.version !== p.version) throw new AppError('La proposition a changé : relisez-la avant de décider.', 409, 'github_pr_stale');
 const data = resource.data as unknown as ProposalData;
 if (p.decision === 'reject') {await auditLog(who.tenant, who.user.userId, 'github.pr.rejected', id, {repo: data.repo});return updateResource(who.tenant, id, resource.version, {status: 'rejected'});}
 const token = await githubToken(who.user.userId);
 if (!token) throw new AppError('Connectez votre compte GitHub dans Paramètres › Connexions pour envoyer cette pull request.', 409, 'github_reconnect');
 const [owner, repo] = data.repo.split('/');
 const meta = await githubRequest<{default_branch: string; permissions?: {push?: boolean}}>(`/repos/${owner}/${repo}`, token);
 if (meta.permissions && meta.permissions.push === false) throw new AppError('Votre compte GitHub n’a pas le droit d’écrire sur ce dépôt. Demandez à Braand une archive ZIP des fichiers modifiés.', 403, 'github_no_push');
 // Commit and push exactly the reviewed changes; the token lives only for the push.
 const askpass = `umask 077; printf '%s\\n' '#!/bin/sh' ${quote('echo ' + quote(token))} > /tmp/.braand-askpass; chmod 700 /tmp/.braand-askpass; trap 'rm -f /tmp/.braand-askpass' EXIT; export GIT_ASKPASS=/tmp/.braand-askpass GIT_TERMINAL_PROMPT=0; `;
 const push = await sandboxRun(who.tenant, data.conversationId, `set -e; cd ${quote(data.dir)}; git add -N .; [ "$(${FINGERPRINT})" = ${quote(data.fingerprint)} ] || { echo CHANGED; exit 3; }; ${askpass}git checkout -B ${quote(data.branch)} >/dev/null 2>&1; git add -A; git -c user.name=Braand -c user.email=braand@users.noreply.github.com commit -q -m ${quote(data.title)}; git push -q ${quote(`https://x-access-token@github.com/${data.repo}.git`)} ${quote(data.branch)} 2>&1 | tail -3; rm -f /tmp/.braand-askpass; echo PUSHED`, 120);
 const out = String(push.stdout || '');
 if (out.includes('CHANGED')) {await updateResource(who.tenant, id, resource.version, {status: 'stale'});throw new AppError('Le projet a changé depuis la proposition : demandez à Braand de la refaire.', 409, 'github_pr_stale');}
 if (push.exitCode !== 0 || !out.includes('PUSHED')) throw new AppError('L’envoi vers GitHub a échoué. Réessayez, ou vérifiez l’accès de votre compte.', 502, 'github_push_failed');
 const pr = await githubRequest<{html_url: string; number: number}>(`/repos/${owner}/${repo}/pulls`, token, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: data.title, head: data.branch, base: meta.default_branch, body: (data.description ? data.description + '\n\n' : '') + '_Proposé par Braand, envoyé avec l’accord de l’utilisateur._'})});
 await auditLog(who.tenant, who.user.userId, 'github.pr.created', id, {repo: data.repo, number: pr.number});
 return updateResource(who.tenant, id, resource.version, {status: 'completed', data: {...data, defaultBranch: meta.default_branch, prUrl: pr.html_url}});
}
