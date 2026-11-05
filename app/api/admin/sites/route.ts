import {failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {requirePlatformAdmin,adminSites,adminSiteAction} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);return Response.json(await adminSites(),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const who=await requirePlatformAdmin(request);return Response.json(await adminSiteAction(who.user.userId,await privateJSON(request,8192)));}catch(error){return failure(error);}}
