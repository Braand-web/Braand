import {workflowCSV} from '@/lib/workflow-contract';
import {identity,failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {operationScope,listAgentOperations,commandOperation,testWorkflow,operationResource} from '@/lib/agent-operations';
import {commandSubscription} from '@/lib/agent-events-webhook';
import {z} from 'zod';
import {AppError} from '@/lib/core.mjs';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){try{
 const who=await identity(request),url=new URL(request.url),conversationId=url.searchParams.get('conversationId');if(!conversationId)throw new AppError('Discussion requise.',400);
 const scope=await operationScope(who,conversationId),id=url.searchParams.get('id');
 if(id&&url.searchParams.get('format')==='csv'){
  const result=await operationResource(scope,id,'workflow_run');if(result.status!=='completed'||!Array.isArray(result.data.rows))throw new AppError('Résultat indisponible.',409);
  return new Response(workflowCSV(result.data.rows),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="resultat.csv"'}});
 }
 return Response.json(await listAgentOperations(scope),{headers});
 }catch(error){return failure(error);}}
export async function POST(request:Request){try{
 const who=await identity(request),{conversationId,kind,...body}=z.object({conversationId:z.string().min(1).max(160),kind:z.enum(['workflow','event_subscription'])}).passthrough().parse(await privateJSON(request,220000)),scope=await operationScope(who,conversationId);
 const result=kind==='event_subscription'?await commandSubscription(scope,body):body.action==='test'?await testWorkflow(scope,{id:body.id,version:body.version}):await commandOperation(scope,body);
 return Response.json(result,{headers});
 }catch(error){return failure(error);}}
