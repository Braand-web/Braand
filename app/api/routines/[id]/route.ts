import {privateJSON} from '@/lib/private-json';
import {identity,failure} from '@/lib/server';
import {getRoutine,commandRoutine} from '@/lib/routines';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{return Response.json(await getRoutine((await identity(request)).tenant,(await context.params).id),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request,context:Context){try{return Response.json(await commandRoutine(await identity(request,'read'),(await context.params).id,await privateJSON(request,1048576)),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
