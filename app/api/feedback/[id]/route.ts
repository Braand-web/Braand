import {identity,failure} from '@/lib/server';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,context:Ctx){try{return Response.json(await feedback.getFeedback(await identity(request),(await context.params).id),noStore);}catch(error){return failure(error);}}
