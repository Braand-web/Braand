import {privateJSON} from '@/lib/private-json';
import { z } from 'zod';
import { identity, failure } from '@/lib/server';
import { listWork, prepareWork, workSummary } from '@/lib/work';
export async function GET(request: Request) { try {
    const who = await identity(request), url = new URL(request.url);
    if(url.searchParams.get('summary')==='1')return Response.json(await workSummary(who.tenant),{headers:{'Cache-Control':'private, no-store'}});
    return Response.json(await listWork(who.tenant, url.searchParams.get('conversationId') || undefined), { headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }
export async function POST(request: Request) { try {
    const who = await identity(request), { conversationId, plan } = z.object({ conversationId: z.string().min(1).max(160), plan: z.unknown() }).strict().parse(await privateJSON(request,1048576));
    return Response.json(await prepareWork(who, conversationId, plan), { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }
