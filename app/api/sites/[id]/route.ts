import {privateJSON} from '@/lib/private-json';
import {identity,failure} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {listSiteFiles,sitePreviewUrl,siteLeads,prepareSitePublication,approveSitePublication,suspendSitePublication} from '@/lib/sites';
import {z} from 'zod';

// Publication is only ever triggered here, by the signed-in user's click.
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{
 const who=await identity(request),{id}=await context.params,url=new URL(request.url);
 if(url.searchParams.has('preview'))return Response.json(await sitePreviewUrl(who,id));
 if(url.searchParams.has('leads'))return Response.json({leads:await siteLeads(who,id)});
 return Response.json(await listSiteFiles(who,{siteId:id}));
}catch(error){return failure(error);}}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const who=await identity(request),{id}=await context.params,body=z.object({action:z.enum(['prepare','publish','suspend'])}).passthrough().parse(await privateJSON(request,65536));
 if(body.action==='prepare')return Response.json(await prepareSitePublication(who,id,body));
 if(body.action==='publish')return Response.json(await approveSitePublication(who,id,body));
 if(body.action==='suspend')return Response.json(await suspendSitePublication(who,id));
 throw new AppError('Action inconnue.',400);
}catch(error){return failure(error);}}
