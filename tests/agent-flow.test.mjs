import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {batchedEventWriter,bufferedAgentEvents} from '../lib/agent-events.ts';
import {recoverChatEvents} from '../lib/chat-recovery.ts';
import {parseSSE} from '../lib/core.mjs';
const stream=text=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(text));controller.close();}});
const frame=(seq,event,data)=>'id: '+seq+'\nevent: '+event+'\ndata: '+JSON.stringify(data)+'\n\n';
test('event batching preserves first output, Unicode, exact text and boundaries in order',async()=>{
 const events=[];const buffered=bufferedAgentEvents(async(type,data)=>events.push({type,data}),10000,20);
 await buffered.emit('run',{runId:'r'});await buffered.emit('text_delta',{text:'你'});assert.equal(events.at(-1).data.text,'你');await buffered.emit('text_delta',{text:'好'});await buffered.emit('text_delta',{text:' مرحبا'});await buffered.emit('tool_start',{id:'tool'});await buffered.emit('text_delta',{text:' fin'});await buffered.flush();
 assert.equal(events.filter(event=>event.type==='text_delta').map(event=>event.data.text).join(''),'你好 مرحبا fin');assert.equal(events[3].type,'tool_start');
});
test('event persistence failures are propagated instead of producing a false completion',async()=>{
 const buffered=bufferedAgentEvents(async()=>{throw Error('D1 unavailable');});await assert.rejects(()=>buffered.emit('text_delta',{text:'Partial'}),/D1 unavailable/);await assert.rejects(()=>buffered.emit('done',{}),/D1 unavailable/);
});
test('background text flushes keep order and surface a later persistence failure',async()=>{
 const written=[];let fail=false;const buffered=bufferedAgentEvents(async(type,data)=>{if(fail)throw Error('D1 unavailable');written.push(data.text);},10000,4);
 await buffered.emit('text_delta',{text:'A'});await buffered.emit('text_delta',{text:'BCDE'});await buffered.emit('text_delta',{text:'FG'});await buffered.flush();
 assert.equal(written.join(''),'ABCDEFG');
 fail=true;await buffered.emit('text_delta',{text:'HIJK'});await assert.rejects(()=>buffered.flush(),/D1 unavailable/);await assert.rejects(()=>buffered.emit('done',{}),/D1 unavailable/);
});
test('recovery replays only unseen event IDs and never submits another generation',async()=>{
 const calls=[];const initial=stream(frame(1,'run',{runId:'r'})+frame(2,'text_delta',{text:'Bon'}));
 const events=[];for await(const event of recoverChatEvents(initial,async(id,after)=>{calls.push({id,after});return {run:{status:'completed'},events:[{seq:2,type:'text_delta',data:{text:'Bon'}},{seq:3,type:'text_delta',data:{text:'jour'}},{seq:4,type:'done',data:{runId:id}}]};},new AbortController().signal))events.push(event);
 assert.deepEqual(calls,[{id:'r',after:2}]);assert.equal(events.filter(event=>event.event==='text_delta').map(event=>event.data.text).join(''),'Bonjour');assert.equal(events.filter(event=>event.event==='done').length,1);
});
test('failed runs preserve partial text and cannot become a successful delivery on reconnect',async()=>{
 const events=[];for await(const event of recoverChatEvents(stream(frame(1,'run',{runId:'r'})+frame(2,'text_delta',{text:'Partial'})),async()=>({run:{status:'failed',error:'Provider result uncertain'},events:[]}),new AbortController().signal))events.push(event);assert.equal(events.at(-1).event,'error');assert.ok(!events.some(event=>event.event==='done'));assert.equal(events[1].data.text,'Partial');
});
test('unsequenced legacy streams fail explicitly and aborted recovery never starts a read',async()=>{
 let calls=0;await assert.rejects(async()=>{for await(const event of recoverChatEvents(stream('event: run\ndata: {"runId":"r"}\n\n'),async()=>{calls++;},new AbortController().signal))void event;});assert.equal(calls,0);
 const controller=new AbortController();controller.abort();await assert.rejects(async()=>{for await(const event of recoverChatEvents(stream(frame(1,'run',{runId:'r'})),async()=>{calls++;},controller.signal))void event;},error=>error.name==='AbortError');assert.equal(calls,0);
});
test('SSE retains replay cursors across multibyte data',async()=>{const events=[];for await(const event of parseSSE(stream(frame(27,'text_delta',{text:'é 日本語'}))))events.push(event);assert.equal(events[0].id,'27');assert.equal(events[0].data.text,'é 日本語');});
test('local reproducible benchmark compares per-chunk writes against batched writes with identical output',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE events(seq INTEGER PRIMARY KEY,data TEXT)');const insert=db.prepare('INSERT INTO events(data) VALUES (?)');const chunks=Array.from({length:256},(_,i)=>i%2?'abc':'你好');let beforeFirst=null;const start=performance.now();for(const chunk of chunks){insert.run(chunk);beforeFirst??=performance.now()-start;}const baselineMs=performance.now()-start,baselineWrites=db.prepare('SELECT COUNT(*) n FROM events').get().n;
 db.exec('DELETE FROM events');let afterFirst=null;const afterStart=performance.now(),buffered=bufferedAgentEvents(async(type,data)=>{if(type==='text_delta'){insert.run(data.text);afterFirst??=performance.now()-afterStart;}},10000,256);for(const text of chunks)await buffered.emit('text_delta',{text});await buffered.flush();const afterMs=performance.now()-afterStart,rows=db.prepare('SELECT data FROM events ORDER BY seq').all();assert.equal(rows.map(row=>row.data).join(''),chunks.join(''));assert.ok(rows.length<baselineWrites);
 mkdirSync('.tmp',{recursive:true});writeFileSync('.tmp/agent-event-benchmark.json',JSON.stringify({environment:'isolated local Node/SQLite; not Cloudflare or real model latency',chunks:chunks.length,baseline:{writes:baselineWrites,totalMs:baselineMs,firstPersistedTextMs:beforeFirst},after:{writes:rows.length,totalMs:afterMs,firstPersistedTextMs:afterFirst},textIdentical:true,providerCalls:0,productionLatency:null,productionCost:null},null,2));db.close();
});

test('batched storage sends every event once, in order, with its stored number, in few database trips',async()=>{
 let next=0;const trips=[],sent=[];
 const write=batchedEventWriter(async events=>{trips.push(events.length);await new Promise(resolve=>setTimeout(resolve,5));return events.map(()=>++next);},(seq,type,data)=>sent.push({seq,type,text:data.text}));
 const buffered=bufferedAgentEvents(write,10000,1);
 await buffered.emit('run',{runId:'r'});
 for(const text of ['Bon','jour',' à',' tous'])await buffered.emit('text_delta',{text});
 await buffered.emit('done',{});
 assert.deepEqual(sent.map(event=>event.seq),[1,2,3,4,5,6]);
 assert.equal(sent.filter(event=>event.type==='text_delta').map(event=>event.text).join(''),'Bonjour à tous');
 assert.ok(trips.length<6,'events that arrive together share one trip: '+trips);
});
test('a storage failure in a batch rejects that batch and everything after it',async()=>{
 const sent=[];let calls=0;
 const write=batchedEventWriter(async events=>{if(++calls===2)throw Error('D1 unavailable');return events.map((_,index)=>index+1);},seq=>sent.push(seq));
 await write('run',{});await assert.rejects(()=>write('text_delta',{text:'x'}),/D1 unavailable/);await assert.rejects(()=>write('done',{}),/D1 unavailable/);
 assert.deepEqual(sent,[1]);
});
