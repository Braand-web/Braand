import {identity,config,unseal,auditLog} from '@/lib/server';
import {githubOAuthReady,saveGithubConnection} from '@/lib/github';
// GitHub sends the user back here: check the sealed state, exchange the code
// for a token server-side, store it sealed, and return to Settings › Connexions.
export async function GET(request:Request){
 const url=new URL(request.url),back=(status:string)=>new Response(null,{status:302,headers:{Location:url.origin+'/?settings=connections&github='+status,'Cache-Control':'no-store'}});
 try{
  const {tenant,user}=await identity(request,'write');
  if(!githubOAuthReady())return back('unavailable');
  if(url.searchParams.get('error'))return back('cancelled');
  const code=url.searchParams.get('code')||'',rawState=url.searchParams.get('state')||'';
  let state:{u?:string;exp?:number}={};try{state=JSON.parse(await unseal(rawState));}catch{return back('invalid');}
  if(state.u!==user.userId||!state.exp||state.exp<Date.now()||!/^[\w-]{4,80}$/.test(code))return back('invalid');
  const c=config() as Record<string,unknown>;
  const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'Braand'},body:JSON.stringify({client_id:c.GITHUB_CLIENT_ID,client_secret:c.GITHUB_CLIENT_SECRET,code,redirect_uri:url.origin+'/api/github/callback'}),signal:AbortSignal.timeout(12000)});
  const token=await exchange.json().catch(()=>({})) as {access_token?:string;scope?:string};
  if(!exchange.ok||typeof token.access_token!=='string')return back('failed');
  const me=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','User-Agent':'Braand'},signal:AbortSignal.timeout(12000)});
  const profile=await me.json().catch(()=>({})) as {login?:string};
  if(!me.ok||typeof profile.login!=='string')return back('failed');
  await saveGithubConnection(user.userId,profile.login,token.access_token,String(token.scope||''));
  await auditLog(tenant,user.userId,'github.connected',user.userId,{login:profile.login});
  return back('connected');
 }catch{return back('failed');}
}
