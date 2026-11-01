import {z} from 'zod';
import {validateBrowserURL} from '../../lib/browser-policy.mjs';
import {b64,openCredential,sealCredential,sealForBrowser} from './crypto.mjs';
interface VaultEnv {VAULT_DB:D1Database;VAULT_MASTER_KEY:string;VAULT_CALL_TOKEN:string;VAULT_BROWSER_TOKEN:string;VAULT_ENABLED:string;BROWSER_SESSIONS:DurableObjectNamespace}
const reference=z.string().min(1).max(160),origin=z.string().max(1024).transform(value=>validateBrowserURL(value).origin);
const saveInput=z.object({captureToken:z.string().min(20).max(100),origin,label:z.string().trim().min(1).max(120),username:z.string().max(1000),password:z.string().min(1).max(4096),persist:z.boolean().default(true),usagePermission:z.enum(['auto','ask']).default('ask'),sessionId:z.string().uuid().optional(),approved:z.boolean().optional()}).strict();
const fillInput=z.object({credentialId:z.string().uuid(),sessionId:z.string().uuid(),approved:z.boolean().optional()}).strict();
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function body(request:Request){
 const reader=request.body?.getReader();if(!reader)throw Error('vault_input_invalid');
 const parts:Uint8Array[]=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>16384){await reader.cancel();throw Error('vault_input_invalid');}parts.push(part.value);}const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}try{return JSON.parse(new TextDecoder().decode(all));}finally{all.fill(0);for(const part of parts)part.fill(0);}}finally{reader.releaseLock();}
}
const scope=(user:string,workspace:string,id:string,site:string,permission:string,version:number)=>JSON.stringify([workspace,user,id,site,'password',permission,version]);
const digest=async(value:string)=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const credentialVault={async fetch(request:Request,env:VaultEnv){
 if(env.VAULT_ENABLED!=='true'||!env.VAULT_DB||!env.VAULT_MASTER_KEY||!env.VAULT_CALL_TOKEN||env.VAULT_CALL_TOKEN.length<32||!env.VAULT_BROWSER_TOKEN||env.VAULT_BROWSER_TOKEN.length<32||!env.BROWSER_SESSIONS)return json({code:'vault_unavailable'},503);
 if(new URL(request.url).hostname!=='vault.internal'||request.headers.get('authorization')!=='Bearer '+env.VAULT_CALL_TOKEN)return json({code:'vault_denied'},403);
 const workspace=reference.safeParse(request.headers.get('x-workspace-id')),user=reference.safeParse(request.headers.get('x-user-id'));
 if(!workspace.success||!user.success)return json({code:'vault_denied'},403);
 const w=workspace.data,u=user.data,sql=(query:string,...args:(string|number|null)[])=>env.VAULT_DB.prepare(query).bind(...args),url=new URL(request.url);
 const metadata=(row:Record<string,unknown>)=>({id:row.id,origin:row.origin,label:row.label,method:row.method,usagePermission:row.usage_permission,version:row.version,lastUsedAt:row.last_used_at,createdAt:row.created_at});
 async function credential(id:string){const row=await sql('SELECT * FROM vault_credentials WHERE id=? AND workspace_id=? AND user_id=?',id,w,u).first<Record<string,unknown>>();if(!row)throw Error('vault_entry_missing');return row;}
 async function broker(sessionId:string,operation:string,data:Record<string,unknown>={}){
  const stub=env.BROWSER_SESSIONS.get(env.BROWSER_SESSIONS.idFromName(sessionId));
  const response=await stub.fetch('https://browser.internal/vault',{method:'POST',headers:{authorization:'Bearer '+env.VAULT_BROWSER_TOKEN,'content-type':'application/json'},body:JSON.stringify({id:sessionId,workspaceId:w,userId:u,operation,...data})});
  if(!response.ok)throw Error('vault_browser_not_ready');
  return await response.json() as {nonce:string;origin:string;publicKey:JsonWebKey;expiresAt:number};
 }
 async function fill(sessionId:string,secret:{username?:string;password?:string;code?:string},method:'password'|'otp',expectedOrigin?:string,nonce?:string,approved=false){
  const target=await broker(sessionId,nonce?'target':'prepare',{method,approved,...(nonce?{nonce}:{})});
  try{if(expectedOrigin&&target.origin!==expectedOrigin)throw Error('vault_origin_mismatch');const envelope=await sealForBrowser(target.publicKey,target.nonce,secret);await broker(sessionId,'fill',{nonce:target.nonce,envelope});return target.origin;}
  catch(error){await broker(sessionId,'abort',{nonce:target.nonce}).catch(()=>{});throw error;}
 }
 async function log(id:string|null,site:string,session:string|null,result:string){await sql('INSERT INTO vault_login_log(id,workspace_id,user_id,credential_id,origin,session_id,result,created_at) VALUES (?,?,?,?,?,?,?,?)',crypto.randomUUID(),w,u,id,site,session,result,Date.now()).run();}
 try{
  if(request.method==='GET'&&url.pathname==='/list'){
   const rows=await sql('SELECT id,origin,label,method,usage_permission,version,last_used_at,created_at FROM vault_credentials WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100',w,u).all<Record<string,unknown>>();
   const history=await sql('SELECT id,origin,result,created_at FROM vault_login_log WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50',w,u).all();
   return json({ready:true,credentials:rows.results.map(metadata),history:history.results});
  }
  if(request.method!=='POST')return json({code:'vault_route_missing'},404);
  if(url.pathname==='/capture-ticket'){
   await sql('DELETE FROM vault_capture_tokens WHERE expires_at<?',Date.now()).run();
   const count=await sql('SELECT count(*) n FROM vault_capture_tokens WHERE workspace_id=? AND user_id=?',w,u).first<{n:number}>();if((count?.n||0)>=10)throw Error('vault_rate_limited');
   const token=b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt=Date.now()+300000;
   await sql('INSERT INTO vault_capture_tokens(digest,workspace_id,user_id,expires_at) VALUES (?,?,?,?)',await digest(token),w,u,expiresAt).run();return json({token,expiresAt});
  }
  const value=await body(request);
  if(url.pathname==='/save'){
   const p=saveInput.parse(value),claim=await sql('DELETE FROM vault_capture_tokens WHERE digest=? AND workspace_id=? AND user_id=? AND expires_at>?',await digest(p.captureToken),w,u,Date.now()).run();if(!claim.meta.changes)throw Error('vault_capture_expired');
   try{
    if(!p.persist){if(!p.sessionId||p.approved!==true)throw Error('vault_approval_required');await fill(p.sessionId,{username:p.username,password:p.password},'password',p.origin,undefined,true);await log(null,p.origin,p.sessionId,'filled_once_not_submitted');return json({saved:false,filled:true});}
    const count=await sql('SELECT count(*) n FROM vault_credentials WHERE workspace_id=? AND user_id=?',w,u).first<{n:number}>();if((count?.n||0)>=100)throw Error('vault_rate_limited');
    const id=crypto.randomUUID(),cipher=await sealCredential(env.VAULT_MASTER_KEY,scope(u,w,id,p.origin,p.usagePermission,1),{username:p.username,password:p.password});
    await sql("INSERT INTO vault_credentials(id,workspace_id,user_id,origin,label,method,cipher,usage_permission,created_at) VALUES (?,?,?,?,?,'password',?,?,?)",id,w,u,p.origin,p.label,JSON.stringify(cipher),p.usagePermission,Date.now()).run();return json({saved:true,credential:metadata(await credential(id))});
   }finally{p.username='';p.password='';}
  }
  if(url.pathname==='/fill'){
   const p=fillInput.parse(value),entry=await credential(p.credentialId);
   if(p.approved!==true&&entry.usage_permission!=='auto')return json({code:'vault_approval_required'},409);
   const secret=await openCredential(env.VAULT_MASTER_KEY,scope(u,w,p.credentialId,String(entry.origin),String(entry.usage_permission),Number(entry.version)),JSON.parse(String(entry.cipher)));
   try{await fill(p.sessionId,secret,'password',String(entry.origin),undefined,p.approved===true);await sql('UPDATE vault_credentials SET last_used_at=? WHERE id=? AND workspace_id=? AND user_id=?',Date.now(),p.credentialId,w,u).run();await log(p.credentialId,String(entry.origin),p.sessionId,'filled_not_submitted');return json({filled:true});}
   catch(error){await log(p.credentialId,String(entry.origin),p.sessionId,'blocked');throw error;}
   finally{secret.username='';secret.password='';}
  }
  if(url.pathname==='/otp/prepare'){
   const p=z.object({sessionId:z.string().uuid()}).strict().parse(value),target=await broker(p.sessionId,'prepare',{method:'otp',approved:true});return json({ready:true,nonce:target.nonce,origin:target.origin,expiresAt:target.expiresAt});
  }
  if(url.pathname==='/otp/fill'){
   const p=z.object({sessionId:z.string().uuid(),nonce:z.string().uuid(),code:z.string().min(4).max(32)}).strict().parse(value);
   try{const site=await fill(p.sessionId,{code:p.code},'otp',undefined,p.nonce);await log(null,site,p.sessionId,'code_filled_not_submitted');return json({filled:true});}finally{p.code='';}
  }
  if(url.pathname==='/delete'){
   const p=z.object({id:z.string().uuid(),version:z.number().int().positive()}).strict().parse(value),entry=await credential(p.id);
   const result=await sql('DELETE FROM vault_credentials WHERE id=? AND workspace_id=? AND user_id=? AND version=?',p.id,w,u,p.version).run();if(!result.meta.changes)throw Error('vault_stale_entry');await log(null,String(entry.origin),null,'deleted');return json({deleted:true});
  }
  if(url.pathname==='/permission'){
   const p=z.object({id:z.string().uuid(),version:z.number().int().positive(),usagePermission:z.enum(['auto','ask'])}).strict().parse(value);
   const entry=await credential(p.id);if(Number(entry.version)!==p.version)throw Error('vault_stale_entry');
   const secret=await openCredential(env.VAULT_MASTER_KEY,scope(u,w,p.id,String(entry.origin),String(entry.usage_permission),p.version),JSON.parse(String(entry.cipher)));
   try{const cipher=await sealCredential(env.VAULT_MASTER_KEY,scope(u,w,p.id,String(entry.origin),p.usagePermission,p.version+1),secret);const result=await sql('UPDATE vault_credentials SET usage_permission=?,cipher=?,version=version+1 WHERE id=? AND workspace_id=? AND user_id=? AND version=?',p.usagePermission,JSON.stringify(cipher),p.id,w,u,p.version).run();if(!result.meta.changes)throw Error('vault_stale_entry');return json({credential:metadata(await credential(p.id))});}finally{secret.username='';secret.password='';}
  }
  return json({code:'vault_route_missing'},404);
 }catch(error){const code=error instanceof Error&&/^vault_[a-z_]+$/.test(error.message)?error.message:'vault_request_rejected';return json({code},409);}
}};
export default credentialVault;
