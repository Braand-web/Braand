import {identity,failure,auditLog} from '@/lib/server';
import {githubConnection,githubOAuthReady,removeGithubConnection} from '@/lib/github';
// The signed-in user's GitHub connection: whether it is available, who is connected. Never the token.
export async function GET(request:Request){try{const {user}=await identity(request);const row=await githubConnection(user.userId).catch(()=>null);return Response.json({available:githubOAuthReady(),connected:!!row,login:row?.login??null,scopes:row?.scopes??null,since:row?.created_at??null},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
export async function DELETE(request:Request){try{const {tenant,user}=await identity(request,'write');await removeGithubConnection(user.userId);await auditLog(tenant,user.userId,'github.disconnected',user.userId,{});return Response.json({connected:false},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return failure(error);}}
