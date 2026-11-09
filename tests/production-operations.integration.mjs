// Real SQLite, Web Crypto, route handlers and recovery drill. HTTP providers are simulated.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// Cloudflare's fixed-length stream contract, with real Node stream backpressure.
// The in-memory R2 fixture consumes the readable incrementally below.
globalThis.FixedLengthStream=class extends TransformStream {
  constructor(expected){let received=0;super({transform(chunk,controller){received+=chunk.byteLength;if(received>expected)throw new Error('length overflow');controller.enqueue(chunk);},flush(){if(received!==expected)throw new Error('length mismatch');}});}
};
const project=path.resolve(import.meta.dirname,'..'), runtime=process.env.BRAAND_TOOLCHAIN||path.join(project,'node_modules');
const {build}=createRequire(path.join(runtime,'package.json'))('esbuild');
function database(migrate=false) {
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  if(migrate)for(const file of readdirSync(path.join(project,'drizzle')).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(path.join(project,'drizzle',file),'utf8'));
  function statement(query,args=[]) {return {
    bind(...values){return statement(query,values);},
    async first(column){binding.calls++;const row=sql.prepare(query).get(...args);return column?row?.[column]??null:row??null;},
    async all(){binding.calls++;return {results:sql.prepare(query).all(...args)};},
    async run(){binding.calls++;return this.execute();},
    execute(){const prepared=sql.prepare(query);if(prepared.columns().length)return {results:prepared.all(...args),meta:{changes:0}};const value=prepared.run(...args);return {results:[],meta:{changes:Number(value.changes)}};}
  };}
  // calls counts what the platform limits per run: one per query, one per batch.
  const binding={calls:0,prepare:query=>statement(query),async batch(statements){binding.calls++;sql.exec('BEGIN');try{const result=statements.map(value=>value.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  return {sql,binding};
}
function bucket() {
  const objects=new Map();let serial=0;
  const stats={reads:[],writes:[],lists:0,streamWrites:0,maxStreamChunk:0},hooks={};
  const binding={
    async put(key,body,options={}) {
      if(hooks.put)await hooks.put(key,body,options);
      if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;
      let raw;
      if(body instanceof ReadableStream){
        stats.streamWrites++;const reader=body.getReader(),chunks=[];let total=0;
        try{for(;;){const {value,done}=await reader.read();if(done)break;stats.maxStreamChunk=Math.max(stats.maxStreamChunk,value.byteLength);chunks.push(value);total+=value.byteLength;}}
        finally{reader.releaseLock();}
        raw=new Uint8Array(total);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
      }else raw=typeof body==='string'?new TextEncoder().encode(body):new Uint8Array(body);
      stats.writes.push({key,bytes:raw.byteLength});
      const item={key,raw:Uint8Array.from(raw),etag:'fixture-'+(++serial),size:raw.byteLength,httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{}};
      objects.set(key,item);return {...item};
    },
    async get(key,options={}) {
      if(hooks.get)await hooks.get(key,options);
      const item=objects.get(key);if(!item)return null;
      if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==item.etag)return {key,etag:item.etag,size:item.size};
      const start=options.range?.offset||0,end=options.range?start+options.range.length:item.raw.length;
      const bytes=item.raw.subarray(start,end);stats.reads.push({key,range:options.range,bytes:bytes.byteLength});
      return {...item,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),async arrayBuffer(){return bytes.slice().buffer;},async text(){return new TextDecoder().decode(bytes);}};
    },
    async list({limit=100,cursor}={}) {stats.lists++;const rows=[...objects.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.key),Buffer.from(b.key))),offset=Number(cursor||0);const page={objects:rows.slice(offset,offset+limit).map(({key,etag,size,httpMetadata,customMetadata})=>({key,etag,size,httpMetadata,customMetadata})),truncated:offset+limit<rows.length,cursor:offset+limit<rows.length?String(offset+limit):undefined};return hooks.list?hooks.list(page):page;}
  };
  return {objects,binding,stats,hooks};
}
const source=database(true), media=bucket(), archives=bucket();
const env={DB:source.binding,BUCKET:media.binding,BACKUP_BUCKET:archives.binding,APP_ENV:'test'};
globalThis.__operationsTest={env,headers:new Headers({'x-braand-identity-id':'ops-owner','x-braand-identity-email':'ops@test.invalid'})};
const out=path.join(project,'.local-build','production-operations-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
const modules={operations:'lib/operations.ts',notifications:'lib/notifications.ts',backups:'lib/backups.ts',health:'app/api/health/route.ts',tick:'app/api/internal/operations-tick/route.ts',admin:'app/api/admin/operations/route.ts'};
await build({stdin:{contents:Object.entries(modules).map(([name,file])=>'export * as '+name+' from "'+path.join(project,file).replaceAll('\\','/')+'";').join('\n'),resolveDir:project,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',nodePaths:[runtime],plugins:[{name:'isolated-operations-bindings',setup(builder){builder.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__operationsTest.env;':args.path==='next/headers'?'export async function headers(){return globalThis.__operationsTest.headers;}':'export function redirect(){throw new Error("unexpected redirect");}'}));}}]});
const {operations:ops,notifications:email,backups,health,tick,admin}=await import(pathToFileURL(out).href);
let checks=0;const check=async(name,work)=>{await work();checks++;console.log('PASS '+name);};
const originalFetch=globalThis.fetch;const calls=[];let fetchMode='success';
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails','No unapproved external host');calls.push({url,options});
  if(fetchMode==='timeout')throw new Error('fixture-secret-must-not-be-logged');
  return Response.json({id:'fixture-email-'+calls.length},{status:200});
};
const req=(method='POST',body,authorization,origin='https://braand.test')=>new Request('https://braand.test/api/admin/operations',{method,headers:{'Content-Type':'application/json',...(authorization?{authorization}:{}),...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
const fixtureKey=await crypto.subtle.importKey('raw',new TextEncoder().encode('k'.repeat(32)),{name:'AES-GCM'},false,['encrypt','decrypt']);
const currentMagic=new TextEncoder().encode('BRAAND2\n');
const legacyPrefix=['ai','ra'].join('');
async function encryptLegacyFixture(id,label,plain,version=2){const iv=crypto.getRandomValues(new Uint8Array(12)),aad=new TextEncoder().encode(version===1?legacyPrefix+'-backup-v1:'+id:legacyPrefix+'-backup-v2:'+id+':'+label),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},fixtureKey,plain)),raw=new Uint8Array(12+cipher.length);raw.set(iv);raw.set(cipher,12);return raw;}
async function encryptFixture(id,label,plain,version=2){
  const iv=crypto.getRandomValues(new Uint8Array(12)),additionalData=new TextEncoder().encode(version===1?'braand-backup-v1:'+id:'braand-backup-v2:'+id+':'+label);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},fixtureKey,plain));
  const raw=new Uint8Array(12+cipher.length);raw.set(iv);raw.set(cipher,12);return raw;
}
async function readManifest(id){
  const raw=archives.objects.get('braand-backups/'+id+'.bin').raw.subarray(currentMagic.length);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12),additionalData:new TextEncoder().encode('braand-backup-v2:'+id+':manifest')},fixtureKey,raw.slice(12))));
}
async function replaceManifest(id,manifest){
  const body=await encryptFixture(id,'manifest',new TextEncoder().encode(JSON.stringify(manifest))),raw=new Uint8Array(currentMagic.length+body.length);raw.set(currentMagic);raw.set(body,currentMagic.length);
  await archives.binding.put('braand-backups/'+id+'.bin',raw);
}
async function assertRestoreEmpty(id){
  const target=database(),objects=bucket();
  try{await assert.rejects(()=>backups.restoreEncryptedBackup(id,target.binding,objects.binding));assert.equal(objects.objects.size,0);assert.equal(target.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,0);}
  finally{target.sql.close();}
}
async function withBackupBindings(databaseBinding,mediaBinding,archiveBinding,work){
  const previous={DB:env.DB,BUCKET:env.BUCKET,BACKUP_BUCKET:env.BACKUP_BUCKET};Object.assign(env,{DB:databaseBinding,BUCKET:mediaBinding,BACKUP_BUCKET:archiveBinding});
  try{return await work();}finally{Object.assign(env,previous);}
}

