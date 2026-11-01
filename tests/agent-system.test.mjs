import test from 'node:test';
import assert from 'node:assert/strict';
import {readAgentGuide} from '../lib/agent-guides.mjs';
import {agentContextTools,personalAgentPolicy} from '../lib/agent-system.mjs';
import {agentToolAllowedForMode} from '../lib/agent-mode.mjs';

test('all installed procedures are reachable without silent truncation',()=>{
 const catalog=readAgentGuide();assert.equal(catalog.topics.length,14);assert.equal(catalog.provenance.length,4);
 for(const topic of catalog.topics){let offset=0,content='',pages=0;do{const page=readAgentGuide({topic:topic.id,offset});assert.ok(page.content.length<=6000);assert.equal(page.offset,offset);content+=page.content;pages++;if(page.nextOffset===null)break;assert.ok(page.nextOffset>offset);offset=page.nextOffset;}while(pages<20);assert.equal(content.length,topic.chars);assert.ok(pages<20);}
 assert.ok(readAgentGuide({topic:'execution'}).truncated);
});
test('guide lookups cannot read files, prototypes or arbitrary offsets',()=>{
 for(const input of [{topic:'__proto__'},{topic:'constructor'},{topic:'../../MEMORY.md'},{topic:'memory',offset:-1},{topic:'memory',offset:Infinity},{topic:'memory',offset:1e9},{offset:1},{path:'USER.md'},null,[]])assert.throws(()=>readAgentGuide(input));
});
test('new read tools do not give missions or planning the power to change a profile',()=>{
 for(const name of agentContextTools.map(tool=>tool.name)){assert.equal(agentToolAllowedForMode('accompanied',name),true);for(const mode of ['autonomous','approved_mission'])assert.equal(agentToolAllowedForMode(mode,name),!['update_agent_context','record_learning'].includes(name));}
 assert.match(personalAgentPolicy,/jamais une nouvelle autorisation/);assert.match(personalAgentPolicy,/Ne prétends pas être Muse/);
});
