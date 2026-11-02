import {privateJSON} from '@/lib/private-json';
import { identity, failure } from '@/lib/server';
import { AppError } from '@/lib/core.mjs';
import { socialAccounts, syncSocialAccounts, listSocialBatches, getSocialBatch, createSocialBatch, reviseSocialPost, decideSocialBatch, listComments, syncComments, prepareReply, decideReply, socialInsights, syncInsights, socialAssetChoices, socialPostList } from '@/lib/social';
import { z } from 'zod';
type Context = {
    params: Promise<{
        path: string[];
    }>;
};
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request, context: Context) {
    try {
        const who = await identity(request), path = (await context.params).path, url = new URL(request.url);
        let result: unknown;
        if (path.length === 1 && path[0] === 'accounts')
            result = await socialAccounts(who.tenant);
        else if (path.length === 1 && path[0] === 'assets')
            result = await socialAssetChoices(who.tenant);
        else if (path.length === 1 && path[0] === 'posts')
            result = await socialPostList(who.tenant, url.searchParams);
        else if (path.length === 1 && path[0] === 'batches')
            result = await listSocialBatches(who.tenant);
        else if (path.length === 2 && path[0] === 'batches')
            result = await getSocialBatch(who.tenant, path[1]);
        else if (path.length === 3 && path[0] === 'batches' && path[2] === 'export')
            return Response.json(await getSocialBatch(who.tenant, path[1]), { headers: { ...headers, 'Content-Disposition': 'attachment; filename="publications.json"' } });
        else if (path.length === 1 && path[0] === 'comments')
            result = await listComments(who.tenant, url.searchParams.get('accountId') || undefined);
        else if (path.length === 1 && path[0] === 'insights')
            result = await socialInsights(who.tenant, url.searchParams.get('accountId') || undefined);
        else
            throw new AppError('Élément introuvable.', 404);
        return Response.json(result, { headers });
    }
    catch (error) {
        return failure(error);
    }
}
export async function POST(request: Request, context: Context) {
    try {
        const who = await identity(request, 'read'), path = (await context.params).path;
        let result: unknown;
        if (path.length === 1 && path[0] === 'accounts')
            result = await syncSocialAccounts(who);
        else if (path.length === 1 && path[0] === 'batches')
            result = await createSocialBatch(who, await privateJSON(request,1048576));
        else if (path.length === 3 && path[0] === 'batches' && path[2] === 'decision')
            result = await decideSocialBatch(who, path[1], await privateJSON(request,1048576));
        else if (path.length === 2 && path[0] === 'comments' && path[1] === 'sync') {
            const p = z.object({ accountId: z.string().min(1).max(160), postId: z.string().min(1).max(160).optional() }).strict().parse(await privateJSON(request,1048576));
            result = await syncComments(who, p.accountId, p.postId);
        }
        else if (path.length === 1 && path[0] === 'replies')
            result = await prepareReply(who, await privateJSON(request,1048576));
        else if (path.length === 3 && path[0] === 'replies' && path[2] === 'decision')
            result = await decideReply(who, path[1], await privateJSON(request,1048576));
        else if (path.length === 2 && path[0] === 'insights' && path[1] === 'sync')
            result = await syncInsights(who, await privateJSON(request,1048576));
        else
            throw new AppError('Action introuvable.', 404);
        return Response.json(result, { headers });
    }
    catch (error) {
        return failure(error);
    }
}
export async function PATCH(request: Request, context: Context) { try {
    const who = await identity(request), path = (await context.params).path;
    if (path.length !== 2 || path[0] !== 'posts')
        throw new AppError('Publication introuvable.', 404);
    return Response.json(await reviseSocialPost(who, path[1], await privateJSON(request,1048576)), { headers });
}
catch (error) {
    return failure(error);
} }
