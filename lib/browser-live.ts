import {browserService} from './browser';
import {runWithBrowserDriver} from './browser-runtime';
import type {BrowserDriver} from './browser-contracts';
import type {BillingIdentity} from './billing';
import {authorize} from './server';
const viewers=new WeakMap<BrowserDriver,()=>void>();
// Only a service-binding upgrade reaches this handler; public auth precedes forwarding.
export async function browserLiveSocket(request:Request,env:Cloudflare.Env,driver:BrowserDriver,ctx:DurableObjectState){
 const id=request.headers.get('x-browser-session'),user=request.headers.get('x-browser-user'),workspace=request.headers.get('x-browser-workspace');
 if(request.headers.get('upgrade')?.toLowerCase()!=='websocket'||!id||!user||!workspace||!env.DB||!driver.live)return new Response(null,{status:409});
 const row=await env.DB.prepare('SELECT organization_id,provider_id FROM browser_sessions WHERE id=? AND workspace_id=? AND user_id=? AND active=1').bind(id,workspace,user).first<{organization_id:string;provider_id:string}>();
 if(!row?.provider_id)return new Response(null,{status:404});
 const who:BillingIdentity={tenant:workspace,organization:row.organization_id,user:{userId:user,email:'',displayName:''},role:''};
 const pair=new WebSocketPair(),client=pair[0],socket=pair[1];socket.accept();
 viewers.get(driver)?.();
 let closed=false,lastSeq=0,processing=false,bytes=0;
 let state=await browserService.get(who,id);
 let stop:(()=>Promise<void>)|undefined;
 const send=(value:unknown)=>{if(!closed&&socket.readyState===1)socket.send(JSON.stringify(value));};
 const close=()=>{if(closed)return;closed=true;clearInterval(timer);void stop?.();try{socket.close(1000,'Session de vue fermée');}catch{/* Already closed. */}};
 const authenticatedUntil=Date.now()+60000;
 const timer=setInterval(()=>{ctx.waitUntil((async()=>{await authorize(who.tenant,who.user.userId,'read');state=await browserService.get(who,id);if(Date.now()>=authenticatedUntil||state.resultReview||state.expiresAt<=Date.now()||['completed','cancelled','failed','expired','uncertain'].includes(state.status))return close();send({type:'state',control:state.control,status:state.status,version:state.version});if(bytes){const count=bytes;bytes=0;await env.DB!.prepare('INSERT INTO billing_meter VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),who.organization,'transfer',count,Date.now()).run();}})().catch(close));},1000);
 viewers.set(driver,close);
 socket.addEventListener('close',close);socket.addEventListener('error',close);
 socket.addEventListener('message',event=>{ctx.waitUntil((async()=>{
  if(closed)return;
  if(typeof event.data!=='string'||event.data.length>12000||processing){send({type:'input_error',code:'browser_input_busy'});return;}
  let seq=0;
  try{const data=JSON.parse(event.data);seq=data.seq;if(data.type!=='input'||!Number.isSafeInteger(seq)||seq<=lastSeq)throw Error();lastSeq=seq;processing=true;
   await runWithBrowserDriver(id,driver,()=>browserService.humanInput(who,id,{version:data.version,input:data.input}));
   send({type:'input_ack',seq});
  }catch{send({type:'input_error',seq,code:'browser_input_rejected'});}finally{processing=false;}
 })());});
 try{const stream=await driver.live(row.provider_id,frame=>{if(closed||frame.image.length>3_000_000)return;bytes+=Math.ceil(frame.image.length*0.75);send({type:'frame',...frame,control:state.control,status:state.status,version:state.version});});stop=stream.close;}
 catch{close();return new Response(null,{status:409});}
 return new Response(null,{status:101,webSocket:client});
}
