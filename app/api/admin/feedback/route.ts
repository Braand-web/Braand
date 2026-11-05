import {failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {requirePlatformAdmin} from '@/lib/platform-admin';
import {adminFeedbackAction,adminFeedbackOverview} from '@/lib/feedback';
// Team moderation: platform admins only, checked on the server for every call.
export async function GET(request:Request){try{await requirePlatformAdmin(request);return Response.json(await adminFeedbackOverview(),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const who=await requirePlatformAdmin(request);const body=await privateJSON(request,16384),result=await adminFeedbackAction(who.user.userId,body);
 const {auditLog}=await import('@/lib/server');await auditLog('platform',who.user.userId,'admin.feedback.'+String((body as {action?:string}).action),String((body as {postId?:string;sourceId?:string;commentId?:string;reportId?:string}).postId||(body as {sourceId?:string}).sourceId||(body as {commentId?:string}).commentId||(body as {reportId?:string}).reportId||'feedback'),{});
 return Response.json(result);}catch(error){return failure(error);}}
