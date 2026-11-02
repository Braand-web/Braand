import test from 'node:test';
import assert from 'node:assert/strict';
import {privateJSON,boundedJSONStructure} from '../lib/private-json.ts';
test('bounded JSON rejects length headers and chunked overflow before schema parsing',async()=>{
 const request=(body,headers={})=>new Request('https://braand.test/',{method:'POST',body,headers});
 await assert.rejects(()=>privateJSON(request('{}',{'Content-Length':'100'}),10),e=>e.status===413);
 await assert.rejects(()=>privateJSON(request('x'.repeat(101)),100),e=>e.code==='request_too_large');
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(110)));c.close();}});
 await assert.rejects(()=>privateJSON(new Request('https://braand.test/',{method:'POST',body:stream,duplex:'half'}),100),e=>e.status===413);
 assert.deepEqual(await privateJSON(request('{"message":"Bonjour 🌍"}'),100),{message:'Bonjour 🌍'});
 await assert.rejects(()=>privateJSON(request('{')),e=>e.code==='invalid_json');
});
test('depth, collection and aggregate structure limits precede recursive validation',()=>{
 let deep={};for(let n=0;n<70;n++)deep={nested:deep};
 for(const input of [deep,Array(10001).fill(0),Array.from({length:6},()=>Array(9000).fill(0))])assert.throws(()=>boundedJSONStructure(input),e=>e.code==='request_too_complex');
 const data=Array.from({length:500},()=>Array(40).fill(1));assert.equal(boundedJSONStructure(data),data);
});
