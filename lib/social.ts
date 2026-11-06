import { z } from 'zod';
import { db, config, uid, authorize, auditLog, createResource, getResource } from './server';
import { AppError, safeWebURL } from './core.mjs';
import type { BillingIdentity } from './billing';
import type { FileRecord } from './contracts';
import { NETWORKS, batchInput, postInput, digest, type SocialAccountDTO, type SocialBatchDTO, type SocialPostDTO, type SocialNetwork, type SocialPostInput } from './platform-contracts';
import { adapters, adapter, adapterDigest, socialReadiness, argumentsFor, at, type SocialAdapter } from './social-adapters';
import { socialConnections, socialConnectorCall } from './composio';
const q = (sql: string, ...args: (string | number | null)[]) => db().prepare(sql).bind(...args);
type AccountRow = {
    id: string;
    workspace_id: string;
    actor_id: string;
    network: SocialNetwork;
    connected_account_id: string;
    target_id: string;
    label: string;
    timezone: string;
    capabilities: string;
    evidence: string;
    status: string;
    version: number;
    verified_at: number;
};
type PostRow = {
    id: string;
    batch_id: string;
    workspace_id: string;
    account_id: string;
    text: string;
    assets: string;
    format: SocialPostInput['format'];
    alt_text: string;
    destination: string | null;
    scheduled_at: number;
    timezone: string;
    status: string;
    version: number;
    approved_by:string|null;approval_expires_at:number|null;
    approved_digest: string | null;
    receipt: string | null;
    error_code: string | null;
    lease_token: string | null;
};
type BatchRow = {
    id: string;
    workspace_id: string;
    actor_id: string;
    title: string;
    version: number;
    status: string;
    digest: string | null;
    approved_by: string | null;
    expires_at: number | null;
};
const snapshot = (post: PostRow) => ({ id: post.id, batchId: post.batch_id, version: post.version, accountId: post.account_id, text: post.text, assets: JSON.parse(post.assets), format: post.format, altText: post.alt_text, destination: post.destination, scheduledAt: post.scheduled_at, timezone: post.timezone });
const postDTO = (row: PostRow): SocialPostDTO => ({ ...snapshot(row), status: row.status, errorCode: row.error_code, receipt: row.receipt ? JSON.parse(row.receipt) : null });
async function account(tenant: string, id: string) { const row = await q('SELECT * FROM social_accounts WHERE id=? AND workspace_id=?', id, tenant).first<AccountRow>(); if (!row)
    throw new AppError('Compte social introuvable.', 404, 'social_account_not_found'); return row; }
async function batch(tenant: string, id: string) { const row = await q('SELECT * FROM social_batches WHERE id=? AND workspace_id=?', id, tenant).first<BatchRow>(); if (!row)
    throw new AppError('Lot introuvable.', 404, 'social_batch_not_found'); return row; }
async function post(tenant: string, id: string) { const row = await q('SELECT * FROM social_posts WHERE id=? AND workspace_id=?', id, tenant).first<PostRow>(); if (!row)
    throw new AppError('Publication introuvable.', 404, 'social_post_not_found'); return row; }
