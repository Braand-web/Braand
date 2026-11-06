import {z} from 'zod';
import {identity,failure,getResource,auditLog} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {saveEnvValues,envKeyNames} from '@/lib/code-env';
import {AppError} from '@/lib/core.mjs';
// Keys for a project running in this conversation's sandbox. Values go in, only names come out.
const conversation=async(tenant:string,id:string)=>{const r=await getResource(tenant,id);if(r.kind!=='conversation'||r.status==='deleted')throw new AppError('Discussion introuvable.',404);};
export async function GET(request:Request){try{const {tenant}=await identity(request),id=new URL(request.url).searchParams.get('conversationId')||'';await conversation(tenant,id);return Response.json({keys:await envKeyNames(tenant,id)},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 const {tenant,user}=await identity(request,'write');
 const p=z.object({conversationId:z.string().min(1).max(160),values:z.record(z.string().max(4000))}).strict().parse(await privateJSON(request,200000));
 await conversation(tenant,p.conversationId);
 const keys=await saveEnvValues(tenant,p.conversationId,p.values);
 await auditLog(tenant,user.userId,'code.env.saved',p.conversationId,{keys});
 return Response.json({saved:keys},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return failure(error);}}
