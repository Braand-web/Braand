import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminUsers} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);return Response.json(await adminUsers(new URL(request.url).searchParams.get('q')||''),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
