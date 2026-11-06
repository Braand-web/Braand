import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminOverview,adminPendingDecisions} from '@/lib/platform-admin';
export async function GET(request:Request){try{await requirePlatformAdmin(request);const [overview,pendingDecisions]=await Promise.all([adminOverview(),adminPendingDecisions().catch(()=>null)]);return Response.json({...overview,pendingDecisions},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
