import {identity,failure,config,seal} from '@/lib/server';
import {githubOAuthReady} from '@/lib/github';
// Starts the user's GitHub connection: a sealed, short-lived state ties the answer to this user.
export async function GET(request:Request){try{
 const {user}=await identity(request,'write'),origin=new URL(request.url).origin;
 if(!githubOAuthReady())return Response.redirect(origin+'/?settings=connections&github=unavailable',302);
 const state=await seal(JSON.stringify({u:user.userId,exp:Date.now()+600000,n:crypto.randomUUID()}));
 const url=new URL('https://github.com/login/oauth/authorize');
 url.searchParams.set('client_id',String((config() as Record<string,unknown>).GITHUB_CLIENT_ID));url.searchParams.set('scope','repo read:user');
 url.searchParams.set('redirect_uri',origin+'/api/github/callback');url.searchParams.set('state',state);url.searchParams.set('allow_signup','true');
 return new Response(null,{status:302,headers:{Location:url.href,'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
