import {privateJSON} from '@/lib/private-json';
import { identity, failure } from '@/lib/server';
import { getWork, workEvents, commandWork,reviseWork } from '@/lib/work';
import { AppError } from '@/lib/core.mjs';
import {z} from 'zod';
type Context = {
    params: Promise<{
        path: string[];
    }>;
};
export async function GET(request: Request, context: Context) { try {
    const who = await identity(request), [id, section, ...rest] = (await context.params).path;
    if (!id || rest.length)
        throw new AppError('Travail introuvable.', 404);
    const result = !section ? await getWork(who.tenant, id) : section === 'events' ? await workEvents(who.tenant, id, Number(new URL(request.url).searchParams.get('after') || 0)) : null;
    if (!result)
        throw new AppError('Action introuvable.', 404);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }
export async function POST(request: Request, context: Context) { try {
    const [id, section, ...rest] = (await context.params).path;
    if (!id || rest.length || !['commands', 'decisions'].includes(section))
        throw new AppError('Action introuvable.', 404);
    const body = await privateJSON(request,1048576);
    return Response.json(await commandWork(await identity(request, 'read'), id, body), { headers: { 'Cache-Control': 'private, no-store' } });
}
catch (error) {
    return failure(error);
} }

export async function PATCH(request:Request,context:Context){try{const [id,...rest]=(await context.params).path;if(!id||rest.length)throw new AppError('Travail introuvable.',404);const {version,...input}=z.object({version:z.number().int().positive()}).passthrough().parse(await privateJSON(request,1048576));return Response.json(await reviseWork(await identity(request,'write'),id,version,input));}catch(error){return failure(error);}}