try {
  await check('Public health exposes no configuration, and missing DB returns 503',async()=>{
    assert.deepEqual(await (await health.GET()).json(),{status:'ok'});
    delete env.DB;assert.equal((await health.GET()).status,503);env.DB=source.binding;
  });
  await check('Scheduler refuses absent, short and incorrect secrets; accepts an exact long secret',async()=>{
    assert.equal((await tick.POST(req())).status,503);
    env.SCHEDULER_SECRET='short';assert.equal((await tick.POST(req())).status,503);
    env.SCHEDULER_SECRET='test-only-scheduler-'.repeat(3);
    assert.equal((await tick.POST(req('POST',undefined,'Bearer wrong'))).status,401);
    assert.equal((await tick.POST(req('POST',undefined,'Bearer '+env.SCHEDULER_SECRET))).status,200);
    assert.equal(calls.length,0);
  });
  // Isolate later delivery tests from clock-dependent scheduler notifications.
  source.sql.exec('DELETE FROM notification_outbox');
  await check('A claimed job executes once despite repeated concurrent ticks',async()=>{
    let executions=0;await Promise.all(Array.from({length:4},()=>ops.runTrackedJob('fixture','fixture:once',async()=>{executions++;})));
    assert.equal(executions,1);assert.equal(source.sql.prepare("SELECT attempts FROM operations_jobs WHERE id='fixture:once'").get().attempts,1);
  });
  await check('Failed jobs create one durable alert and one outbox entry; no secrets are recorded',async()=>{
    await ops.runTrackedJob('fixture','fixture:failure',async()=>{throw new Error('fixture-sensitive-error-never-store');});
    await ops.runTrackedJob('fixture','fixture:failure',async()=>{throw new Error('not-run');});
    assert.equal(source.sql.prepare("SELECT count(*) n FROM operations_alerts WHERE id='job:fixture:failure'").get().n,1);
    assert.equal(source.sql.prepare("SELECT count(*) n FROM notification_outbox WHERE id='job:fixture:failure'").get().n,1);
    assert(!JSON.stringify(source.sql.prepare('SELECT * FROM operations_jobs').all()).includes('sensitive'));
    const row=source.sql.prepare("SELECT status FROM operations_jobs WHERE id='fixture:failure'").get();assert.equal(row.status,'failed');
  });
  await check('Email is disabled by default, then blocks without a test recipient',async()=>{
    assert.equal(email.emailReadiness().reason,'email_disabled');
    await email.dispatchOperationalNotifications();assert.equal(calls.length,0);
    Object.assign(env,{RESEND_MODE:'sandbox',RESEND_API_KEY:'fixture-not-a-real-key',RESEND_FROM:'sender@test.invalid'});
    assert.equal(email.emailReadiness().reason,'test_recipient_missing');
    await email.dispatchOperationalNotifications();assert.equal(calls.length,0);
  });
  await check('Configured sandbox emails use explicit recipient and idempotency; repeated dispatch does not resend',async()=>{
    env.RESEND_TEST_RECIPIENT='recipient@test.invalid';
    const result=await email.dispatchOperationalNotifications();assert.equal(result.sent,1);
    assert.equal(calls[0].options.headers['Idempotency-Key'],'braand-ops/job:fixture:failure');
    assert.deepEqual(JSON.parse(calls[0].options.body).to,['recipient@test.invalid']);
    await email.dispatchOperationalNotifications();assert.equal(calls.length,1);
  });
  await check('Timeout remains uncertain and does not auto-resend, even past provider idempotency expiry',async()=>{
    await ops.raiseOperationalAlert('fixture:timeout','test_alert','fixture:timeout');fetchMode='timeout';
    await email.dispatchOperationalNotifications();const count=calls.length;
    await email.dispatchOperationalNotifications(10,Date.now()+2*86400000);
    assert.equal(calls.length,count);assert.equal(source.sql.prepare("SELECT status FROM notification_outbox WHERE id='fixture:timeout'").get().status,'uncertain');
    await ops.scanOperationalIncidents();await ops.scanOperationalIncidents();
    assert.equal(source.sql.prepare("SELECT count(*) n FROM notification_outbox WHERE payload LIKE '%email_delivery_unknown%'").get().n,0);
    fetchMode='success';
  });
  await check('Live mail needs an explicit approval flag; staging cannot accidentally send live',async()=>{
    env.RESEND_MODE='live';assert.equal(email.emailReadiness().ready,false);
    env.APP_ENV='production';assert.equal(email.emailReadiness().reason,'live_email_not_approved');
    env.RESEND_LIVE_APPROVED='true';assert.equal(email.emailReadiness().reason,'alert_recipient_missing');
    env.APP_ENV='test';env.RESEND_MODE='disabled';
  });
  await check('Operations administration requires an explicit admin ID and same-origin mutation',async()=>{
    assert.equal((await admin.GET(req('GET'))).status,403);env.OPS_ADMIN_IDS='ops-owner';
    assert.equal((await admin.GET(req('GET'))).status,200);
    const body={action:'test-alert',idempotencyKey:crypto.randomUUID()};
    assert.equal((await admin.POST(req('POST',body,undefined,'https://evil.test'))).status,403);
    assert.equal((await admin.POST(req('POST',body))).status,201);
    assert.equal((await admin.POST(req('POST',body))).status,201);
    assert.equal(source.sql.prepare('SELECT count(*) n FROM notification_outbox WHERE id=?').get('test:'+body.idempotencyKey).n,1);
  });
  await check('Backup blocks by default and requires a distinct bucket, valid key and maintenance acknowledgment',async()=>{
    await assert.rejects(()=>backups.createEncryptedBackup());
    env.BACKUP_ENABLED='true';env.BACKUP_MAINTENANCE_CONFIRMED='true';env.BACKUP_ENCRYPTION_KEY=btoa('k'.repeat(32));
    env.BACKUP_BUCKET=media.binding;await assert.rejects(()=>backups.createEncryptedBackup());env.BACKUP_BUCKET=archives.binding;
    env.BACKUP_ENCRYPTION_KEY=btoa('short');await assert.rejects(()=>backups.createEncryptedBackup());env.BACKUP_ENCRYPTION_KEY=btoa('k'.repeat(32));
  });
  const now=Date.now();
  source.sql.prepare("INSERT INTO auth_users(id,email,verified_at,created_at) VALUES ('auth-restore-user','recovery@braand.test',?,?)").run(now,now);
  source.sql.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES ('offline-only-session-hash','auth-restore-user',?,?)").run(now+60000,now);
  source.sql.prepare("INSERT INTO credit_lots(id,organization_id,source,source_id,granted,balance,starts_at,created_at) VALUES ('restore-lot','ops-owner','test','fixture',500,500,?,?)").run(now,now);
  source.sql.prepare("INSERT INTO resources(id,workspace_id,kind,title,data,created_at,updated_at) VALUES ('restore-conversation','ops-owner','conversation','Recovery drill','{}',?,?)").run(now,now);
  source.sql.prepare("INSERT INTO runs(id,workspace_id,conversation_id,status,created_at,updated_at) VALUES ('restore-run','ops-owner','restore-conversation','completed',?,?)").run(now,now);
  source.sql.prepare("INSERT INTO events(seq,run_id,type,data,created_at) VALUES (100,'restore-run','test','{}',?)").run(now);
  source.sql.prepare("DELETE FROM events WHERE seq=100").run();
  // A conversation long enough to need many pages: production already holds more rows than one query per row allows.
  const insertMessage=source.sql.prepare("INSERT INTO messages(id,workspace_id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?,?)");
  for(let index=0;index<3200;index++)insertMessage.run('restore-message-'+String(index).padStart(5,'0'),'ops-owner','restore-conversation',index%2?'assistant':'user',JSON.stringify([{type:'text',text:'Message '+index+' é ✓'}]),now+index);
  await media.binding.put('ops-owner/files/fixture.txt','sensitive-fixture-content',{httpMetadata:{contentType:'text/plain'},customMetadata:{fixture:'yes'}});
  const expectedTables=source.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY name").all().map(row=>row.name);
  const expected=Object.fromEntries(expectedTables.map(name=>[name,source.sql.prepare('SELECT * FROM "'+name+'"').all()]));
  const callsBefore=source.binding.calls;
  const archive=await backups.createEncryptedBackup();
  const backupQueries=source.binding.calls-callsBefore;
  await check('A backup of thousands of rows reads them by pages, in a handful of batched calls, within even the Workers Free limit of 50 per run',async()=>{
    assert.ok(backupQueries<=20,'backup issued '+backupQueries+' database calls (Workers Free allows 50 per run)');
    assert.equal(source.sql.prepare("SELECT count(*) n FROM messages WHERE conversation_id='restore-conversation'").get().n,3200);
  });
  await check('Real AES-GCM archive contains no plaintext and restores real SQLite data plus objects without duplicate financial writes',async()=>{
    const stored=archives.objects.get('braand-backups/'+archive.id+'.bin');assert(!Buffer.from(stored.raw).includes(Buffer.from('sensitive-fixture-content')));
    const target=database(),targetMedia=bucket();env.BACKUP_RESTORE_ALLOWED='true';
    const result=await backups.restoreEncryptedBackup(archive.id,target.binding,targetMedia.binding);
    assert.equal(result.objects,1);assert.equal(result.tables,expectedTables.length);
    for(const name of expectedTables)assert.deepEqual(target.sql.prepare('SELECT * FROM "'+name+'"').all(),expected[name],name+' rows must match exactly');
    assert.equal(target.sql.prepare("SELECT id FROM auth_users WHERE email='recovery@braand.test'").get().id,'auth-restore-user','Restore preserves the independent identity that owns the workspace');
    assert.equal(target.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE lot_id='restore-lot'").get().n,1);
    assert.equal(target.sql.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get().seq,100);
    assert.equal(await (await targetMedia.binding.get('ops-owner/files/fixture.txt')).text(),'sensitive-fixture-content');
    assert.deepEqual(targetMedia.objects.get('ops-owner/files/fixture.txt').customMetadata,{fixture:'yes'});
    assert.deepEqual(target.sql.prepare('PRAGMA foreign_key_check').all(),[]);target.sql.close();
  });
  await check('Restore refuses production, same source, existing destination, wrong key and modified ciphertext before writes',async()=>{
    const target=database(),targetMedia=bucket();env.APP_ENV='production';await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,target.binding,targetMedia.binding));env.APP_ENV='test';
    await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,source.binding,targetMedia.binding));
    target.sql.exec('CREATE TABLE existing(id TEXT)');await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,target.binding,targetMedia.binding));target.sql.close();
    const empty=database();env.BACKUP_ENCRYPTION_KEY=btoa('x'.repeat(32));await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,empty.binding,targetMedia.binding));env.BACKUP_ENCRYPTION_KEY=btoa('k'.repeat(32));
    const stored=archives.objects.get('braand-backups/'+archive.id+'.bin');stored.raw[25]^=1;
    await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,empty.binding,targetMedia.binding));
    stored.raw[25]^=1;
    assert.equal(targetMedia.objects.size,0);assert.equal(empty.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,0);empty.sql.close();
  });
  await check('Legacy v1 encrypted archives still restore financial rows, sequence values, metadata and object bytes',async()=>{
    const id=crypto.randomUUID(),schema=source.sql.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all();
    const raw=new TextEncoder().encode('legacy-sensitive-content'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('base64');
    const snapshot={format:legacyPrefix+'-backup-v1',id,createdAt:now,schema,tables:expectedTables.map(name=>({name,rows:expected[name]})),sequences:source.sql.prepare('SELECT name,seq FROM sqlite_sequence').all(),objects:[{key:'legacy.txt',bytes:Buffer.from(raw).toString('base64'),sha256,httpMetadata:{contentType:'text/plain'},customMetadata:{legacy:'yes'}}]};
    await archives.binding.put(legacyPrefix+'-backups/'+id+'.bin',await encryptLegacyFixture(id,'',new TextEncoder().encode(JSON.stringify(snapshot)),1));
    const target=database(),targetMedia=bucket();
    try{
      const result=await backups.restoreEncryptedBackup(id,target.binding,targetMedia.binding);assert.equal(result.objects,1);
      for(const name of expectedTables)assert.deepEqual(target.sql.prepare('SELECT * FROM "'+name+'"').all(),expected[name]);
      assert.equal(target.sql.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get().seq,100);
      assert.equal(await(await targetMedia.binding.get('legacy.txt')).text(),'legacy-sensitive-content');
      assert.deepEqual(targetMedia.objects.get('legacy.txt').customMetadata,{legacy:'yes'});
    }finally{target.sql.close();}
    archives.objects.get(legacyPrefix+'-backups/'+id+'.bin').raw[25]^=1;await assertRestoreEmpty(id);
  });
  await check('Legacy v2 archives decrypt old manifest and segment AAD from the previous key prefix',async()=>{
    const id=crypto.randomUUID(),snapshot={format:legacyPrefix+'-backup-v1',id,createdAt:now,schema:[],tables:[],sequences:[],objects:[]},sqlBytes=new TextEncoder().encode(JSON.stringify(snapshot)),digest=Buffer.from(await crypto.subtle.digest('SHA-256',sqlBytes)).toString('base64'),manifest={format:legacyPrefix+'-backup-v2',id,createdAt:now,databaseBytes:sqlBytes.length,databaseDigests:[digest],objectPages:0,objects:0,mediaBytes:0,tables:0,rows:0};
    await archives.binding.put(legacyPrefix+'-backups/'+id+'/database-0.bin',await encryptLegacyFixture(id,'database-0',sqlBytes));
    const encrypted=await encryptLegacyFixture(id,'manifest',new TextEncoder().encode(JSON.stringify(manifest))),magic=new TextEncoder().encode(legacyPrefix.toUpperCase()+'2\n'),root=new Uint8Array(magic.length+encrypted.length);root.set(magic);root.set(encrypted,magic.length);
    await archives.binding.put(legacyPrefix+'-backups/'+id+'.bin',root);
    const target=database(),targetMedia=bucket();try{const result=await backups.restoreEncryptedBackup(id,target.binding,targetMedia.binding);assert.deepEqual(result,{id,tables:0,rows:0,objects:0});}finally{target.sql.close();}
  });
  let largeArchive;
  await check('A full 50 MiB file and more than 100 objects round-trip with 1 MiB range reads and streamed conditional writes',async()=>{
    const content=new Uint8Array(50*1024*1024);content.fill(173);content[0]=11;content[content.length-1]=29;
    await media.binding.put('ops-owner/files/large.bin',content,{httpMetadata:{contentType:'application/octet-stream',cacheExpiry:new Date('2030-01-01T00:00:00Z')},customMetadata:{large:'yes'}});
    for(let index=0;index<205;index++)await media.binding.put('ops-owner/files/page-'+String(index).padStart(3,'0')+'.txt','page-'+index);
    await media.binding.put('ops-owner/files/zero.bin',new Uint8Array());
    const before=media.stats.lists,expectedRows=Object.fromEntries(expectedTables.map(name=>[name,source.sql.prepare('SELECT * FROM "'+name+'"').all()]));
    const result=await backups.createEncryptedBackup();largeArchive=result;
    assert.equal(result.objects,208);assert(media.stats.lists-before>=3);
    const largeReads=media.stats.reads.filter(read=>read.key==='ops-owner/files/large.bin');assert.equal(largeReads.length,50);assert(largeReads.every(read=>read.range&&read.bytes<=1024*1024));
    assert(archives.stats.writes.filter(write=>write.key.startsWith('braand-backups/'+result.id+'/')).every(write=>write.bytes<=1024*1024+28));
    const manifest=await readManifest(result.id);assert.equal(manifest.objectPages,3);assert.equal(manifest.objects,208);
    const target=database(),targetMedia=bucket();
    try{
      assert.equal((await backups.restoreEncryptedBackup(result.id,target.binding,targetMedia.binding)).objects,208);
      assert.equal(targetMedia.stats.streamWrites,208);assert(targetMedia.stats.maxStreamChunk<=1024*1024);
      assert.equal(Buffer.compare(Buffer.from(targetMedia.objects.get('ops-owner/files/large.bin').raw),Buffer.from(content)),0);
      for(const [key,item]of media.objects){const restored=targetMedia.objects.get(key);assert(restored,key);assert.equal(Buffer.compare(Buffer.from(restored.raw),Buffer.from(item.raw)),0);assert.deepEqual(restored.customMetadata,item.customMetadata);assert.deepEqual(restored.httpMetadata,item.httpMetadata);}
      for(const name of expectedTables)assert.deepEqual(target.sql.prepare('SELECT * FROM "'+name+'"').all(),expectedRows[name]);
      assert.deepEqual(target.sql.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{target.sql.close();}
  });
  await check('Missing pages, late ciphertext corruption and swapped object parts are rejected before any destination write',async()=>{
    const pageKey='braand-backups/'+largeArchive.id+'/objects-2.bin',page=archives.objects.get(pageKey);archives.objects.delete(pageKey);
    try{await assertRestoreEmpty(largeArchive.id);}finally{archives.objects.set(pageKey,page);}
    const lastKey=[...archives.objects.keys()].find(key=>key.startsWith('braand-backups/'+largeArchive.id+'/')&&/object-\d+-49\.bin$/.test(key));assert(lastKey);
    const last=archives.objects.get(lastKey);last.raw[25]^=1;try{await assertRestoreEmpty(largeArchive.id);}finally{last.raw[25]^=1;}
    const firstKey=lastKey.replace('-49.bin','-0.bin'),first=archives.objects.get(firstKey),saved=last.raw;last.raw=first.raw;
    try{await assertRestoreEmpty(largeArchive.id);}finally{last.raw=saved;}
  });
  await check('Authenticated parts still need their recorded SHA-256 and exact length; malformed committed limits are refused',async()=>{
    const key=[...archives.objects.keys()].find(key=>key.startsWith('braand-backups/'+largeArchive.id+'/')&&/object-\d+-49\.bin$/.test(key)),item=archives.objects.get(key),original=item.raw,label=key.split('/').at(-1).slice(0,-4);
    const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:original.slice(0,12),additionalData:new TextEncoder().encode('braand-backup-v2:'+largeArchive.id+':'+label)},fixtureKey,original.slice(12)));plain[0]^=1;
    item.raw=await encryptFixture(largeArchive.id,label,plain);try{await assertRestoreEmpty(largeArchive.id);}finally{item.raw=original;}
    const originalManifest=await readManifest(largeArchive.id);
    for(const patch of [{objects:100001},{mediaBytes:64*1024**3+1},{databaseBytes:25*1024*1024},{objectPages:0}]){
      await replaceManifest(largeArchive.id,{...originalManifest,...patch});await assertRestoreEmpty(largeArchive.id);
    }
    await replaceManifest(largeArchive.id,originalManifest);
  });
  await check('Interrupted segment writes and failed manifest commits never register a completed backup',async()=>{
    for(const failManifest of [false,true]){
      const small=bucket(),failed=bucket();await small.binding.put('two-parts.bin',new Uint8Array(2*1024*1024));
      const count=source.sql.prepare('SELECT count(*) n FROM operations_backups').get().n;
      failed.hooks.put=async key=>{if(failManifest?/^braand-backups\/[^/]+\.bin$/.test(key):key.endsWith('/object-0-1.bin'))throw new Error('fixture-write-failure');};
      await withBackupBindings(source.binding,small.binding,failed.binding,async()=>{await assert.rejects(()=>backups.createEncryptedBackup());});
      assert.equal(source.sql.prepare('SELECT count(*) n FROM operations_backups').get().n,count);
      assert(![...failed.objects.keys()].some(key=>/^braand-backups\/[^/]+\.bin$/.test(key)));
      assert(failed.objects.size>0,'partial segments remain for diagnosis');
    }
  });
  await check('Source changes, invalid range length and broken list cursors abort without a completed manifest',async()=>{
    for(const mode of ['etag','range','cursor']){
      const changing=bucket(),failed=bucket();await changing.binding.put('changing.bin',new Uint8Array(2*1024*1024));
      if(mode==='etag')changing.hooks.get=async(key,options)=>{if(options.range?.offset===1024*1024)changing.objects.get(key).etag='changed';};
      if(mode==='range'){const get=changing.binding.get;changing.binding.get=async(key,options)=>{const object=await get(key,options);if(options.range)object.arrayBuffer=async()=>new Uint8Array(options.range.length-1).buffer;return object;};}
      if(mode==='cursor')changing.hooks.list=page=>({...page,truncated:true,cursor:undefined});
      await withBackupBindings(source.binding,changing.binding,failed.binding,async()=>{await assert.rejects(()=>backups.createEncryptedBackup(),error=>['backup_changed','backup_listing_invalid'].includes(error.code));});
      assert(![...failed.objects.keys()].some(key=>/^braand-backups\/[^/]+\.bin$/.test(key)));
    }
  });
  await check('Readiness exposes bounds; oversized objects, SQL byte totals and SQL row totals are refused explicitly',async()=>{
    const limits=backups.backupReadiness().limits;assert.equal(limits.partBytes,1024*1024);assert.equal(limits.sqlRows,250000);assert.equal(limits.sqlBytes,24*1024*1024);assert.equal(limits.objects,100000);
    const oversized=bucket(),failed=bucket();oversized.objects.set('too-big.bin',{key:'too-big.bin',size:limits.objectBytes+1,etag:'oversize',raw:new Uint8Array()});
    await withBackupBindings(source.binding,oversized.binding,failed.binding,async()=>{await assert.rejects(()=>backups.createEncryptedBackup(),error=>error.code==='backup_too_large');});assert.equal(oversized.stats.reads.length,0);
    for(const mode of ['rows','bytes']){
      const sql=database(),empty=bucket(),storage=bucket();sql.sql.exec('CREATE TABLE input(id INTEGER PRIMARY KEY,value TEXT)');
      if(mode==='rows')sql.sql.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<250001) INSERT INTO input SELECT i,'x' FROM n");
      else{const insert=sql.sql.prepare('INSERT INTO input(value) VALUES (?)');for(let index=0;index<25;index++)insert.run('x'.repeat(1024*1024));}
      try{await withBackupBindings(sql.binding,empty.binding,storage.binding,async()=>{await assert.rejects(()=>backups.createEncryptedBackup(),error=>error.code==='backup_too_large');});assert.equal(storage.objects.size,0);}
      finally{sql.sql.close();}
    }
  });
  await check('Nonempty destinations and concurrent object collisions retain existing bytes; failed restores never erase data',async()=>{
    const target=database(),existing=bucket();await existing.binding.put('keep.txt','preserve');
    try{await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,target.binding,existing.binding));assert.equal(await(await existing.binding.get('keep.txt')).text(),'preserve');}
    finally{target.sql.close();}
    const destination=database(),collision=bucket();let inject=true;
    collision.hooks.put=async key=>{if(inject){inject=false;collision.hooks.put=undefined;await collision.binding.put(key,'concurrent-existing');}};
    try{
      await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,destination.binding,collision.binding),error=>error.code==='restore_incomplete');
      assert.equal(await(await collision.binding.get('ops-owner/files/fixture.txt')).text(),'concurrent-existing');
      assert.equal(destination.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,0);
    }finally{destination.sql.close();}
    const partial=database(),objects=bucket();let calls=0;objects.hooks.put=async()=>{if(++calls===2)throw new Error('fixture-destination-write-failed');};
    try{
      await assert.rejects(()=>backups.restoreEncryptedBackup(largeArchive.id,partial.binding,objects.binding));assert.equal(objects.objects.size,1);
      assert.equal(await(await objects.binding.get('ops-owner/files/fixture.txt')).text(),'sensitive-fixture-content');
      assert.equal(partial.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,0);
    }finally{partial.sql.close();}
  });
  await check('A SQL restore failure rolls back its batch and preserves already copied media for diagnosis',async()=>{
    const target=database(),objects=bucket(),rejected={prepare:target.binding.prepare,batch:async statements=>{const extra=target.binding.prepare('INSERT INTO table_that_does_not_exist VALUES (1)');return target.binding.batch([...statements,extra]);}};
    try{
      await assert.rejects(()=>backups.restoreEncryptedBackup(archive.id,rejected,objects.binding));
      assert.equal(target.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,0);
      assert.equal(await(await objects.binding.get('ops-owner/files/fixture.txt')).text(),'sensitive-fixture-content');
      assert.equal(source.sql.prepare("SELECT balance FROM credit_lots WHERE id='restore-lot'").get().balance,500);
    }finally{target.sql.close();}
  });
  await check('monitoring detects expired leases in previous slots without replaying them',async()=>{
    const now=Date.now();
    source.sql.prepare("INSERT INTO operations_jobs(id,name,status,lease_token,lease_until,created_at,updated_at) VALUES ('fixture:orphan-old-slot','fixture','running','old-owner',?,?,?)").run(now-10000,now-20000,now-20000);
    source.sql.prepare("INSERT INTO operations_jobs(id,name,status,lease_token,lease_until,created_at,updated_at) VALUES ('fixture:live-slot','fixture','running','live-owner',?,?,?)").run(now+120000,now,now);
    await ops.scanOperationalIncidents(now);
    const orphan=source.sql.prepare("SELECT status,error_code,lease_token FROM operations_jobs WHERE id='fixture:orphan-old-slot'").get();
    assert.equal(orphan.status,'uncertain');assert.equal(orphan.error_code,'job_interrupted');assert.equal(orphan.lease_token,null);
    assert.equal(source.sql.prepare("SELECT status FROM operations_jobs WHERE id='fixture:live-slot'").get().status,'running');
    let executions=0;await ops.runTrackedJob('fixture','fixture:orphan-old-slot',async()=>{executions++;},now);assert.equal(executions,0);
  });
  console.log(`${checks} production operations checks passed. SQLite/crypto recovery is real; Resend and R2 were simulated. No external mail or production restore.`);
} finally {globalThis.fetch=originalFetch;source.sql.close();}
