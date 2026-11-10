import {failure} from '@/lib/server';
import {receiveAgentEvent} from '@/lib/agent-events-webhook';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await receiveAgentEvent(request,(await params).id),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
