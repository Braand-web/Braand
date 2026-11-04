import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminUserDetail} from '@/lib/platform-admin';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{await requirePlatformAdmin(request);return Response.json(await adminUserDetail((await context.params).id),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
