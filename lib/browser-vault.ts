import {config,authorize} from './server';
import type {BillingIdentity} from './billing';
import {getBrowserPermissions} from './browser-permissions';
import {AppError} from './core.mjs';
export type VaultEntry={id:string;origin:string;label:string;method:string;usagePermission:'auto'|'ask';version:number;lastUsedAt:number|null;createdAt:number};
export type VaultOverview={ready:boolean;credentials:VaultEntry[];history:{id:string;origin:string;result:string;created_at:number}[]};
// Protected reverse proxy: the main app never parses a password or an OTP.
// Origin/CSRF validation is performed by the route before this private stream.
export async function vaultSensitiveRequest(who:BillingIdentity,path:'/save'|'/otp/fill',request:Request){
 const c=config() as unknown as {CREDENTIAL_VAULT?:Fetcher;VAULT_ENABLED?:string;VAULT_CALL_TOKEN?:string};
 if(!c.CREDENTIAL_VAULT||c.VAULT_ENABLED!=='true'||!c.VAULT_CALL_TOKEN)throw new AppError('Le coffre sécurisé attend sa configuration.',503,'vault_unavailable');
 await authorize(who.tenant,who.user.userId,'write');
 if(Number(request.headers.get('content-length')||0)>16384)throw new AppError('Saisie trop volumineuse.',413,'request_too_large');
 let bytes=0;
 const stream=request.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(part,controller){bytes+=part.byteLength;if(bytes>16384)throw new AppError('Saisie trop volumineuse.',413,'request_too_large');controller.enqueue(part);}}));
 const response=await c.CREDENTIAL_VAULT.fetch('https://vault.internal'+path,{method:'POST',headers:{authorization:'Bearer '+c.VAULT_CALL_TOKEN,'x-workspace-id':who.tenant,'x-user-id':who.user.userId,'content-type':'application/json'},body:stream});
 if(!response.ok){const data=await response.json() as {code?:unknown};const code=typeof data.code==='string'&&/^vault_[a-z_]+$/.test(data.code)?data.code:'vault_request_rejected';throw new AppError('La saisie sécurisée n’a pas pu être confirmée. Vérifiez la page avant de recommencer.',response.status,code);}
 return new Response(response.body,{status:response.status,headers:{'content-type':'application/json','cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}});
}
export async function vaultRequest(who:BillingIdentity,path:string,input?:unknown):Promise<Record<string,unknown>>{
 if(path==='/save'||path==='/otp/fill')throw new AppError('Utilisez le canal de saisie protégé.',403,'vault_secure_transport_required');
 const c=config() as unknown as {CREDENTIAL_VAULT?:Fetcher;VAULT_ENABLED?:string;VAULT_CALL_TOKEN?:string};
 if(!c.CREDENTIAL_VAULT||c.VAULT_ENABLED!=='true'||!c.VAULT_CALL_TOKEN)throw new AppError('Le coffre sécurisé attend sa configuration.',503,'vault_unavailable');
 await authorize(who.tenant,who.user.userId,path==='/list'?'read':'write');
 if(['/fill','/otp/prepare','/otp/fill','/save'].includes(path)&&(await getBrowserPermissions(who)).credentials==='deny')throw new AppError('Le remplissage des identifiants est refusé dans vos réglages.',403,'vault_permission_denied');
 const response=await c.CREDENTIAL_VAULT.fetch('https://vault.internal'+path,{method:input===undefined?'GET':'POST',headers:{authorization:'Bearer '+c.VAULT_CALL_TOKEN,'x-workspace-id':who.tenant,'x-user-id':who.user.userId,'content-type':'application/json'},...(input!==undefined?{body:JSON.stringify(input)}:{})});
 const result=await response.json() as Record<string,unknown>;
 if(!response.ok){const code=typeof result.code==='string'&&/^vault_[a-z_]+$/.test(result.code)?result.code:'vault_request_rejected';throw new AppError(code==='vault_approval_required'?'Votre accord est nécessaire avant ce remplissage.':code==='vault_origin_mismatch'?'Le domaine de la page ne correspond pas à cet identifiant.':'Le coffre ne peut pas confirmer cette opération. Vérifiez la page et réessayez avec une nouvelle saisie sécurisée.',response.status,code);}
 return result;
}
