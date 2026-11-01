import test from 'node:test';
import assert from 'node:assert/strict';
import {browserPoint,parseHumanBrowserInput} from '../lib/browser-input.mjs';
import {containsExplicitLoginSecret} from '../lib/chat-secret-guard.mjs';
import {sealCredential,openCredential,sealForBrowser,openBrowserEnvelope,b64} from '../services/credential-vault/crypto.mjs';
test('remote coordinates follow the actual viewport after resize and stay bounded',()=>{
 assert.deepEqual(browserPoint({left:10,top:20,width:640,height:360},330,200,{width:1280,height:720}),{x:640,y:360});
 assert.deepEqual(browserPoint({left:0,top:0,width:320,height:180},400,-10,{width:1280,height:720}),{x:1279,y:0});
});
test('human input has a closed protocol without CDP, arbitrary keys, script or file paths',()=>{
 for(const value of [{kind:'evaluate',source:'secret'},{kind:'key',key:'Control+L'},{kind:'pointer',x:Infinity,y:1},{kind:'text',text:'a',origin:'other'},{kind:'text',text:'a'.repeat(4097)}])assert.throws(()=>parseHumanBrowserInput(value));
 assert.deepEqual(parseHumanBrowserInput({kind:'text',text:'مرحبا 日本語'}),{kind:'text',text:'مرحبا 日本語'});
});
test('explicit labelled passwords and codes are stopped without treating an ordinary password question as a secret',()=>{
 assert.equal(containsExplicitLoginSecret('Mon mot de passe: fixture-sensitive-123'),true);
 assert.equal(containsExplicitLoginSecret('password = fixture-sensitive-123'),true);
 assert.equal(containsExplicitLoginSecret('code OTP: 123456'),true);
 assert.equal(containsExplicitLoginSecret('Comment changer mon mot de passe ?'),false);
});
test('envelope encryption binds a record to its owner and does not expose secret fragments',async()=>{
 const master=b64(crypto.getRandomValues(new Uint8Array(32))),secret={username:'fixture@example.com',password:'fixture-secret-never-visible'};
 const cipher=await sealCredential(master,'workspace/user/id',secret);
 assert.ok(!JSON.stringify(cipher).includes(secret.password));assert.deepEqual(await openCredential(master,'workspace/user/id',cipher),secret);
 await assert.rejects(()=>openCredential(master,'other/user/id',cipher));
 const other=b64(crypto.getRandomValues(new Uint8Array(32)));await assert.rejects(()=>openCredential(other,'workspace/user/id',cipher));
});
test('only the browser private key and exact one-use nonce can open a login envelope',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
 const value={password:'fixture-only-secret'},envelope=await sealForBrowser(await crypto.subtle.exportKey('jwk',keys.publicKey),'nonce',value);
 assert.ok(!JSON.stringify(envelope).includes(value.password));assert.deepEqual(await openBrowserEnvelope(keys.privateKey,'nonce',envelope),value);
 await assert.rejects(()=>openBrowserEnvelope(keys.privateKey,'wrong-nonce',envelope));
});
