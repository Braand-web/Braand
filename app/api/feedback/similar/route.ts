import {identity,failure} from '@/lib/server';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
export async function GET(request:Request){try{return Response.json(await feedback.similarFeedback(await identity(request),new URL(request.url).searchParams.get('title')||''),noStore);}catch(error){return failure(error);}}
