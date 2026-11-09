import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseMediaRoute, mediaQuoteFingerprint} from '../lib/media-routing.mjs';
import {validateModelInput} from '../lib/core.mjs';

const now = Date.parse('2026-10-22T10:00:00Z');
const schema = {type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string',maxLength:500},num_images:{type:'integer',minimum:1,maximum:1}}};
const item = (id,extra={}) => ({id,kind:'image',credits:6,costCeilingXaf:24,verifiedAt:new Date(now).toISOString(),inputSchema:schema,...extra});

test('Media route selects by bounded task, ignores unconfigured models and validates all inputs before any proposal',()=>{
 const nano=item('google/nano-banana-2.1'),flare=item('openai/gpt-image-2.5/flare/text-to-image');
 assert.equal(chooseMediaRoute([flare,nano],'image',{prompt:'A product'},10,now).id,nano.id);
 assert.equal(chooseMediaRoute([flare],'image',{prompt:'A product'},10,now).id,flare.id);
 for(const input of [{prompt:'A product',num_images:2},{prompt:'A product',duration:100},{script:'spend more'}])assert.throws(()=>chooseMediaRoute([nano],'image',input,10,now),e=>e.code==='media_route_unavailable');
});
test('Missing, stale, future, unbounded or over-budget media rates cannot become executable quotes',()=>{
 const id='google/nano-banana-2.1';
 for(const candidate of [item(id,{verifiedAt:undefined}),item(id,{verifiedAt:new Date(now+1).toISOString()}),item(id,{verifiedAt:new Date(now-86400001).toISOString()}),item(id,{costCeilingXaf:25}),item(id,{kind:'video'})])assert.throws(()=>chooseMediaRoute([candidate],'image',{prompt:'x'},10,now));
 assert.throws(()=>chooseMediaRoute([item(id)],'image',{prompt:'x'},5,now),e=>e.code==='media_budget_insufficient');
 assert.throws(()=>chooseMediaRoute([item(id,{verifiedAt:undefined})],'image',{prompt:'x'},10,now),e=>e.code==='media_price_unavailable');
 assert.throws(()=>chooseMediaRoute([item(id)],'execute_js',{prompt:'x'},10,now),e=>e.code==='media_task_invalid');
});
test('Precision editing and narrative video have distinct capabilities, with no silent model change after approval',()=>{
 const sunburst=item('openai/gpt-image-2.5/sunburst/edit'),video=item('bytedance/seedance-2.5/text-to-video',{kind:'video',credits:350,costCeilingXaf:1400});
 assert.equal(chooseMediaRoute([sunburst,video],'image_edit_precision',{prompt:'Change only the label'},10,now).id,sunburst.id);
 assert.equal(chooseMediaRoute([sunburst,video],'video_narrative',{prompt:'A complete scene'},350,now).id,video.id);
 assert.throws(()=>chooseMediaRoute([sunburst],'video_short',{prompt:'x'},10,now));
});
test('Quote fingerprint binds the exact model, input values, schema and verified price',async()=>{
 const model=item('google/nano-banana-2.1'),input={prompt:'Product',num_images:1},stamp=await mediaQuoteFingerprint(model,input);
 assert.equal(stamp,await mediaQuoteFingerprint({...model}, {num_images:1,prompt:'Product'}));
 for(const [candidate,values] of [[{...model,id:'another/engine'},input],[{...model,credits:7},input],[{...model,costCeilingXaf:23},input],[{...model,verifiedAt:new Date(now-1).toISOString()},input],[model,{...input,prompt:'Other'}]])assert.notEqual(stamp,await mediaQuoteFingerprint(candidate,values));
});
test('Reference media arrays require bounded counts and primitive item schemas',()=>{
 const bounded={type:'object',additionalProperties:false,required:['image_urls'],properties:{image_urls:{type:'array',minItems:1,maxItems:2,items:{type:'string',maxLength:150}}}};
 assert.doesNotThrow(()=>validateModelInput({image_urls:['https://example.com/product.png']},bounded));
 for(const value of [[],[1],['a','b','c'],[{script:'x'}]])assert.throws(()=>validateModelInput({image_urls:value},bounded));
 const unbounded=structuredClone(bounded);delete unbounded.properties.image_urls.maxItems;assert.throws(()=>validateModelInput({image_urls:['a']},unbounded));
 const reference=item('google/nano-banana-2.1/edit',{inputSchema:bounded});
 for(const url of ['https://127.0.0.1/private.png','http://example.com/a.png','https://user:secret@example.com/a.png'])assert.throws(()=>chooseMediaRoute([reference],'image_edit',{image_urls:[url]},6,now));
});
