import type {BrowserDriver,BrowserReceipt} from './browser-contracts';
import {createBrowserDriver,BrowserDriverError} from './browser-driver';
import {normalizeBrowserDomains} from './browser-policy.mjs';
import {webProviderSettings} from './web-providers';
const endpoint='https://api.browserbase.com/v1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hosts=new Set(['connect.usw2.browserbase.com','connect.browserbase.com','connect.us-west-2.browserbase.com','connect.us-east-1.browserbase.com','connect.eu-central-1.browserbase.com','connect.ap-southeast-1.browserbase.com']);
type Settings={WEB_PROVIDERS_JSON?:string;DB?:D1Database};
export function browserbaseConfigured(env:Settings){try{const p=webProviderSettings(env).browserbase;return !!p?.enabled&&p.verified;}catch{return false;}}
export function browserbasePrice(env:Settings){
 const p=webProviderSettings(env).browserbase;if(!p?.enabled||!p.verified)throw new BrowserDriverError('browser_not_ready');
 // Free allowance only: no conversion or invented paid tariff is used.
 return {provider:'browserbase' as const,freeOnly:true,usdPerBrowserHour:0,infrastructureUsdPerHour:0,usdXaf:0,verifiedAt:p.verifiedAt||'1970-01-01T00:00:00.000Z',source:'https://www.browserbase.com/pricing'};
}
export function createBrowserbaseTransport(env:Settings,scopeId:()=>Promise<string|undefined>=async()=>undefined,transport:typeof fetch=fetch){
 const p=webProviderSettings(env).browserbase;if(!p?.enabled||!p.verified||!env.DB)throw new BrowserDriverError('browser_not_ready');
 const targets=new Map<string,string>();let seconds=p.maxSessionSeconds;
 async function request(path:string,body?:unknown){
  let response:Response;try{response=await transport(endpoint+path,{method:body===undefined?'GET':'POST',headers:{'X-BB-API-Key':p!.apiKey,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}catch{throw new BrowserDriverError('browser_provider_uncertain');}
  if(!response.ok)throw new BrowserDriverError(response.status===402||response.status===429?'browser_provider_quota':'browser_provider_unavailable');
  const length=Number(response.headers.get('content-length')||0);if(length>262144)throw new BrowserDriverError('browser_provider_invalid');
  const reader=response.body?.getReader();if(!reader)throw new BrowserDriverError('browser_provider_invalid');let text='',bytes=0;const decoder=new TextDecoder();
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>262144)throw new BrowserDriverError('browser_provider_invalid');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();return JSON.parse(text) as Record<string,unknown>;}catch{throw new BrowserDriverError('browser_provider_invalid');}finally{await reader.cancel().catch(()=>{});}
 }
 async function allowance(){
  const raw=await request('/projects');if(!Array.isArray(raw)||raw.length!==1||!uuid.test(String(raw[0]?.id)))throw new BrowserDriverError('browser_project_ambiguous');
  const usage=await request('/projects/'+raw[0].id+'/usage'),minutes=Number(usage.browserMinutes);if(!Number.isFinite(minutes)||minutes<0)throw new BrowserDriverError('browser_provider_usage_unknown');
  const id=await scopeId(),reserved=await env.DB!.prepare("SELECT COALESCE(SUM(max_seconds),0) n FROM browser_sessions WHERE (active=1 OR provider_state IN ('opening','open','closing')) AND id<>?").bind(id||'').first<{n:number}>();
  if(minutes*60+Number(reserved?.n||0)+seconds>p!.maxBrowserMinutes*60)throw new BrowserDriverError('browser_provider_quota');
 }
 async function release(id:string){if(!uuid.test(id))throw new BrowserDriverError('browser_invalid_session');await request('/sessions/'+id,{status:'REQUEST_RELEASE'});targets.delete(id);}
 async function receipt(id:string):Promise<Omit<BrowserReceipt,'sessionId'>>{
  try{if(!uuid.test(id))throw new Error();const row=await request('/sessions/'+id),start=Date.parse(String(row.startedAt)),end=Date.parse(String(row.endedAt));if(!['COMPLETED','ERROR','TIMED_OUT'].includes(String(row.status))||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end>Date.now()+300000||end-start>86400000)throw new Error();return{status:'complete',milliseconds:end-start,source:'provider_history'};}catch{return{status:'unknown',source:'provider_history'};}
 }
 // Adapt the existing Cloudflare Playwright transport instead of adding a second
 // automation engine. Only the SDK's closed acquire/upgrade paths are accepted.
 const binding={async fetch(input:RequestInfo|URL,init?:RequestInit){
  const req=input instanceof Request?input:new Request(input,init),url=new URL(req.url);
  try{
   if(url.hostname!=='fake.host')throw new Error();
   if(req.method==='POST'&&url.pathname==='/v1/devtools/browser'){
    const payload=await req.json() as {guardrails?:{allowedDomains?:unknown}},domains=normalizeBrowserDomains(payload.guardrails?.allowedDomains);await allowance();
    const session=await request('/sessions',{timeout:seconds,keepAlive:false,proxies:false,browserSettings:{viewport:{width:1280,height:720},allowedDomains:domains,recordSession:false,logSession:false,solveCaptchas:false}});
    const id=String(session.id);let connect:URL;
    try{connect=new URL(String(session.connectUrl));const signed=connect.searchParams.get('signingKey'),sessionId=connect.searchParams.get('sessionId'),key=connect.searchParams.get('apiKey');if(!uuid.test(id)||connect.protocol!=='wss:'||!hosts.has(connect.hostname)||connect.port||connect.username||connect.password||connect.hash||connect.pathname!=='/'||sessionId!==null&&sessionId!==id||key!==null&&key!==p!.apiKey||sessionId===null&&(!signed||signed.length<16||signed.length>8192))throw new Error();}catch{if(uuid.test(id))await release(id).catch(()=>{});throw new BrowserDriverError('browser_cdp_url_invalid');}
    targets.set(id,connect.toString());return Response.json({sessionId:id});
   }
   const match=url.pathname.match(/^\/v1\/devtools\/browser\/([a-f0-9-]{36})$/i),id=match?.[1];
   if(req.method!=='GET'||req.headers.get('upgrade')?.toLowerCase()!=='websocket'||!id||!targets.has(id))throw new Error();
   const connect=new URL(targets.get(id)!);connect.protocol='https:';
   try{const response=await transport(connect,{headers:{Upgrade:'websocket'},signal:AbortSignal.timeout(15000)});if(!response.webSocket||response.status!==101)throw new Error();return response;}catch{await release(id).catch(()=>{});throw new BrowserDriverError('browser_cdp_connection_failed');}
  }catch(error){return Response.json({code:error instanceof BrowserDriverError?error.code:'browser_provider_unavailable'},{status:409});}
 }} as Fetcher;
 return {binding,lifecycle:{provider:'browserbase' as const,beforeOpen:async(input:{timeoutSeconds?:number})=>{seconds=Math.max(60,Math.min(p.maxSessionSeconds,input.timeoutSeconds||p.maxSessionSeconds));},receipt,terminate:release}};
}

export function createBrowserbaseDriver(env:Settings,scopeId:()=>Promise<string|undefined>=async()=>undefined,transport:typeof fetch=fetch):BrowserDriver{
 const adapter=createBrowserbaseTransport(env,scopeId,transport);return createBrowserDriver(adapter.binding,undefined,adapter.lifecycle);
}
