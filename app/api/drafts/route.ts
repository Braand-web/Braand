import {privateJSON} from '@/lib/private-json';
import { z } from 'zod';
import { identity, failure } from '@/lib/server';
import { getDraft, saveDraft, deleteDraft } from '@/lib/drafts';
export async function GET(request: Request) { try {
    const who = await identity(request);
    return Response.json(await getDraft(who.tenant, who.user.userId, new URL(request.url).searchParams.get('context') || 'new'), { headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }
export async function PUT(request: Request) { try {
    const who = await identity(request);
    return Response.json(await saveDraft(who.tenant, who.user.userId, await privateJSON(request,1048576)), { headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }
export async function DELETE(request: Request) { try {
    const who = await identity(request), p = z.object({ context: z.string().min(1).max(160), version: z.number().int().positive() }).strict().parse(await privateJSON(request,1048576));
    return Response.json(await deleteDraft(who.tenant, who.user.userId, p.context, p.version));
}
catch (error) {
    return failure(error);
} }
