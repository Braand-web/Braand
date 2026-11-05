import {identity,failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
type Ctx={params:Promise<{id:string}>};
export async function POST(request:Request,context:Ctx){try{const who=await identity(request);return Response.json(await feedback.reportFeedback(who,(await context.params).id,await privateJSON(request,4096)),noStore);}catch(error){return failure(error);}}
