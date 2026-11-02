import {privateJSON} from '@/lib/private-json';
import {z} from 'zod';
import {identity,failure} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {listConnectorToolkits,authorizeConnector,revokeConnector,decideConnectorAction,connectorHeaders} from '@/lib/composio';
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){try{
 const who=await identity(request),{path}=await context.params;
 if(path.length===1&&path[0]==='toolkits')return Response.json(await listConnectorToolkits(who,new URL(request.url).searchParams),{headers:connectorHeaders});
 throw new AppError('Route introuvable.',404);
}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('Origine non autorisée.',403);
 const who=await identity(request),{path}=await context.params;
 const body=await privateJSON(request,1048576);
 if(path.length===1&&path[0]==='authorize')return Response.json(await authorizeConnector(who,z.object({toolkit:z.string()}).strict().parse(body).toolkit),{headers:connectorHeaders});
 if(path.length===2&&path[0]==='approvals')return Response.json(await decideConnectorAction(who,path[1],z.object({decision:z.enum(['approve','reject'])}).strict().parse(body).decision),{headers:connectorHeaders});
 throw new AppError('Route introuvable.',404);
}catch(error){return failure(error);}}
export async function DELETE(request:Request,context:Context){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('Origine non autorisée.',403);
 const who=await identity(request),{path}=await context.params;
 if(path.length===2&&path[0]==='accounts')return Response.json(await revokeConnector(who,z.string().min(1).max(200).parse(path[1])),{headers:connectorHeaders});
 throw new AppError('Route introuvable.',404);
}catch(error){return failure(error);}}
