import {identity,failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
type Ctx={params:Promise<{id:string}>};
export async function POST(request:Request,context:Ctx){try{const who=await identity(request);await privateJSON(request,1024);return Response.json(await feedback.toggleVote(who,(await context.params).id),noStore);}catch(error){return failure(error);}}
