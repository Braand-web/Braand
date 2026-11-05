import {identity,failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
export async function GET(request:Request){try{const who=await identity(request),url=new URL(request.url);return Response.json(await feedback.listFeedback(who,Object.fromEntries(url.searchParams)),noStore);}catch(error){return failure(error);}}
export async function POST(request:Request){try{const who=await identity(request);return Response.json(await feedback.createFeedback(who,await privateJSON(request,16384)),{status:201,...noStore});}catch(error){return failure(error);}}
