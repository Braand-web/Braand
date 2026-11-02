import {privateJSON} from '@/lib/private-json';
import { identity, failure } from '@/lib/server';
import { answerBrief } from '@/lib/brief';
export async function POST(request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const who = await identity(request, 'write');
    return Response.json(await answerBrief(who, (await params).id, await privateJSON(request,1048576)));
}
catch (error) {
    return failure(error);
} }
