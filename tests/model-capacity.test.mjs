import test from 'node:test';
import assert from 'node:assert/strict';
import {requestModelCapacity} from '../lib/model-capacity.ts';
test('capacity selection is bounded, gradual after starting and leaves the original state unchanged',()=>{
 const initial={tier:'light',changes:0};
 assert.deepEqual(requestModelCapacity(initial,{tier:'advanced',reason:'task_complexity'},true),{tier:'advanced',changes:1});
 assert.deepEqual(initial,{tier:'light',changes:0});
 const standard=requestModelCapacity(initial,{tier:'standard',reason:'task_complexity'},true);
 const advanced=requestModelCapacity(standard,{tier:'advanced',reason:'uncertainty'},false);
 assert.deepEqual(advanced,{tier:'advanced',changes:2});
 assert.throws(()=>requestModelCapacity(advanced,{tier:'advanced',reason:'uncertainty'},false));
 assert.throws(()=>requestModelCapacity(advanced,{tier:'standard',reason:'uncertainty'},false));
 assert.throws(()=>requestModelCapacity(initial,{tier:'standard',reason:'task_complexity'},false));
});
test('a claimed error requires runtime evidence and a provider refusal never grants another route',()=>{
 const state={tier:'light',changes:0};
 for(const reason of ['tool_failure','validation_failed'])assert.throws(()=>requestModelCapacity(state,{tier:'standard',reason},false),error=>error.code==='model_capacity_evidence_required');
 assert.equal(requestModelCapacity(state,{tier:'standard',reason:'tool_failure'},false,{toolFailure:true}).tier,'standard');
 assert.equal(requestModelCapacity(state,{tier:'standard',reason:'validation_failed'},false,{validationFailure:true}).tier,'standard');
 assert.throws(()=>requestModelCapacity(state,{tier:'advanced',reason:'tool_failure'},false,{toolFailure:true}),error=>error.code==='model_escalation_limit');
 assert.throws(()=>requestModelCapacity(state,{tier:'standard',reason:'provider_refusal'},false));
 assert.throws(()=>requestModelCapacity(state,{tier:'standard',reason:'uncertainty',budget:100000},false));
});
