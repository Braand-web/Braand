import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminAi} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);const days=Math.min(90,Math.max(1,Number(new URL(request.url).searchParams.get('days'))||30));return Response.json(await adminAi(days),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