async function actor(tenant: string, userId: string): Promise<BillingIdentity> { const rights = await authorize(tenant, userId, 'write'); return { tenant, organization: rights.organization_id, role: rights.role, user: { userId, email: '', displayName: '' } }; }
export async function socialAccounts(tenant: string) { const rows = await q('SELECT * FROM social_accounts WHERE workspace_id=? ORDER BY network,label LIMIT 100', tenant).all<AccountRow>(); return { accounts: rows.results.map((row): SocialAccountDTO => ({ id: row.id, network: row.network, label: row.label, targetId: row.target_id, timezone: row.timezone, status: row.status, version: row.version, verifiedAt: row.verified_at, capabilities: {...JSON.parse(row.capabilities),publish:!!JSON.parse(row.capabilities).publish&&config().SOCIAL_PUBLISHING_ENABLED==='true',comments:!!JSON.parse(row.capabilities).comments&&config().SOCIAL_COMMENTS_ENABLED==='true',insights:!!JSON.parse(row.capabilities).insights&&config().SOCIAL_INSIGHTS_ENABLED==='true'}, reason: row.status !== 'active' ? 'connection_required' : socialReadiness(row.network).reason })), networks: NETWORKS.map(network => ({ network, ...socialReadiness(network) })) }; }
export async function socialAssetChoices(tenant: string) { const rows = await q("SELECT f.id,f.display_name,f.detected_mime,f.sha256,f.size_bytes,r.version FROM files f JOIN resources r ON r.id=f.id WHERE f.workspace_id=? AND f.status='ready' AND r.status!='deleted' AND f.sha256 IS NOT NULL AND (f.detected_mime LIKE 'image/%' OR f.detected_mime LIKE 'video/%') ORDER BY f.updated_at DESC LIMIT 100", tenant).all<{
    id: string;
    display_name: string;
    detected_mime: string;
    sha256: string;
    size_bytes: number;
    version: number;
}>(); return { items: rows.results.map(row => ({ id: row.id, name: row.display_name, mime: row.detected_mime, sha256: row.sha256, size: row.size_bytes, version: row.version, url: '/api/files?id=' + encodeURIComponent(row.id) })) }; }
export async function socialPostList(tenant: string, params: URLSearchParams) { const p = z.object({ start: z.coerce.number().int().nonnegative(), end: z.coerce.number().int().positive(), before: z.coerce.number().int().nonnegative().optional(), accountId: z.string().max(160).optional(), network: z.enum(NETWORKS).optional() }).parse(Object.fromEntries(params)); if (p.end <= p.start || p.end - p.start > 100 * 86400000)
    throw new AppError('Période du calendrier invalide.'); const extra: string[] = [], args: (string | number)[] = [tenant, p.start, p.end]; if (p.accountId) {
    extra.push('p.account_id=?');
    args.push(p.accountId);
} if (p.network) {
    extra.push('a.network=?');
    args.push(p.network);
} if (p.before) {
    extra.push('p.rowid<?');
    args.push(p.before);
} const rows = await q('SELECT p.*,p.rowid cursor,b.title batch_title,a.label account_label,a.network FROM social_posts p JOIN social_accounts a ON a.id=p.account_id JOIN social_batches b ON b.id=p.batch_id WHERE p.workspace_id=? AND p.scheduled_at>=? AND p.scheduled_at<?' + (extra.length ? ' AND ' + extra.join(' AND ') : '') + ' ORDER BY p.rowid DESC LIMIT 101', ...args).all<PostRow & {
    cursor: number;
    batch_title: string;
    account_label: string;
    network: SocialNetwork;
}>(); const items = rows.results.slice(0, 100); return { items: items.map(row => ({ ...postDTO(row), batchTitle: row.batch_title, accountLabel: row.account_label, network: row.network })), nextBefore: rows.results.length > 100 ? items.at(-1)?.cursor : null }; }
export async function syncSocialAccounts(who: BillingIdentity) {
    await authorize(who.tenant, who.user.userId, 'write');
    let verified = 0;
    const unavailable: SocialNetwork[] = [];
    for (const recipe of adapters().filter(item => item.enabled)) {
        try {
            const connections = await socialConnections(who, recipe.toolkit), seen: string[] = [];
            for (const connection of connections) {
                const args = argumentsFor(recipe.discovery.arguments, { account: { connectedId: connection.id } }), result = await socialConnectorCall(who, { toolkit: recipe.toolkit, toolSlug: recipe.discovery.toolSlug, arguments: args, accountId: connection.id });
                if (result.resultType !== 'completed')
                    throw new AppError('Lecture du compte indisponible.', 502);
                const items = at(result.data, recipe.discovery.itemsPath);
                if (!Array.isArray(items) || items.length > 100)
                    throw new AppError('La liste des comptes doit être vérifiée.', 502);
                for (const item of items) {
                    const target = at(item, recipe.discovery.idPath), name = at(item, recipe.discovery.labelPath);
                    if (!['string', 'number'].includes(typeof target) || typeof name !== 'string')
                        continue;
                    const id = 'social-' + await digest([who.tenant, who.user.userId, recipe.network, connection.id, String(target)]), caps = { read: true, publish: at(item, recipe.discovery.capabilityPaths.publish) === true, comments: !!recipe.comments && !!recipe.reply && at(item, recipe.discovery.capabilityPaths.comments) === true, insights: !!recipe.insights && at(item, recipe.discovery.capabilityPaths.insights) === true }, now = Date.now();
                    await q("INSERT INTO social_accounts(id,workspace_id,actor_id,network,connected_account_id,target_id,label,timezone,capabilities,evidence,status,verified_at,updated_at) VALUES (?,?,?,?,?,?,?,'UTC',?,?,'active',?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,capabilities=excluded.capabilities,evidence=excluded.evidence,status='active',version=CASE WHEN capabilities!=excluded.capabilities OR status!='active' THEN version+1 ELSE version END,verified_at=excluded.verified_at,updated_at=excluded.updated_at", id, who.tenant, who.user.userId, recipe.network, connection.id, String(target), name.slice(0, 160), JSON.stringify(caps), JSON.stringify({ logId: result.logId, adapterVersion: recipe.version }), now, now).run();
                    seen.push(id);
                    verified++;
                }
            }
            const existing = await q('SELECT id FROM social_accounts WHERE workspace_id=? AND actor_id=? AND network=?', who.tenant, who.user.userId, recipe.network).all<{
                id: string;
            }>();
            for (const old of existing.results)
                if (!seen.includes(old.id))
                    await q("UPDATE social_accounts SET status='disconnected',version=version+1,updated_at=? WHERE id=? AND status!='disconnected'", Date.now(), old.id).run();
        }
        catch {
            unavailable.push(recipe.network);
        }
    }
    return { ...await socialAccounts(who.tenant), verified, unavailable };
}
async function ownedAssets(tenant: string, assets: SocialPostInput['assets']) { const files: FileRecord[] = []; for (const item of assets) {
    const resource = await getResource(tenant, item.id), file = await q("SELECT * FROM files WHERE id=? AND workspace_id=? AND status='ready'", item.id, tenant).first<FileRecord>();
    if (resource.kind !== 'file' || resource.status === 'deleted' || resource.version !== item.version || !file || file.sha256 !== item.sha256 || !file.storage_key)
        throw new AppError('Un média a changé ou est indisponible. Relisez la publication.', 409, 'social_asset_changed');
    if (!file.detected_mime.startsWith('image/') && !file.detected_mime.startsWith('video/'))
        throw new AppError('Sélectionnez une image ou une vidéo définitive.', 400, 'social_asset_invalid');
    files.push(file);
} return files; }
async function validatePost(tenant: string, p: SocialPostInput, strict = false) { const a = await account(tenant, p.accountId); await ownedAssets(tenant, p.assets); if (p.destination)
    safeWebURL(p.destination); if (strict) {
    const recipe = adapter(a.network), caps = JSON.parse(a.capabilities);
    if (a.status !== 'active' || !caps.publish)
        throw new AppError('Ce compte ne dispose pas de la publication vérifiée.', 409, 'social_publish_unavailable');
    if (!socialReadiness(a.network).ready)
        throw new AppError('La publication sur ce réseau attend son activation.', 503, 'social_not_ready');
    if (!recipe.formats.includes(p.format) || p.text.length > recipe.limits.textChars || p.assets.length > recipe.limits.maxAssets)
        throw new AppError('Le format ou les limites du réseau ne sont pas respectés.', 400, 'social_format_invalid');
    if (p.format === 'text' && !p.text.trim() || p.format !== 'text' && !p.assets.length)
        throw new AppError('Ajoutez le contenu ou les médias définitifs.', 400, 'social_content_missing');
} return a; }
export async function getSocialBatch(tenant: string, id: string): Promise<SocialBatchDTO> { const row = await batch(tenant, id), posts = await q('SELECT * FROM social_posts WHERE batch_id=? AND workspace_id=? ORDER BY scheduled_at,id', id, tenant).all<PostRow>(); const reviewDigest = await digest({ id: row.id, version: row.version, title: row.title, posts: posts.results.map(snapshot) }); return { id, title: row.title, version: row.version, status: row.status, digest: reviewDigest, expiresAt: row.expires_at, posts: posts.results.map(postDTO) }; }
export async function listSocialBatches(tenant: string) { const rows = await q('SELECT id FROM social_batches WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 50', tenant).all<{
    id: string;
}>(); return { items: await Promise.all(rows.results.map(row => getSocialBatch(tenant, row.id))) }; }
export async function createSocialBatch(who: BillingIdentity, input: unknown) { await authorize(who.tenant, who.user.userId, 'write'); const p = batchInput.parse(input); for (const item of p.posts) {
    const destination = await validatePost(who.tenant, item);
    if (destination.actor_id !== who.user.userId)
        throw new AppError('Choisissez un compte connecté par votre utilisateur.', 403, 'social_account_owner');
} for (const [id, kind] of [[p.brandId, 'brand'], [p.projectId, 'project']] as const)
    if (id) {
        const r = await getResource(who.tenant, id);
        if (r.kind !== kind || r.status === 'deleted')
            throw new AppError('Référence du lot invalide.', 404);
    } const saved = await createResource(who.tenant, 'social_batch', p.title, { publicationCount: p.posts.length }, 'awaiting_approval'), id = saved.id, now = Date.now(); await db().batch([q('INSERT INTO social_batches(id,workspace_id,actor_id,title,brand_id,project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, who.tenant, who.user.userId, p.title, p.brandId || null, p.projectId || null, now, now), ...p.posts.map(item => q('INSERT INTO social_posts(id,batch_id,workspace_id,account_id,text,assets,format,alt_text,destination,scheduled_at,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', uid(), id, who.tenant, item.accountId, item.text, JSON.stringify(item.assets), item.format, item.altText, item.destination, item.scheduledAt, item.timezone, now, now))]); await auditLog(who.tenant, who.user.userId, 'social.batch_created', id); return getSocialBatch(who.tenant, id); }
export async function reviseSocialPost(who: BillingIdentity, id: string, input: unknown) { await authorize(who.tenant, who.user.userId, 'write'); const p = z.object({ version: z.number().int().positive(), post: postInput }).strict().parse(input), row = await post(who.tenant, id); if (['publishing', 'processing', 'published', 'uncertain'].includes(row.status))
    throw new AppError('Cette publication est en cours, publiée ou à vérifier. Créez un nouveau brouillon pour la modifier.', 409, 'social_post_locked'); const destination = await validatePost(who.tenant, p.post); if (destination.actor_id !== who.user.userId)
    throw new AppError('Choisissez un compte connecté par votre utilisateur.', 403, 'social_account_owner'); const item = p.post, now = Date.now(); const changed = await q("UPDATE social_posts SET account_id=?,text=?,assets=?,format=?,alt_text=?,destination=?,scheduled_at=?,timezone=?,status='draft',approved_digest=NULL,approved_by=NULL,approved_at=NULL,approval_expires_at=NULL,error_code=NULL,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status NOT IN ('publishing','processing','published','uncertain')", item.accountId, item.text, JSON.stringify(item.assets), item.format, item.altText, item.destination, item.scheduledAt, item.timezone, now, id, who.tenant, p.version).run(); if (!changed.meta.changes)
    throw new AppError('La publication a changé. Votre saisie reste conservée.', 409, 'stale_version'); await q("UPDATE social_batches SET status='draft',version=version+1,updated_at=? WHERE id=?", now, row.batch_id).run(); await q("UPDATE resources SET status='awaiting_approval',version=version+1,updated_at=? WHERE id=? AND workspace_id=?", now, row.batch_id, who.tenant).run(); await auditLog(who.tenant, who.user.userId, 'social.post_revised', id); return getSocialBatch(who.tenant, row.batch_id); }
async function approvedPostDigest(row: PostRow, a: AccountRow, recipe: SocialAdapter) { return digest({ post: snapshot(row), accountVersion: a.version, connectedAccount: a.connected_account_id, target: a.target_id, adapter: await adapterDigest(recipe), lateWindowMs: 900000 }); }
export async function decideSocialBatch(who: BillingIdentity, id: string, input: unknown) {
    await authorize(who.tenant, who.user.userId, 'approve');
    const p = z.object({ version: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['approve', 'reject']), postIds: z.array(z.string().min(1).max(160)).min(1).max(60) }).strict().parse(input), current = await getSocialBatch(who.tenant, id), row = await batch(who.tenant, id);
    if (current.version !== p.version || current.digest !== p.digest)
        throw new AppError('Le lot a changé. Relisez les différences avant de confirmer.', 409, 'social_stale_approval');
    if (new Set(p.postIds).size !== p.postIds.length || p.postIds.some(id => !current.posts.some(post => post.id === id)))
        throw new AppError('La sélection ne correspond pas au lot.');
    await authorize(who.tenant, row.actor_id, 'write');
    const updates: D1PreparedStatement[] = [], decisionToken = uid();
    let expires = 0;
    for (const postId of p.postIds) {
        const item = await post(who.tenant, postId);
        if (!['draft', 'blocked', 'needs_reschedule', 'rejected', 'approved'].includes(item.status))
            throw new AppError('Une publication de la sélection ne peut plus être modifiée.', 409);
        let hash: string | null = null;
        if (p.decision === 'approve') {
            if(config().SOCIAL_PUBLISHING_ENABLED!=='true'||config().SOCIAL_SCHEDULING_ENABLED!=='true')throw new AppError('La publication et la programmation attendent leur recette.',503,'social_not_ready');
            const a = await validatePost(who.tenant, postDTO(item), true);
            if (item.scheduled_at < Date.now() || item.scheduled_at > Date.now() + 90 * 86400000)
                throw new AppError('Choisissez un créneau futur dans les quatre-vingt-dix prochains jours.');
            hash = await approvedPostDigest(item, a, adapter(a.network));
            expires = Math.max(expires, item.scheduled_at + 900000);
        }
        updates.push(q('UPDATE social_posts SET status=?,approved_digest=?,approved_by=?,approved_at=?,approval_expires_at=?,error_code=NULL,updated_at=? WHERE id=? AND version=? AND status IN (\'draft\',\'blocked\',\'needs_reschedule\',\'rejected\',\'approved\') AND EXISTS(SELECT 1 FROM social_batches WHERE id=? AND version=? AND digest=? AND approved_by=? AND decision_token=?)', p.decision === 'approve' ? 'approved' : 'rejected', hash,p.decision==='approve'?who.user.userId:null,p.decision==='approve'?Date.now():null,p.decision==='approve'?item.scheduled_at+900000:null,Date.now(), item.id, item.version, id, p.version + 1, p.digest, who.user.userId, decisionToken));
    }
    // CAS on the batch first; a concurrent edit makes all snapshot guards fail.
    const decisions = await db().batch([q('UPDATE social_batches SET version=version+1,status=?,digest=?,approved_by=?,approved_at=?,expires_at=?,updated_at=?,decision_token=? WHERE id=? AND workspace_id=? AND version=?', p.decision === 'approve' ? 'approved' : 'rejected', p.digest, who.user.userId, Date.now(), expires || null, Date.now(), decisionToken, id, who.tenant, p.version), ...updates]);
    if (!decisions[0].meta.changes)
        throw new AppError('Le lot a changé.', 409, 'social_stale_approval');
    await syncBatchResource(who.tenant, id);
    await auditLog(who.tenant, who.user.userId, 'social.batch_' + p.decision, id, { postIds: p.postIds, digest: p.digest, lateWindowMinutes: 15 });
    return getSocialBatch(who.tenant, id);
}
async function grantAssets(deliveryId: string, tenant: string, assets: SocialPostInput['assets']) { const files = await ownedAssets(tenant, assets), origin = config().APP_ORIGIN; if (!origin || new URL(origin).protocol !== 'https:')
    throw new AppError('Les transferts de médias attendent une origine publique validée.', 503); const result = []; for (const file of files) {
    const id = uid(), token = uid() + uid();
    await q('INSERT INTO social_asset_grants(id,token_digest,delivery_id,file_id,file_digest,expires_at) VALUES (?,?,?,?,?,?)', id, await digest(token), deliveryId, file.id, file.sha256!, Date.now() + 3600000).run();
    result.push({ id: file.id, url: origin + '/api/social-assets/' + id + '?token=' + encodeURIComponent(token), mime: file.detected_mime, size: file.size_bytes });
} return result; }
export async function readSocialAsset(id: string, token: string) { if (!token || token.length > 100)
    throw new AppError('Média introuvable.', 404); const row = await q("SELECT g.file_id,g.file_digest,d.workspace_id,w.organization_id FROM social_asset_grants g JOIN social_deliveries d ON d.id=g.delivery_id JOIN workspaces w ON w.id=d.workspace_id WHERE g.id=? AND g.token_digest=? AND g.expires_at>? AND d.status IN ('publishing','processing','published')", id, await digest(token), Date.now()).first<{
    file_id: string;
    file_digest: string;
    workspace_id: string;
    organization_id: string;
}>(); if (!row)
    throw new AppError('Média introuvable.', 404); const file = await q("SELECT * FROM files WHERE id=? AND workspace_id=? AND sha256=? AND status='ready'", row.file_id, row.workspace_id, row.file_digest).first<FileRecord>(), bucket = (await import('cloudflare:workers')).env.BUCKET; if (!file?.storage_key || !bucket)
    throw new AppError('Média introuvable.', 404); const object = await bucket.get(file.storage_key); if (!object)
    throw new AppError('Média introuvable.', 404); await q('INSERT INTO billing_meter VALUES (?,?,?,?,?)', uid(), row.organization_id, 'transfer', object.size, Date.now()).run(); return new Response(object.body, { headers: { 'Content-Type': file.detected_mime, 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } }); }
function receipt(data: unknown, recipe: SocialAdapter['publish'] | NonNullable<SocialAdapter['poll']>) { const id = at(data, recipe.idPath), url = at(data, recipe.urlPath), value = at(data, recipe.statusPath); let safeURL: string | undefined; try {
    if (typeof url === 'string')
        safeURL = safeWebURL(url);
}
catch { /* No unverified link. */ } return { externalId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined, url: safeURL, status: typeof value === 'string' ? value : undefined }; }
export async function runSocialTick() {
    const now = Date.now();
    await q("UPDATE social_posts SET status='uncertain',error_code='delivery_interrupted' WHERE status='publishing' AND lease_until<=?", now).run();
    const rows = await q("SELECT * FROM social_posts WHERE (status='approved' AND scheduled_at<=?) OR status='processing' ORDER BY scheduled_at,id LIMIT 10", now).all<PostRow>();
    let published = 0, blocked = 0;
    for (const item of rows.results) {
        if (item.status==='approved'&&(config().SOCIAL_PUBLISHING_ENABLED!=='true'||config().SOCIAL_SCHEDULING_ENABLED!=='true')||!socialReadiness((await account(item.workspace_id, item.account_id)).network).ready)
            continue;
        const token = uid(), lock = await q("UPDATE social_posts SET lease_token=?,lease_until=? WHERE id=? AND status=? AND lease_until<=?", token, Date.now() + 120000, item.id, item.status, Date.now()).run();
        if (!lock.meta.changes)
            continue;
        let crossed = false;
        try {
            const a = await account(item.workspace_id, item.account_id), recipe = adapter(a.network), who = await actor(item.workspace_id, a.actor_id);
            if (!item.approved_by||item.approval_expires_at!==item.scheduled_at+900000)
                throw new AppError('Validation du lot absente.', 409, 'social_approval_required');
            await authorize(item.workspace_id, item.approved_by, 'approve');
            if (item.approved_digest !== await approvedPostDigest(item, a, recipe))
                throw new AppError('Le contenu, le compte ou la capacité a changé.', 409, 'social_stale_approval');
            if (item.status === 'approved' && Date.now() > item.scheduled_at + 900000) {
                await q("UPDATE social_posts SET status='needs_reschedule',error_code='schedule_elapsed' WHERE id=? AND lease_token=?", item.id, token).run();
                blocked++;
                continue;
            }
            if (item.status === 'processing') {
                const previous = await q('SELECT * FROM social_deliveries WHERE post_id=?', item.id).first<{
                    id: string;
                    external_id: string;
                    status: string;
                }>();
                if (!previous || !recipe.poll)
                    throw new AppError('Le résultat doit être vérifié manuellement.', 409, 'social_receipt_unknown');
                const args = argumentsFor(recipe.poll.arguments, { account: { targetId: a.target_id }, receipt: { externalId: previous.external_id } }), result = await socialConnectorCall(who, { toolkit: recipe.toolkit, toolSlug: recipe.poll.toolSlug, arguments: args, accountId: a.connected_account_id });
                if (result.resultType !== 'completed')
                    continue;
                const proof = receipt(result.data, recipe.poll);
                if (proof.status && recipe.poll.publishedValues.includes(proof.status) && proof.externalId) {
                    await q("UPDATE social_posts SET status='published',receipt=?,error_code=NULL WHERE id=? AND lease_token=?", JSON.stringify(proof), item.id, token).run();
                    await q("UPDATE social_deliveries SET status='published',public_url=?,updated_at=? WHERE id=?", proof.url || null, Date.now(), previous.id).run();
                    published++;
                }
                else if (proof.status && recipe.poll.failedValues.includes(proof.status))
                    throw new AppError('La plateforme a refusé la publication.', 409, 'social_processing_failed');
                continue;
            }
            await validatePost(item.workspace_id, postDTO(item), true);
            const deliveryId = 'social:' + item.id, contractHash = await adapterDigest(recipe), payloadHash = await digest(snapshot(item));
            const claim = await q("INSERT OR IGNORE INTO social_deliveries(id,post_id,workspace_id,actor_id,adapter_digest,payload_digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'publishing',?,?)", deliveryId, item.id, item.workspace_id, a.actor_id, contractHash, payloadHash, Date.now(), Date.now()).run();
            if (!claim.meta.changes)
                throw new AppError('Un envoi existe déjà. Vérifiez son résultat avant toute nouvelle action.', 409, 'social_receipt_unknown');
            await q("UPDATE social_posts SET status='publishing' WHERE id=? AND lease_token=?", item.id, token).run();
            const assets = await grantAssets(deliveryId, item.workspace_id, JSON.parse(item.assets)), context: Record<string, unknown> = { post: snapshot(item), account: { targetId: a.target_id }, assets: { items: assets, urls: assets.map(asset => asset.url), firstUrl: assets[0]?.url || '' }, steps: [] };
            let last: unknown;
            for (let ordinal = 0; ordinal < recipe.publish.steps.length; ordinal++) {
                const current = await post(item.workspace_id, item.id);
                if(Date.now()>(item.approval_expires_at||0))throw new AppError('Le créneau autorisé est dépassé.',409,'schedule_elapsed');const freshAccount=await account(item.workspace_id,item.account_id);if(current.approved_digest!==await approvedPostDigest(current,freshAccount,adapter(freshAccount.network)))throw new AppError('Le compte ou la capacité a changé.',409,'social_stale_approval');
                if (current.lease_token !== token || current.status !== 'publishing')
                    throw new AppError('L’envoi a été suspendu.', 409, 'social_state_changed');
                await authorize(item.workspace_id, item.approved_by, 'approve');
                await authorize(item.workspace_id, a.actor_id, 'write');
                const step = recipe.publish.steps[ordinal], args = argumentsFor(step.arguments, context), argsHash = await digest(args);
                await q("INSERT INTO social_delivery_steps(delivery_id,ordinal,tool_slug,payload_digest,status,updated_at) VALUES (?,?,?,?,'submitting',?)", deliveryId, ordinal, step.toolSlug, argsHash, Date.now()).run();
                crossed = true;
                const result = await socialConnectorCall(who, { toolkit: recipe.toolkit, toolSlug: step.toolSlug, arguments: args, accountId: a.connected_account_id }, { deliveryId, ordinal, payloadDigest: argsHash });
                if (result.resultType !== 'completed')
                    throw new AppError('Le réseau n’a pas confirmé cette étape.', 502, 'social_receipt_unknown');
                last = result.data;
                const stepId = at(result.data, step.idPath);
                (context.steps as unknown[]).push({ id: stepId, data: result.data });
                await q("UPDATE social_delivery_steps SET status='confirmed',result=?,log_id=?,updated_at=? WHERE delivery_id=? AND ordinal=?", JSON.stringify({ id: stepId ?? null }), result.logId || null, Date.now(), deliveryId, ordinal).run();
            }
            const proof = receipt(last, recipe.publish), confirmed = !!proof.externalId && !!proof.status && recipe.publish.publishedValues.includes(proof.status), processing = !!proof.externalId && !!proof.status && recipe.publish.processingValues.includes(proof.status) && !!recipe.poll;
            if (!confirmed && !processing)
                throw new AppError('Le réseau n’a pas confirmé le résultat de publication.', 502, 'social_receipt_unknown');
            await db().batch([q('UPDATE social_posts SET status=?,receipt=?,error_code=NULL WHERE id=? AND lease_token=?', confirmed ? 'published' : 'processing', JSON.stringify(proof), item.id, token), q('UPDATE social_deliveries SET status=?,external_id=?,public_url=?,updated_at=? WHERE id=?', confirmed ? 'published' : 'processing', proof.externalId!, proof.url || null, Date.now(), deliveryId)]);
            if (confirmed)
                published++;
            await auditLog(item.workspace_id, a.actor_id, 'social.' + (confirmed ? 'published' : 'processing'), item.id, { externalId: proof.externalId });
        }
        catch (error) {
            const code = error instanceof AppError ? error.code : 'social_failed', state = crossed || item.status === 'processing' ? 'uncertain' : 'blocked';
            await q('UPDATE social_posts SET status=?,error_code=? WHERE id=? AND lease_token=?', state, code, item.id, token).run();
            await q('UPDATE social_deliveries SET status=?,updated_at=? WHERE post_id=?', state, Date.now(), item.id).run();
            blocked++;
        }
        finally {
            await q('UPDATE social_posts SET lease_token=NULL,lease_until=? WHERE id=? AND lease_token=?', Date.now() + 60000, item.id, token).run();
            await syncBatchResource(item.workspace_id, item.batch_id);
        }
    }
    return { checked: rows.results.length, published, blocked };
}
type CommentRow = {
    id: string;
    workspace_id: string;
    account_id: string;
    external_id: string;
    post_external_id: string;
    parent_external_id: string | null;
    author_label: string;
    text: string;
    digest: string;
    status: string;
    synced_at: number;
};
type ReplyRow = {
    id: string;
    workspace_id: string;
    actor_id: string;
    comment_id: string;
    text: string;
    comment_digest: string;
    version: number;
    status: string;
    digest: string;
    receipt: string | null;
};
export async function listComments(tenant: string, accountId?: string) { const rows = await q('SELECT c.*,a.label account_label,a.network FROM social_comments c JOIN social_accounts a ON a.id=c.account_id WHERE c.workspace_id=?' + (accountId ? ' AND c.account_id=?' : '') + ' ORDER BY c.synced_at DESC,c.id LIMIT 100', tenant, ...(accountId ? [accountId] : [])).all<CommentRow & {
    account_label: string;
    network: SocialNetwork;
}>(); const replies = await q('SELECT id,comment_id,text,version,status,digest,receipt FROM social_replies WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 100', tenant).all<{
    id: string;
    comment_id: string;
    text: string;
    version: number;
    status: string;
    digest: string;
    receipt: string | null;
}>(); return { comments: rows.results.map(row => ({ id: row.id, accountId: row.account_id, accountLabel: row.account_label, network: row.network, author: row.author_label, text: row.text, status: row.status, digest: row.digest, syncedAt: row.synced_at, replies: replies.results.filter(reply => reply.comment_id === row.id).map(reply => ({ ...reply, receipt: reply.receipt ? JSON.parse(reply.receipt) : null })) })) }; }
export async function syncComments(who: BillingIdentity, accountId: string, postExternalId?: string) {
    await authorize(who.tenant, who.user.userId, 'write');
    const a = await account(who.tenant, accountId), recipe = adapter(a.network);
    if (a.actor_id !== who.user.userId || !recipe.comments || config().SOCIAL_COMMENTS_ENABLED!=='true'|| !JSON.parse(a.capabilities).comments)
        throw new AppError('La lecture des commentaires n’est pas disponible pour ce compte.', 409, 'social_comments_unavailable');
    const args = argumentsFor(recipe.comments.arguments, { account: { targetId: a.target_id }, post: { externalId: postExternalId || '' } }), result = await socialConnectorCall(who, { toolkit: recipe.toolkit, toolSlug: recipe.comments.toolSlug, arguments: args, accountId: a.connected_account_id });
    if (result.resultType !== 'completed')
        throw new AppError('Les commentaires n’ont pas pu être actualisés.', 502);
    const items = at(result.data, recipe.comments.itemsPath);
    if (!Array.isArray(items) || items.length > 100)
        throw new AppError('La réponse des commentaires doit être vérifiée.', 502);
    let count = 0;
    const seenIds: string[] = [];
    for (const value of items) {
        const external = at(value, recipe.comments.idPath), text = at(value, recipe.comments.textPath), parent = at(value, recipe.comments.parentPath), postId = at(value, recipe.comments.postPath) || postExternalId, authorLabel = at(value, recipe.comments.authorPath);
        if (typeof external !== 'string' || typeof text !== 'string' || typeof postId !== 'string')
            continue;
        const id = 'comment:' + await digest([a.id, external]), hash = await digest([external, text, parent || null,recipe.comments.contextPath?at(value,recipe.comments.contextPath):null]), now = Date.now();
        await q("INSERT INTO social_comments(id,workspace_id,account_id,external_id,post_external_id,parent_external_id,author_label,text,digest,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,digest=excluded.digest,status=CASE WHEN digest!=excluded.digest THEN 'unread' ELSE status END,synced_at=excluded.synced_at", id, who.tenant, a.id, external, postId, typeof parent === 'string' ? parent : null, typeof authorLabel === 'string' ? authorLabel.slice(0, 160) : 'Utilisateur', text.slice(0, 12000), hash, now).run();
        seenIds.push(id);
        count++;
    }
    return { synced: count, seenIds, ...await listComments(who.tenant, accountId) };
}
export async function prepareReply(who: BillingIdentity, input: unknown) { await authorize(who.tenant, who.user.userId, 'write'); const p = z.object({ commentId: z.string().min(1).max(160), text: z.string().trim().min(1).max(4000) }).strict().parse(input), c = await q('SELECT * FROM social_comments WHERE id=? AND workspace_id=?', p.commentId, who.tenant).first<CommentRow>(); if (!c)
    throw new AppError('Commentaire introuvable.', 404); const a = await account(who.tenant, c.account_id); if (a.actor_id !== who.user.userId)
    throw new AppError('Ce compte appartient à une autre connexion de l’équipe.', 403); const id = uid(), hash = await digest({ id, commentId: c.id, commentDigest: c.digest, text: p.text }); await q('INSERT INTO social_replies(id,workspace_id,actor_id,comment_id,text,comment_digest,digest,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, who.tenant, who.user.userId, c.id, p.text, c.digest, hash, Date.now()).run(); return { id, version: 1, status: 'draft', digest: hash, commentId: c.id, text: p.text }; }
/** One prepared reply with the comment it answers, for its approval card. */
export async function getSocialReply(tenant: string, id: string) {
    const r = await q('SELECT s.id,s.text,s.version,s.status,s.digest,c.text comment_text,c.author_label,a.label account_label,a.network FROM social_replies s JOIN social_comments c ON c.id=s.comment_id JOIN social_accounts a ON a.id=c.account_id WHERE s.id=? AND s.workspace_id=?', id, tenant).first<{ id: string; text: string; version: number; status: string; digest: string; comment_text: string | null; author_label: string; account_label: string; network: string }>();
    if (!r) throw new AppError('Réponse introuvable.', 404);
    return { id: r.id, text: r.text, version: r.version, status: r.status, digest: r.digest, comment: { text: r.comment_text || '', author: r.author_label || '' }, account: { label: r.account_label, network: r.network } };
}
export async function decideReply(who: BillingIdentity, id: string, input: unknown) {
    await authorize(who.tenant, who.user.userId, 'approve');
    const p = z.object({ version: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['approve', 'reject']) }).strict().parse(input), r = await q('SELECT * FROM social_replies WHERE id=? AND workspace_id=?', id, who.tenant).first<ReplyRow>();
    if (!r)
        throw new AppError('Réponse introuvable.', 404);
    if (r.version !== p.version || r.digest !== p.digest)
        throw new AppError('La réponse a changé.', 409, 'social_stale_approval');
    if (r.status !== 'draft')
        return { id, status: r.status, receipt: r.receipt ? JSON.parse(r.receipt) : null };
    if (p.decision === 'reject') {
        await q("UPDATE social_replies SET status='rejected',version=version+1,updated_at=? WHERE id=? AND status='draft'", Date.now(), id).run();
        return { id, status: 'rejected' };
    }
    let c = await q('SELECT * FROM social_comments WHERE id=? AND workspace_id=?', r.comment_id, who.tenant).first<CommentRow>();
    if (!c)
        throw new AppError('Commentaire introuvable.', 404);
    const a = await account(who.tenant, c.account_id), recipe = adapter(a.network), sender = await actor(who.tenant, r.actor_id);
    if (!socialReadiness(a.network).ready || config().SOCIAL_COMMENTS_ENABLED!=='true'||!recipe.comments?.contextPath||!recipe.reply)
        throw new AppError('L’envoi de réponses attend sa validation.', 503, 'social_not_ready');
    const refreshed = await syncComments(sender, a.id, c.post_external_id);
    if (!refreshed.seenIds.includes(c.id))
        throw new AppError('Le commentaire ne peut plus être vérifié. Aucun envoi.', 409, 'social_comment_changed');
    c = await q('SELECT * FROM social_comments WHERE id=? AND workspace_id=?', r.comment_id, who.tenant).first<CommentRow>();
    if (!c || c.digest !== r.comment_digest || Date.now() - c.synced_at > 60000)
        throw new AppError('La discussion a changé ou ne peut pas être vérifiée. Préparez une nouvelle réponse.', 409, 'social_comment_changed');
    const args = argumentsFor(recipe.reply.arguments, { account: { targetId: a.target_id }, comment: { externalId: c.external_id, postExternalId: c.post_external_id }, reply: { text: r.text } }), payloadHash = await digest(args), claim = await q("UPDATE social_replies SET status='publishing',approved_by=?,payload_digest=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=? AND status='draft'", who.user.userId, payloadHash, Date.now(), id, who.tenant, p.version).run();
    if (!claim.meta.changes)
        throw new AppError('Cette réponse est déjà en cours.', 409);
    try {
        const result = await socialConnectorCall(sender, { toolkit: recipe.toolkit, toolSlug: recipe.reply.toolSlug, arguments: args, accountId: a.connected_account_id }, { replyId: id, payloadDigest: payloadHash }), external = at(result.data, recipe.reply.idPath);
        if (result.resultType !== 'completed' || !['string', 'number'].includes(typeof external))
            throw new AppError('Le résultat de la réponse doit être vérifié.', 502);
        const proof = { externalId: String(external), logId: result.logId };
        await db().batch([q("UPDATE social_replies SET status='published',receipt=?,updated_at=? WHERE id=?", JSON.stringify(proof), Date.now(), id), q("UPDATE social_comments SET status='answered' WHERE id=?", c.id)]);
        await auditLog(who.tenant, who.user.userId, 'social.reply_approved', id);
        return { id, status: 'published', receipt: proof };
    }
    catch {
        await q("UPDATE social_replies SET status='uncertain',updated_at=? WHERE id=?", Date.now(), id).run();
        return { id, status: 'uncertain', notice: 'Le résultat doit être vérifié avant tout nouvel envoi.' };
    }
}
const metricSchema = z.record(z.enum(['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'views', 'clicks', 'watchSeconds']), z.number().finite().nonnegative());
export async function socialInsights(tenant: string, accountId?: string) { if (accountId)
    await account(tenant, accountId); const rows = await q('SELECT i.*,a.label account_label,a.network FROM social_insights i JOIN social_accounts a ON a.id=i.account_id WHERE i.workspace_id=?' + (accountId ? ' AND i.account_id=?' : '') + ' ORDER BY i.period_end DESC LIMIT 200', tenant, ...(accountId ? [accountId] : [])).all<{
    id: string;
    account_id: string;
    external_post_id: string | null;
    period_start: number;
    period_end: number;
    metrics: string;
    source: string;
    fetched_at: number;
    account_label: string;
    network: SocialNetwork;
}>(); return { items: rows.results.map(row => ({ id: row.id, accountId: row.account_id, accountLabel: row.account_label, network: row.network, postId: row.external_post_id, periodStart: row.period_start, periodEnd: row.period_end, metrics: JSON.parse(row.metrics), source: row.source, fetchedAt: row.fetched_at })), notice: 'Statistiques organiques. Les clics et interactions ne prouvent pas des ventes.' }; }
export async function syncInsights(who: BillingIdentity, input: unknown) { await authorize(who.tenant, who.user.userId, 'write'); const p = z.object({ accountId: z.string().min(1).max(160), start: z.number().int().positive(), end: z.number().int().positive() }).strict().parse(input); if (p.end <= p.start || p.end > Date.now() || p.end - p.start > 90 * 86400000)
    throw new AppError('Choisissez une période terminée de quatre-vingt-dix jours maximum.'); const a = await account(who.tenant, p.accountId), recipe = adapter(a.network); if (a.actor_id !== who.user.userId || !recipe.insights || config().SOCIAL_INSIGHTS_ENABLED!=='true'||!JSON.parse(a.capabilities).insights)
    throw new AppError('Les statistiques ne sont pas accessibles sur ce compte.', 409); const args = argumentsFor(recipe.insights.arguments, { account: { targetId: a.target_id }, period: { start: p.start, end: p.end } }), result = await socialConnectorCall(who, { toolkit: recipe.toolkit, toolSlug: recipe.insights.toolSlug, arguments: args, accountId: a.connected_account_id }); if (result.resultType !== 'completed')
    throw new AppError('La lecture des statistiques a échoué.', 502); const items = at(result.data, recipe.insights.itemsPath); if (!Array.isArray(items) || items.length > 200)
    throw new AppError('Le relevé statistique doit être vérifié.', 502); for (const item of items) {
    const metrics = metricSchema.parse(at(item, recipe.insights.metricsPath)), external = at(item, recipe.insights.idPath), id = await digest([a.id, p.start, p.end, external || 'account']);
    await q('INSERT INTO social_insights(id,workspace_id,account_id,external_post_id,period_start,period_end,metrics,source,fetched_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metrics=excluded.metrics,fetched_at=excluded.fetched_at', id, who.tenant, a.id, typeof external === 'string' ? external : null, p.start, p.end, JSON.stringify(metrics), a.network, Date.now()).run();
} return socialInsights(who.tenant, a.id); }
async function syncBatchResource(tenant: string, id: string) { const posts = (await q('SELECT status FROM social_posts WHERE batch_id=? AND workspace_id=?', id, tenant).all<{
    status: string;
}>()).results.map(row => row.status); const status = posts.some(s => s === 'uncertain') ? 'needs_reconciliation' : posts.length && posts.every(s => s === 'published') ? 'completed' : posts.length && posts.every(s => s === 'rejected') ? 'rejected' : posts.some(s => ['approved', 'publishing', 'processing'].includes(s)) ? 'executing' : posts.some(s => s === 'published') ? 'partial' : 'awaiting_approval'; await q('UPDATE resources SET status=?,updated_at=? WHERE id=? AND workspace_id=?', status, Date.now(), id, tenant).run(); }
