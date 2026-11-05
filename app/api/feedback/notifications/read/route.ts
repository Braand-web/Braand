import {identity,failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import * as feedback from '@/lib/feedback';
const noStore={headers:{'Cache-Control':'private, no-store'}};
export async function POST(request:Request){try{const who=await identity(request);return Response.json(await feedback.readNotifications(who,await privateJSON(request,8192)),noStore);}catch(error){return failure(error);}}
