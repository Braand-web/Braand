import type {BrowserDriver,BrowserLoginTarget} from './browser-contracts';
import {getBrowserPermissions} from './browser-permissions';
import {openBrowserEnvelope} from '../services/credential-vault/crypto.mjs';
import type {BillingIdentity} from './billing';
import {authorize} from './server';
type Target={nonce:string;expiresAt:number;keys:CryptoKeyPair;target:BrowserLoginTarget;provider:string;workspace:string;user:string};
// Lives only in the browser owner. The main agent has no decrypt/read operation.
export class BrowserCredentialBroker {
 private ticket:Target|null=null;
 constructor(private env:Cloudflare.Env,private driver:BrowserDriver){}
 async handle(request:Request){
  const key=this.env.VAULT_BROWSER_TOKEN;
  if(this.env.BROWSER_ENABLED!=='true'||!key||key.length<32||request.headers.get('authorization')!=='Bearer '+key)return Response.json({code:'vault_denied'},{status:403});
  try{
   const text=await request.text();if(text.length>24000)throw Error();
   const p=JSON.parse(text) as Record<string,unknown>;
   if(typeof p.id!=='string'||typeof p.workspaceId!=='string'||typeof p.userId!=='string')throw Error();
   const row=await this.env.DB!.prepare('SELECT * FROM browser_sessions WHERE id=? AND workspace_id=? AND user_id=?').bind(p.id,p.workspaceId,p.userId).first<{id:string;workspace_id:string;user_id:string;organization_id:string;provider_id:string;active:number;status:string;control:string;lease_token:string|null;lease_until:number;expires_at:number;execution_source:string;otp_attempts:number}>();
   if(!row||!row.active||row.expires_at<=Date.now()||!row.provider_id||row.execution_source==='background')throw Error();
   const who:BillingIdentity={tenant:row.workspace_id,organization:row.organization_id,user:{userId:row.user_id,email:'',displayName:''},role:''};
   await authorize(who.tenant,who.user.userId,'write');
   const permissions=await getBrowserPermissions(who);
   if(permissions.credentials==='deny'||!['running','awaiting_login','paused'].includes(row.status))throw Error();
   const release=async()=>{if(this.ticket)await this.env.DB!.prepare('UPDATE browser_sessions SET lease_token=NULL,lease_until=0,observation=NULL WHERE id=? AND lease_token=?').bind(p.id,this.ticket.nonce).run();this.ticket=null;};
   if(p.operation==='abort'){if(this.ticket?.nonce===p.nonce)await release();return Response.json({released:true});}
   if(p.operation==='prepare'){
    if(this.ticket&&this.ticket.expiresAt<Date.now())await release();
    if(this.ticket||row.lease_token||(p.approved!==true&&permissions.credentials!=='allow')||(p.approved!==true&&row.control!=='agent')||!['password','otp'].includes(String(p.method)))throw Error();
    if(p.method==='otp'&&row.otp_attempts>=2)throw Error();
    const nonce=crypto.randomUUID(),expiresAt=Date.now()+30000;
    const claim=await this.env.DB!.prepare("UPDATE browser_sessions SET lease_token=?,lease_until=?,last_error='browser_secure_input_pending' WHERE id=? AND lease_token IS NULL AND active=1").bind(nonce,expiresAt,row.id).run();if(!claim.meta.changes)throw Error();
    try{
     if(!this.driver.loginTarget)throw Error();
     const target=await this.driver.loginTarget(row.provider_id,p.method as 'password'|'otp');
     const keys=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
     this.ticket={nonce,expiresAt,target,keys,provider:row.provider_id,workspace:row.workspace_id,user:row.user_id};
    }catch(error){await this.env.DB!.prepare('UPDATE browser_sessions SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(row.id,nonce).run();throw error;}
   }
   const ticket=this.ticket;
   if(!ticket||ticket.nonce!==p.nonce&&p.operation!=='prepare'||ticket.expiresAt<Date.now()||ticket.workspace!==p.workspaceId||ticket.user!==p.userId)throw Error();
   if(p.operation==='prepare'||p.operation==='target')return Response.json({nonce:ticket.nonce,expiresAt:ticket.expiresAt,origin:ticket.target.origin,publicKey:await crypto.subtle.exportKey('jwk',ticket.keys.publicKey)});
   if(p.operation!=='fill'||row.lease_token!==ticket.nonce||!this.driver.fillLogin)throw Error();
   // Consume before decrypt/dispatch. Unknown completion cannot be retried with this nonce.
   this.ticket=null;
   let secret:{username?:string;password?:string;code?:string}|undefined;
   try{
    secret=await openBrowserEnvelope(ticket.keys.privateKey,ticket.nonce,p.envelope);
    await this.env.DB!.prepare("UPDATE browser_sessions SET last_error='browser_secure_input_dispatching',otp_attempts=otp_attempts+? WHERE id=? AND lease_token=?").bind(ticket.target.method==='otp'?1:0,row.id,ticket.nonce).run();
    await this.driver.configureNetwork?.(ticket.provider,{submit:'deny',download:'deny',approvedAction:false});
    await this.driver.fillLogin(ticket.provider,ticket.target,secret!);
    return Response.json({filled:true});
   }finally{if(secret){secret.username='';secret.password='';secret.code='';}await this.env.DB!.prepare('UPDATE browser_sessions SET lease_token=NULL,lease_until=0,observation=NULL,last_error=NULL WHERE id=? AND lease_token=?').bind(row.id,ticket.nonce).run();}
  }catch{return Response.json({code:'vault_browser_not_ready'},{status:409});}
 }
}
