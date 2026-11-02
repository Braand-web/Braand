import test from 'node:test';
import assert from 'node:assert/strict';
import {secureResponse} from '../lib/response-security.mjs';
test('security defaults retain streaming, cookies and response status',async()=>{
 let source;const stream=new ReadableStream({start(controller){source=controller;}});
 const response=secureResponse(new Response(stream,{status:202,headers:{'Content-Type':'text/event-stream','Set-Cookie':'session=fixture; Secure; HttpOnly'}}),new Request('https://braand.test/'));
 assert.equal(response.status,202);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.match(response.headers.get('set-cookie'),/HttpOnly/);
 const reader=response.body.getReader();source.enqueue(new TextEncoder().encode('data: ready\n\n'));assert.equal(new TextDecoder().decode((await reader.read()).value),'data: ready\n\n');source.close();
 assert.match(response.headers.get('strict-transport-security'),/max-age/);
});
test('route-specific preview/auth policies remain intact and HTTP gets no HSTS',()=>{
 const response=secureResponse(new Response('',{headers:{'Content-Security-Policy':"sandbox; frame-ancestors https://editor.test",'Referrer-Policy':'no-referrer'}}),new Request('http://localhost/'));
 assert.equal(response.headers.get('content-security-policy'),"sandbox; frame-ancestors https://editor.test");assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.has('x-frame-options'),false);assert.equal(response.headers.has('strict-transport-security'),false);
});
