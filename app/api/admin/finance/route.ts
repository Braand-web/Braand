import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminFinance} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);return Response.json(await adminFinance(),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
