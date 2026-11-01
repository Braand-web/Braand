import {identity,failure} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {browserService,requireBrowserOrigin} from '@/lib/browser';
import {ensureModelPricing} from '@/lib/model-pricing';
import {getBrowserPermissions,setBrowserPermissions} from '@/lib/browser-permissions';
import {vaultRequest,vaultSensitiveRequest} from '@/lib/browser-vault';
import {privateJSON} from '@/lib/private-json';

const body=privateJSON;
async function handle(request:Request){try{
 requireBrowserOrigin(request);
 if(request.headers.get('sec-fetch-site')==='cross-site')throw new AppError('Origine du navigateur non autorisée.',403,'browser_origin_required');
 const who=await identity(request),url=new URL(request.url),path=url.pathname.replace(/^\/api\/browser\/?/u,'').split('/').filter(Boolean).map(decodeURIComponent),method=request.method;
 try{await ensureModelPricing(Date.now(),false);}catch{/* Readiness may report unavailable, but session control never waits on a pricing source. */}
 let result:unknown;
 if(method==='GET'&&!path.length)result=await browserService.list(who);
 else if(path[0]==='permissions'&&path.length===1&&method==='GET')result=await getBrowserPermissions(who);
 else if(path[0]==='permissions'&&path.length===1&&method==='POST')result=await setBrowserPermissions(who,await body(request));
 else if(path[0]==='vault'&&method==='GET'&&path.length===1){try{result=await vaultRequest(who,'/list');}catch(error){if(error instanceof AppError&&error.code==='vault_unavailable')result={ready:false,credentials:[],history:[]};else throw error;}}
 else if(path[0]==='vault'&&method==='POST'&&['capture-ticket','save','fill','delete','permission','otp'].includes(path[1])){
  const operation=path.slice(1).join('/');if(!['capture-ticket','save','fill','delete','permission','otp/prepare','otp/fill'].includes(operation))throw new AppError('Route du coffre introuvable.',404);
  result=operation==='save'||operation==='otp/fill'?await vaultSensitiveRequest(who,'/'+operation as '/save'|'/otp/fill',request):await vaultRequest(who,'/'+operation,await body(request));
 }
 else if(path[0]==='profiles'&&path.length===1&&method==='GET')result=await browserService.profiles(who);
 else if(path[0]==='profiles'&&path.length===2&&method==='DELETE')result=await browserService.deleteProfile(who,path[1]);
 else if(path[0]==='sessions'&&path.length===1&&method==='POST')result=await browserService.create(who,await body(request));
 else if(path[0]==='sessions'&&path[1]){
  const id=path[1];
  if(path.length===2&&method==='GET')result=await browserService.get(who,id);
  else if(path.length===3&&path[2]==='live'&&method==='GET')result=await browserService.connectLive(who,id,request);
  else if(path.length===3&&path[2]==='input'&&method==='POST')result=await browserService.humanInput(who,id,await body(request));
  else if(path.length===2&&method==='DELETE'){const session=await browserService.get(who,id);result=await browserService.control(who,id,{action:'close',version:session.version});}
  else if(path.length===3&&path[2]==='activate'&&method==='POST')result=await browserService.activate(who,id,await body(request));
  else if(path.length===3&&path[2]==='reconcile'&&method==='POST')result=await browserService.reconcile(who,id,await body(request));
  else if(path.length===3&&path[2]==='control'&&method==='POST')result=await browserService.control(who,id,await body(request));
  else if(path.length===3&&path[2]==='actions'&&method==='POST'){const data=await body(request);if(!data||typeof data!=='object'||!('command' in data))throw new AppError('Commande requise.');result=await browserService.step(who,id,data.command,'human' in data&&data.human===true);}
  else if(path.length===4&&path[2]==='actions'&&method==='POST')result=await browserService.decide(who,id,path[3],await body(request));
  else if(path.length===3&&path[2]==='events'&&method==='GET')result=await browserService.events(who,id,Number(url.searchParams.get('after')||0));
  else if(path.length===3&&path[2]==='view'&&method==='GET')result=await browserService.frame(who,id);
  else if(path.length===3&&path[2]==='snapshot'&&method==='GET')result=await browserService.snapshot(who,id,url.searchParams.get('human')==='1');
  else if(path.length===3&&path[2]==='artifacts'&&method==='GET')result=await browserService.artifacts(who,id);
  else if(path[2]==='artifacts'&&path[3]&&((path.length===4)||(path.length===5&&path[4]==='download'))&&method==='GET')result=await browserService.download(who,id,path[3]);
  else if(path.length===5&&path[2]==='artifacts'&&path[4]==='export'&&method==='POST')result=await browserService.exportArtifact(who,id,path[3]);
  else throw new AppError('Route navigateur introuvable.',404,'browser_route_not_found');
 }else throw new AppError('Route navigateur introuvable.',404,'browser_route_not_found');
 if(result instanceof Response)return result;
 return Response.json(result,{headers:{'cache-control':'private, no-store','cross-origin-resource-policy':'same-origin'}});
 }catch(error){const response=failure(error);response.headers.set('cache-control','private, no-store');return response;}}
export const GET=handle;
export const POST=handle;
export const DELETE=handle;
