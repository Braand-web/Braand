import {privateJSON} from '@/lib/private-json';
import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminAction} from '@/lib/platform-admin';
export async function POST(request:Request){try{const who=await requirePlatformAdmin(request);return Response.json(await adminAction(who.user.userId,await privateJSON(request,8192)),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
