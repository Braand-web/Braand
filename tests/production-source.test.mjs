import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProductionSource} from '../scripts/production-source-policy.mjs';
const live='1'.repeat(40),next='2'.repeat(40);
test('production refuses a passing build which omits the currently deployed source',()=>{
 assert.throws(()=>assertProductionSource(next,'Release '+live,()=>false),/discard live changes/);
 assert.equal(assertProductionSource(next,'Release '+live,(a,b)=>a===live&&b===next),live);
});
test('unknown and malformed revisions cannot bypass the deployment check',()=>{
 assert.throws(()=>assertProductionSource(next,'Unknown release',()=>true),/unknown/);
 assert.throws(()=>assertProductionSource('main','Release '+live,()=>true),/full source/);
});
