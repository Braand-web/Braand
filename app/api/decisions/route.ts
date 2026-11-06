import {identity,failure} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {decisionOrigin,pendingDecisions} from '@/lib/decisions';
// GET ?conversationId=… → decisions waiting in that conversation.
// GET ?origin=<id> → the conversation where that item is decided (null if made by hand).
export async function GET(request:Request){try{
 const {tenant}=await identity(request),url=new URL(request.url);
 const conversationId=url.searchParams.get('conversationId'),origin=url.searchParams.get('origin');
 if(conversationId&&conversationId.length<=160)return Response.json({decisions:await pendingDecisions(tenant,conversationId)},{headers:{'Cache-Control':'no-store'}});
 if(origin&&origin.length<=160)return Response.json({conversationId:await decisionOrigin(tenant,origin)},{headers:{'Cache-Control':'no-store'}});
 throw new AppError('Discussion ou élément requis.',400);
}catch(error){return failure(error);}}
