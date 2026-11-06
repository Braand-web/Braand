import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminTraffic} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);return Response.json(await adminTraffic(new URL(request.url).searchParams.get('days')),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
