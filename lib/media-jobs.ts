import { db, getResource, config, updateResource } from './server';
import { falResult } from './providers';
import { settleHold, type BillingIdentity } from './billing';
import { AppError } from './core.mjs';
import { persistMedia } from './media-assets';
import { wakeWorkForResource } from './work';
import { advanceMediaPlans } from './media-plans';
const q = (sql: string, ...args: (string | number | null)[]) => db().prepare(sql).bind(...args);
export async function pollMediaProposal(tenant: string, id: string) {
    const resource = await getResource(tenant, id), op = await q('SELECT * FROM operations WHERE resource_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 1', id, tenant).first<{
        id: string;
        status: string;
        detail: string;
        external_id: string;
        amount: number;
    }>();
    if (!op)
        return { status: resource.status };
    const mediaId = 'media:' + op.id;
    if (op.status === 'completed')
        return { status: 'COMPLETED', resourceId: mediaId };
    if (!['waiting_external', 'settling'].includes(op.status))
        return { status: op.status };
    let detail = JSON.parse(op.detail || '{}');
    if (op.status === 'waiting_external') {
        const result = await falResult(detail.model, op.external_id);
        if (result.status !== 'COMPLETED')
            return result;
        detail = { ...detail, output: result.output };
        await q("UPDATE operations SET status='settling',detail=?,updated_at=? WHERE id=? AND status='waiting_external'", JSON.stringify(detail), Date.now(), op.id).run();
    }
    const now = Date.now();
    await q("INSERT OR IGNORE INTO resources(id,workspace_id,kind,title,data,status,created_at,updated_at) VALUES (?,?,'media',?,?,'ready',?,?)", mediaId, tenant, resource.title, JSON.stringify({ output: detail.output, model: detail.model, proposalId: id, storageStatus: 'pending' }), now, now).run();
    const holdId = detail.holdId || (await q('SELECT id FROM credit_holds WHERE reference=?', 'legacy:' + op.id).first<{
        id: string;
    }>())?.id;
    if (!holdId)
        throw new AppError('Réservation à rapprocher avant règlement.', 409);
    await settleHold(holdId, op.amount * 100);
    await db().batch([q("UPDATE operations SET status='completed',updated_at=? WHERE id=? AND status='settling'", now, op.id), q("UPDATE resources SET status='completed',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND status!='completed'", now, id, tenant), q('INSERT OR IGNORE INTO agent_work_artifacts(work_id,step_id,resource_id) SELECT work_id,step_id,? FROM agent_work_artifacts WHERE resource_id=?', mediaId, id)]);
    await wakeWorkForResource(tenant, id);
    return { status: 'COMPLETED', resourceId: mediaId };
}
export async function runMediaTick() {
    if (config().MEDIA_PERSIST_ENABLED !== 'true' && config().WORK_ENABLED !== 'true')
        return { disabled: true };
    const jobs = await q("SELECT workspace_id,resource_id FROM operations WHERE status IN ('waiting_external','settling') ORDER BY updated_at LIMIT 5").all<{
        workspace_id: string;
        resource_id: string;
    }>();
    for (const job of jobs.results)
        try {
            await pollMediaProposal(job.workspace_id, job.resource_id);
        }
        catch { /* Polling is read-only externally; receipts remain intact for the next bounded tick. */ }
    let plans = 0;
    try {
        plans = (await advanceMediaPlans()).checked;
    }
    catch { /* Plans retry on the next tick. */ }
    let stored = 0;
    if (config().MEDIA_PERSIST_ENABLED === 'true') {
        const pending = await q("SELECT r.id,r.workspace_id,w.organization_id,h.actor FROM resources r JOIN workspaces w ON w.id=r.workspace_id JOIN operations o ON json_extract(r.data,'$.proposalId')=o.resource_id AND o.status='completed' JOIN credit_holds h ON h.id=json_extract(o.detail,'$.holdId') WHERE r.kind='media' AND r.status='ready' AND COALESCE(json_extract(r.data,'$.storageStatus'),'pending')!='stored' AND COALESCE(json_extract(r.data,'$.storageAttempts'),0)<5 ORDER BY r.updated_at LIMIT 3").all<{
            id: string;
            workspace_id: string;
            organization_id: string;
            actor: string;
        }>();
        for (const row of pending.results) {
            const who: BillingIdentity = { tenant: row.workspace_id, organization: row.organization_id, role: '', user: { userId: row.actor, email: '', displayName: '' } };
            try {
                await persistMedia(who, row.id);
                stored++;
            }
            catch (error) {
                const resource = await getResource(row.workspace_id, row.id);
                await updateResource(row.workspace_id, row.id, resource.version, { data: { ...resource.data, storageStatus: 'unavailable', storageAttempts: Number(resource.data.storageAttempts || 0) + 1, storageError: error instanceof AppError ? error.code : 'media_storage_failed' } });
            }
        }
    }
    return { checked: jobs.results.length, plans, stored };
}
