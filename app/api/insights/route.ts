import {z} from 'zod';
import {identity,failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {listInsights,updateInsight} from '@/lib/watch';
export async function GET(request:Request){try{const {tenant}=await identity(request);return Response.json({insights:await listInsights(tenant)},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function PATCH(request:Request){try{const {tenant}=await identity(request,'write');const p=z.object({id:z.string().min(1).max(200),action:z.enum(['investigate','dismiss'])}).strict().parse(await privateJSON(request,4096));return Response.json(await updateInsight(tenant,p.id,p.action),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
