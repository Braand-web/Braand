import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminMedia} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);return Response.json(await adminMedia(),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
