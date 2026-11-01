import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProductionSource,productionSourceAnnotation} from '../scripts/production-source-policy.mjs';
const live='1'.repeat(40),next='2'.repeat(40);
test('production refuses a passing build which omits the currently deployed source',()=>{
 assert.throws(()=>assertProductionSource(next,'Release '+live,()=>false),/discard live changes/);
 assert.equal(assertProductionSource(next,'Release '+live,(a,b)=>a===live&&b===next),live);
});
test('secret-only deployments recover provenance from an identical script fingerprint',()=>{
 const script={etag:'a'.repeat(64)},current={resources:{script}},annotated={resources:{script},annotations:{'workers/message':'Release '+live}};
 assert.equal(productionSourceAnnotation(current,[annotated]),'Release '+live);
 assert.throws(()=>productionSourceAnnotation(current,[{...annotated,resources:{script:{etag:'b'.repeat(64)}}}]),/no matching/);
 assert.throws(()=>productionSourceAnnotation({resources:{script:{etag:''}}},[annotated]),/no verified script/);
 assert.equal(productionSourceAnnotation({...current,annotations:{'workers/message':'Release '+next}},[annotated]),'Release '+next);
 assert.throws(()=>assertProductionSource(next,productionSourceAnnotation(current,[annotated]),()=>false),/discard live changes/);
});
test('unknown and malformed revisions cannot bypass the deployment check',()=>{
 assert.throws(()=>assertProductionSource(next,'Unknown release',()=>true),/unknown/);
 assert.throws(()=>assertProductionSource('main','Release '+live,()=>true),/full source/);
});
