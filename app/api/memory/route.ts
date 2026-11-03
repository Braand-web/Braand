import {privateJSON} from '@/lib/private-json';
import { z } from 'zod';
import { identity, failure, list, createResource, getResource, updateResource, auditLog } from '@/lib/server';
import { knowledgeInput, reviseKnowledge, forgetKnowledge, memoryPlacement, memoryOwnedByOther } from '@/lib/agent-memory';
import { checkedProject } from '@/lib/project-context';
import { AppError, safeWebURL } from '@/lib/core.mjs';
const brand = z.object({ name: z.string().trim().min(1).max(160), activity: z.string().max(2000), offer: z.string().max(3000), audience: z.string().max(2000), voice: z.string().max(2000), constraints: z.string().max(2000), references: z.array(z.string().url().max(2000)).max(10) }).strict();
export async function GET(request: Request) { try {
    const who = await identity(request);
    // Personal memories of other members are never listed.
    const items = (await list(who.tenant, 'knowledge')).filter(item => !memoryOwnedByOther(item.data as Record<string, unknown>, who.user.userId));
    return Response.json({ items, brands: await list(who.tenant, 'brand'), canWrite: ['owner', 'admin', 'editor'].includes(who.role) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }
export async function POST(request: Request) {
    try {
        const who = await identity(request), body = z.discriminatedUnion('action', [
            z.object({ action: z.literal('create'), memory: knowledgeInput, projectId: z.string().min(1).max(160).optional() }), z.object({ action: z.literal('revise'), id: z.string().max(160), version: z.number().int().positive(), memory: knowledgeInput }), z.object({ action: z.literal('forget'), id: z.string().max(160), version: z.number().int().positive() }),
            z.object({ action: z.literal('create_brand'), brand }), z.object({ action: z.literal('revise_brand'), id: z.string().max(160), version: z.number().int().positive(), brand })
        ]).parse(await privateJSON(request,1048576));
        let result: unknown;
        if (body.action === 'create')
        {
            if (body.projectId) await checkedProject(who.tenant, body.projectId);
            result = await createResource(who.tenant, 'knowledge', body.memory.title, { ...body.memory, ...memoryPlacement(body.memory.scope, body.projectId ?? null, who.user.userId), validatedAt: Date.now(), origin: 'user' }, 'saved');
        }
        else if (body.action === 'revise')
            result = await reviseKnowledge(who.tenant, { id: body.id, version: body.version, ...body.memory }, who.user.userId);
        else if (body.action === 'forget')
            result = await forgetKnowledge(who.tenant, { id: body.id, version: body.version }, who.user.userId);
        else {
            const data = body.brand;
            for (const reference of data.references)
                safeWebURL(reference);
            const value = { ...data, confirmation: 'user_supplied', updatedBy: who.user.userId };
            if (body.action === 'create_brand')
                result = await createResource(who.tenant, 'brand', data.name, value, 'saved');
            else {
                const current = await getResource(who.tenant, body.id);
                if (current.kind !== 'brand' || current.status === 'deleted')
                    throw new AppError('Marque introuvable.', 404);
                result = await updateResource(who.tenant, body.id, body.version, { title: data.name, data: value, status: 'saved' });
            }
        }
        await auditLog(who.tenant, who.user.userId, 'memory.' + body.action, 'id' in body ? body.id : 'new');
        return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    catch (error) {
        return failure(error);
    }
}
