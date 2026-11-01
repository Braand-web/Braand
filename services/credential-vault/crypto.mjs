const encoder=new TextEncoder(),decoder=new TextDecoder();
export const b64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
export const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const aes=bytes=>crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
async function encrypt(key,bytes,aad){const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:b64(iv),data:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,bytes)))};}
async function decrypt(key,value,aad){return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(value.iv),additionalData:encoder.encode(aad)},key,unb64(value.data)));}
export async function sealCredential(master,scope,value){
 const raw=crypto.getRandomValues(new Uint8Array(32)),plain=encoder.encode(JSON.stringify(value));
 try{return {version:1,wrapped:await encrypt(await aes(unb64(master)),raw,scope+':key'),payload:await encrypt(await aes(raw),plain,scope+':data')};}
 finally{raw.fill(0);plain.fill(0);}
}
export async function openCredential(master,scope,value){
 if(value.version!==1)throw Error('vault_cipher_invalid');
 const raw=await decrypt(await aes(unb64(master)),value.wrapped,scope+':key');let plain;
 try{plain=await decrypt(await aes(raw),value.payload,scope+':data');return JSON.parse(decoder.decode(plain));}
 finally{raw.fill(0);plain?.fill(0);}
}
// Hybrid envelope: decrypted credentials never transit the main application's response.
export async function sealForBrowser(publicKey,nonce,value){
 const key=await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']),raw=crypto.getRandomValues(new Uint8Array(32)),plain=encoder.encode(JSON.stringify(value));
 try{return {key:b64(new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP',key,raw))),payload:await encrypt(await aes(raw),plain,nonce)};}
 finally{raw.fill(0);plain.fill(0);}
}
export async function openBrowserEnvelope(privateKey,nonce,value){
 const raw=new Uint8Array(await crypto.subtle.decrypt('RSA-OAEP',privateKey,unb64(value.key)));let plain;
 try{plain=await decrypt(await aes(raw),value.payload,nonce);return JSON.parse(decoder.decode(plain));}
 finally{raw.fill(0);plain?.fill(0);}
}
