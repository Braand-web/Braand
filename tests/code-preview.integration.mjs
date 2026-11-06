// Live preview proxy of the sandbox Worker with a simulated container: the
// signed link sets an HttpOnly cookie on the preview site, then every path is
// relayed to the right sandbox and port without Braand's preview cookie;
// invalid, expired or missing links are refused; main-Worker calls still go
// to the authenticated sandbox API.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/code-preview');mkdirSync(out,{recursive:true});
await build({entryPoints:[path.join(root,'services/code-sandbox/worker.ts')],outfile:path.join(out,'worker.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'error',plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cfw',namespace:'stub'}));b.onResolve({filter:/^@cloudflare\/sandbox$/},()=>({path:'sbx',namespace:'stub'}));
 b.onLoad({filter:/^cfw$/,namespace:'stub'},()=>({contents:'export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}',loader:'js'}));
 b.onLoad({filter:/^sbx$/,namespace:'stub'},()=>({contents:'export class Files{constructor(){}}',loader:'js'}));}}]});
const worker=await import(pathToFileURL(path.join(out,'worker.mjs')).href);
const {signPreview}=await import(pathToFileURL(path.join(root,'lib/preview-token.mjs')).href);
const secret='c'.repeat(64),sandbox='a'.repeat(40),relayed=[];
const env={CODE_SANDBOX_ENABLED:'true',CODE_SANDBOX_CALL_TOKEN:'t'.repeat(40),CODE_PREVIEW_SECRET:secret,SANDBOX:{getByName:name=>({async preview(request,port){relayed.push({name,port,url:request.url,cookie:request.headers.get('cookie'),method:request.method});return new Response('<h1>App</h1>',{headers:{'content-type':'text/html'}});}})}};
const origin='https://braand-code-sandbox-production.example.workers.dev';
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const token=await signPreview({sandbox,port:3000,expiresAt:Date.now()+3600000},secret);
const entry=await worker.default.fetch(new Request(origin+'/__preview/'+token),env);
assert.equal(entry.status,302);assert.equal(entry.headers.get('location'),'/');
const cookie=entry.headers.get('set-cookie');assert.match(cookie,/^braand_preview=.+; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/);
pass('the signed link sets a secure HttpOnly cookie on the preview site and opens the app');
const page=await worker.default.fetch(new Request(origin+'/_next/static/app.js?v=1',{headers:{cookie:'theme=dark; braand_preview='+token}}),env);
assert.equal(page.status,200);assert.equal(await page.text(),'<h1>App</h1>');
assert.deepEqual(relayed.at(-1),{name:sandbox,port:3000,url:origin+'/_next/static/app.js?v=1',cookie:'theme=dark',method:'GET'});
const post=await worker.default.fetch(new Request(origin+'/api/login',{method:'POST',body:'x=1',headers:{cookie:'braand_preview='+token}}),env);assert.equal(post.status,200);assert.equal(relayed.at(-1).cookie,null);assert.equal(relayed.at(-1).method,'POST');
pass('absolute paths and form posts are relayed to the right sandbox and port, without Braand’s preview cookie');
for(const [name,request] of [['no cookie',new Request(origin+'/')],['forged',new Request(origin+'/',{headers:{cookie:'braand_preview='+token.slice(0,-3)+'abc'}})],['expired',new Request(origin+'/__preview/'+await signPreview({sandbox,port:3000,expiresAt:Date.now()-1000},secret))]]){
 const response=await worker.default.fetch(request,env);assert.equal(response.status,403,name);assert.match(await response.text(),/Braand/,name);
}
assert.equal(relayed.length,2,'nothing relayed without a valid link');
pass('missing, forged or expired links are refused with a clear page');
const api=await worker.default.fetch(new Request('https://sandbox.internal/exec',{method:'POST',headers:{authorization:'Bearer wrong'},body:'{}'}),env);
assert.equal(api.status,403,'main-Worker calls stay on the authenticated API');assert.equal((await api.json()).code,'sandbox_denied');
const off=await worker.default.fetch(new Request(origin+'/__preview/'+token),{...env,CODE_SANDBOX_ENABLED:'false'});assert.notEqual(off.status,302,'no preview while the sandbox is off');
pass('main-Worker calls still require the call token, and nothing is served while the sandbox is off');
console.log(checks+' live preview proxy checks passed with a simulated container.');
