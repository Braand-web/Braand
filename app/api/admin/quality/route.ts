import {failure} from '@/lib/server';
import {requireOperationsAdmin} from '@/lib/operations';
import {agentQualityReport} from '@/lib/agent-quality';

export async function GET(request:Request){try{
 await requireOperationsAdmin(request);
 const days=Math.min(90,Math.max(1,Number(new URL(request.url).searchParams.get('days')||7)||7));
 return Response.json(await agentQualityReport(days),{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return failure(error);}}
