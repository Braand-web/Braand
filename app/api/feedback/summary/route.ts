import {identity,failure} from '@/lib/server';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
export async function GET(request:Request){try{return Response.json(await feedback.feedbackSummary(await identity(request)),noStore);}catch(error){return failure(error);}}
