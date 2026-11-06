import {config, db, uid} from './server';
import {AppError} from './core.mjs';

// SQL remains bounded for one atomic D1 restore. Media never enters this buffer.
// The SQL snapshot is read by pages: a Worker run may issue at most 1,000
// database queries, so one query per row could never finish a real backup.
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const LEGACY_V1_BYTES = 8 * 1024 * 1024; // Single-object v1 archives stay bounded as before.
const MAX_ROWS = 250000;
const PAGE_ROWS = 500;
const BATCH_PAGES = 8; // pages of one large table read in the same batch
const BATCH_STATEMENTS = 40;
const MAX_OBJECTS = 100000;
// Schema size is not the restore risk (rows and bytes are bounded above); leave room for new features.
const MAX_TABLES = 160;
const PART_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 64 * 1024 ** 3;
const MAX_OBJECT_BYTES = 1024 ** 3;
const MAGIC = new TextEncoder().encode('BRAAND2\n');
const LEGACY_PREFIX = ['ai', 'ra'].join('');
const LEGACY_MAGIC = new TextEncoder().encode(LEGACY_PREFIX.toUpperCase() + '2\n');
const LEGACY_BACKUP_V1 = LEGACY_PREFIX + '-backup-v1';
const LEGACY_BACKUP_V2 = LEGACY_PREFIX + '-backup-v2';
type SchemaEntry = {type: string; name: string; sql: string};
type Cell = string | number | null | {blob: string};
type Snapshot = {
  format: string; id: string; createdAt: number; schema: SchemaEntry[];
  tables: {name: string; rows: Record<string, Cell>[]}[];
  sequences: {name:string;seq:number}[];
  objects: {key: string; bytes: string; sha256: string; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string,string>}[];
};
type ObjectEntry = {key:string; size:number; digests:string[]; httpMetadata?:R2HTTPMetadata; customMetadata?:Record<string,string>};
type Manifest = {format:string;id:string;createdAt:number;databaseBytes:number;databaseDigests:string[];objectPages:number;objects:number;mediaBytes:number;tables:number;rows:number};
type BackupBindings = {BUCKET?: R2Bucket; BACKUP_BUCKET?: R2Bucket};
const bindings = () => config() as unknown as BackupBindings;
const identifier = (name: string) => {if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new AppError('Schéma de sauvegarde invalide.',409,'backup_schema_invalid'); return '"' + name + '"';};
const encoder = new TextEncoder();
function toBase64(bytes: Uint8Array) {let out = ''; for (let offset=0;offset<bytes.length;offset+=8192) out += String.fromCharCode(...bytes.subarray(offset,offset+8192)); return btoa(out);}
function fromBase64(value: string) {try {return Uint8Array.from(atob(value), char => char.charCodeAt(0));} catch {throw new AppError('Archive invalide.',409,'backup_invalid');}}
async function digest(bytes: ArrayBuffer) {return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));}

async function backupKey() {
  const key = fromBase64(config().BACKUP_ENCRYPTION_KEY || '');
  if (key.byteLength !== 32) throw new AppError('Clé de sauvegarde AES-256 manquante.',503,'backup_key_missing');
  return crypto.subtle.importKey('raw', key, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
}
export function backupReadiness() {
  const c = config(), b = bindings();
  const limits={sqlBytes:MAX_ARCHIVE_BYTES,sqlRows:MAX_ROWS,tables:MAX_TABLES,objects:MAX_OBJECTS,mediaBytes:MAX_MEDIA_BYTES,objectBytes:MAX_OBJECT_BYTES,partBytes:PART_BYTES,metadataPageBytes:MAX_MANIFEST_BYTES};
  if (c.BACKUP_ENABLED !== 'true') return {ready:false,reason:'backup_disabled',limits};
  if (!b.BUCKET || !b.BACKUP_BUCKET || b.BUCKET === b.BACKUP_BUCKET) return {ready:false,reason:'separate_backup_bucket_required',limits};
  if (!c.BACKUP_ENCRYPTION_KEY) return {ready:false,reason:'backup_key_missing',limits};
  if (c.BACKUP_MAINTENANCE_CONFIRMED !== 'true') return {ready:false,reason:'backup_maintenance_required',limits};
  return {ready:true,reason:null,limits};
}
async function schema(database: D1Database) {
  const result = await database.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all<SchemaEntry>();
  if (result.results.filter(row => row.type === 'table').length > MAX_TABLES) throw new AppError('Sauvegarde trop volumineuse pour ce parcours.',409,'backup_too_large');
  for (const row of result.results) {
    identifier(row.name);
    if (!['table','index','trigger'].includes(row.type) || !/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\b/i.test(row.sql)) throw new AppError('Schéma non pris en charge.',409,'backup_schema_invalid');
  }
  return result.results;
}
function encodeRow(row: Record<string, unknown>): Record<string, Cell> {
  return Object.fromEntries(Object.entries(row).map(([column,value]) => {
    identifier(column);
    if (value === null || typeof value === 'string') return [column,value];
    if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return [column,value];
    if (value instanceof ArrayBuffer) return [column,{blob:toBase64(new Uint8Array(value))}];
    if (ArrayBuffer.isView(value)) return [column,{blob:toBase64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))}];
    throw new AppError('Type de donnée non pris en charge par la sauvegarde.',409,'backup_data_unsupported');
  }));
}
// Each table is encoded as soon as it is read, so memory holds bytes, not a
// second copy of every row as objects. The result is the same JSON document as
// a v1 snapshot, so restore is unchanged.
async function snapshot(id: string, now: number): Promise<{bytes: Uint8Array; tables: number; rows: number}> {
  const database = db(), entries = await schema(database), tableNames = entries.filter(entry => entry.type === 'table').map(entry => entry.name);
  const sequenceTable = await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").first();
  const sequences = sequenceTable ? (await database.prepare('SELECT name,seq FROM sqlite_sequence').all<{name:string;seq:number}>()).results : [];
  const head = encoder.encode(JSON.stringify({format:'braand-backup-v1',id,createdAt:now,schema:entries,sequences,objects:[]}).slice(0,-1) + ',"tables":[');
  const chunks: Uint8Array[] = [head];
  let count = 0, size = head.byteLength + 2;
  // Reads are grouped in db.batch() calls, which count as one query each
  // against the per-run limit (50 on Workers Free, 1,000 on Paid). The required
  // maintenance window keeps pagination stable across reads.
  const withoutRowid = new Set(entries.filter(entry => entry.type === 'table' && /\bWITHOUT\s+ROWID\b/i.test(entry.sql)).map(entry => entry.name));
  const select = (name: string, offset: number) => database.prepare('SELECT * FROM ' + identifier(name) + (withoutRowid.has(name) ? '' : ' ORDER BY rowid') + ' LIMIT ? OFFSET ?').bind(PAGE_ROWS, offset);
  const parts = new Map<string, string[]>(tableNames.map(name => [name, []]));
  let pending = tableNames.map(name => ({name, offset: 0, first: true}));
  while (pending.length) {
    // One page for tables not read yet; several pages at once for large ones.
    const requests: {name: string; offset: number}[] = [];
    for (const table of pending) {
      const pages = table.first ? 1 : BATCH_PAGES;
      for (let page = 0; page < pages && requests.length < BATCH_STATEMENTS; page++) requests.push({name: table.name, offset: table.offset + page * PAGE_ROWS});
      if (requests.length >= BATCH_STATEMENTS) break;
    }
    const results = await database.batch<Record<string, unknown>>(requests.map(request => select(request.name, request.offset)));
    const finished = new Set<string>(), reached = new Map<string, number>();
    results.forEach((result, index) => {
      const {name, offset} = requests[index], rows = result.results || [];
      if (finished.has(name)) return;
      for (const row of rows) {
        const encoded = JSON.stringify(encodeRow(row));
        size += encoder.encode(encoded).byteLength + 1;
        if (++count > MAX_ROWS || size > MAX_ARCHIVE_BYTES) throw new AppError('Le snapshot SQL dépasse la limite de restauration transactionnelle.',409,'backup_too_large');
        parts.get(name)!.push(encoded);
      }
      if (rows.length < PAGE_ROWS) finished.add(name); else reached.set(name, offset + PAGE_ROWS);
    });
    pending = pending.flatMap(table => finished.has(table.name) ? [] : reached.has(table.name) ? [{name: table.name, offset: reached.get(table.name)!, first: false}] : [table]);
  }
  for (const [index, name] of tableNames.entries()) {
    const rows = parts.get(name)!;
    const table = encoder.encode((index ? ',' : '') + '{"name":' + JSON.stringify(name) + ',"rows":[' + rows.join(',') + ']}');
    size += table.byteLength - rows.length;
    chunks.push(table);
    parts.delete(name);
  }
  chunks.push(encoder.encode(']}'));
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let at = 0; for (const chunk of chunks) {bytes.set(chunk, at); at += chunk.byteLength;}
  return {bytes, tables: tableNames.length, rows: count};
}

const segmentPath = (id:string, label:string) => 'braand-backups/' + id + '/' + label + '.bin';
const legacySegmentPath = (id:string, label:string) => LEGACY_PREFIX + '-backups/' + id + '/' + label + '.bin';
const invalid = () => new AppError('Archive invalide.',409,'backup_invalid');
const integrity = () => new AppError('L’intégrité ou la clé de l’archive est invalide.',409,'backup_integrity_failed');
const boundedInteger = (value:number, max:number) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const validDigest = (value:string) => typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value);
function compareKeys(a:string,b:string) {
  const left=encoder.encode(a),right=encoder.encode(b);
  for(let index=0;index<Math.min(left.length,right.length);index++)if(left[index]!==right[index])return left[index]-right[index];
  return left.length-right.length;
}
async function encryptSegment(key:CryptoKey,id:string,label:string,plain:Uint8Array) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('braand-backup-v2:'+id+':'+label)},key,plain.slice().buffer));
  const stored=new Uint8Array(12+cipher.byteLength);stored.set(iv);stored.set(cipher,12);return stored;
}
async function putSegment(key:CryptoKey,id:string,label:string,plain:Uint8Array) {
  if(plain.byteLength>PART_BYTES)throw invalid();
  const stored=await encryptSegment(key,id,label,plain);
  if(!await bindings().BACKUP_BUCKET!.put(segmentPath(id,label),stored,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}}))throw new AppError('La sauvegarde n’a pas été confirmée.',502,'backup_write_unknown');
  return stored.byteLength;
}
async function readSegment(key:CryptoKey,id:string,label:string,expectedDigest?:string) {
  const bucket=bindings().BACKUP_BUCKET!;
  const stored=await bucket.get(segmentPath(id,label))||await bucket.get(legacySegmentPath(id,label));
  if(!stored || stored.size<28 || stored.size>PART_BYTES+28)throw invalid();
  const raw=new Uint8Array(await stored.arrayBuffer());
  let plain:Uint8Array;
  try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12),additionalData:encoder.encode('braand-backup-v2:'+id+':'+label)},key,raw.slice(12)));}catch{try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12),additionalData:encoder.encode(LEGACY_BACKUP_V2+':'+id+':'+label)},key,raw.slice(12)));}catch{throw integrity();}}
  if(expectedDigest && await digest(plain.slice().buffer)!==expectedDigest)throw integrity();
  return plain;
}
function validateObject(entry:ObjectEntry) {
  if(!entry || typeof entry.key!=='string' || !entry.key.length || encoder.encode(entry.key).byteLength>1024 || !boundedInteger(entry.size,MAX_OBJECT_BYTES) || !Array.isArray(entry.digests) || entry.digests.length!==Math.ceil(entry.size/PART_BYTES) || !entry.digests.every(validDigest))throw invalid();
  if(entry.customMetadata && (typeof entry.customMetadata!=='object' || Object.values(entry.customMetadata).some(value=>typeof value!=='string')))throw invalid();
}
async function* objectEntries(key:CryptoKey,manifest:Manifest) {
  let count=0,size=0,previous:string|undefined;
  for(let page=0;page<manifest.objectPages;page++) {
    const plain=await readSegment(key,manifest.id,'objects-'+page);
    if(plain.byteLength>MAX_MANIFEST_BYTES)throw invalid();
    let entries:ObjectEntry[];try{entries=JSON.parse(new TextDecoder().decode(plain));}catch{throw invalid();}
    if(!Array.isArray(entries) || !entries.length || entries.length>100)throw invalid();
    for(const entry of entries) {
      validateObject(entry);
      if(previous!==undefined && compareKeys(previous,entry.key)>=0)throw invalid();previous=entry.key;
      size+=entry.size;if(++count>manifest.objects || size>manifest.mediaBytes)throw invalid();
      yield {entry,index:count-1};
    }
  }
  if(count!==manifest.objects || size!==manifest.mediaBytes)throw invalid();
}
export async function createEncryptedBackup(now = Date.now()) {
  const readiness = backupReadiness();
  if (!readiness.ready) throw new AppError('La sauvegarde nécessite une configuration et une fenêtre de maintenance validées.',503,readiness.reason || 'backup_not_ready');
  const key=await backupKey(),id=uid(),archive=await snapshot(id,now),plain=archive.bytes;
  if(plain.byteLength>MAX_ARCHIVE_BYTES)throw new AppError('Le snapshot SQL dépasse la limite de restauration transactionnelle.',409,'backup_too_large');
  let bytes=0;
  const manifest:Manifest={format:'braand-backup-v2',id,createdAt:now,databaseBytes:plain.byteLength,databaseDigests:[],objectPages:0,objects:0,mediaBytes:0,tables:archive.tables,rows:archive.rows};
  for(let offset=0;offset<plain.byteLength;offset+=PART_BYTES){const part=plain.subarray(offset,offset+PART_BYTES);manifest.databaseDigests.push(await digest(part.slice().buffer));bytes+=await putSegment(key,id,'database-'+(offset/PART_BYTES),part);}
  let cursor:string|undefined,previous:string|undefined;
  let entries:ObjectEntry[]=[],pageSize=2;
  const flush=async()=>{if(!entries.length)return;bytes+=await putSegment(key,id,'objects-'+manifest.objectPages++,encoder.encode(JSON.stringify(entries)));entries=[];pageSize=2;};
  do {
    const options:R2ListOptions & {include:string[]}={limit:100,cursor,include:['httpMetadata','customMetadata']};
    const page=await bindings().BUCKET!.list(options);
    for(const item of page.objects){
      if(previous!==undefined&&compareKeys(previous,item.key)>=0)throw new AppError('Pagination de sauvegarde incohérente.',502,'backup_listing_invalid');previous=item.key;
      if(!boundedInteger(item.size,MAX_OBJECT_BYTES)||manifest.objects>=MAX_OBJECTS||manifest.mediaBytes+item.size>MAX_MEDIA_BYTES)throw new AppError('Le volume média dépasse les limites de cette sauvegarde.',409,'backup_too_large');
      const entry:ObjectEntry={key:item.key,size:item.size,digests:[],httpMetadata:item.httpMetadata,customMetadata:item.customMetadata};
      for(let offset=0;offset<item.size;offset+=PART_BYTES){
        const length=Math.min(PART_BYTES,item.size-offset),object=await bindings().BUCKET!.get(item.key,{onlyIf:{etagMatches:item.etag},range:{offset,length}});
        if(!object || !('body' in object))throw new AppError('Les données ont changé pendant la sauvegarde.',409,'backup_changed');
        const part=await object.arrayBuffer();if(part.byteLength!==length)throw new AppError('Lecture partielle de sauvegarde incohérente.',409,'backup_changed');
        entry.digests.push(await digest(part));bytes+=await putSegment(key,id,'object-'+manifest.objects+'-'+(offset/PART_BYTES),new Uint8Array(part));
      }
      // Even an empty object needs an ETag check (there are no ranges to read).
      if(item.size===0){const object=await bindings().BUCKET!.get(item.key,{onlyIf:{etagMatches:item.etag}});if(!object||!('body' in object))throw new AppError('Les données ont changé pendant la sauvegarde.',409,'backup_changed');}
      validateObject(entry);
      const entryBytes=encoder.encode(JSON.stringify(entry)).byteLength+1;
      if(entryBytes+2>MAX_MANIFEST_BYTES)throw new AppError('Métadonnées de sauvegarde trop volumineuses.',409,'backup_too_large');
      if(entries.length>=100||pageSize+entryBytes>MAX_MANIFEST_BYTES)await flush();
      entries.push(entry);pageSize+=entryBytes;manifest.objects++;manifest.mediaBytes+=item.size;
    }
    if(page.truncated&&(!page.cursor||page.cursor===cursor))throw new AppError('Pagination de sauvegarde incohérente.',502,'backup_listing_invalid');
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  await flush();
  // Commit last: orphan segments after a failure never appear as a completed backup.
  const encrypted=await encryptSegment(key,id,'manifest',encoder.encode(JSON.stringify(manifest))),stored=new Uint8Array(MAGIC.length+encrypted.byteLength);stored.set(MAGIC);stored.set(encrypted,MAGIC.length);
  const objectKey='braand-backups/'+id+'.bin';
  if(!await bindings().BACKUP_BUCKET!.put(objectKey,stored,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}}))throw new AppError('La sauvegarde n’a pas été confirmée.',502,'backup_write_unknown');
  bytes+=stored.byteLength;
  await db().prepare("INSERT INTO operations_backups(id,object_key,status,bytes,tables_count,rows_count,objects_count,created_at) VALUES (?,?,'completed',?,?,?,?,?)")
    .bind(id,objectKey,bytes,manifest.tables,manifest.rows,manifest.objects,now).run();
  return {id,bytes,tables:manifest.tables,rows:manifest.rows,objects:manifest.objects};
}

// Recovery drill only. There is intentionally no production restore HTTP endpoint.
// Destination must contain no application tables or objects, so no deletion/drop is needed.
export async function restoreEncryptedBackup(id: string, destination: D1Database, targetBucket: R2Bucket) {
  const c = config(), b = bindings();
  if (!['test','staging'].includes(c.APP_ENV || '') || c.BACKUP_RESTORE_ALLOWED !== 'true') throw new AppError('Restauration réservée à un environnement de test explicitement autorisé.',403,'restore_not_allowed');
  if (!/^[a-f0-9-]{36}$/.test(id) || destination === db() || targetBucket === b.BUCKET || targetBucket === b.BACKUP_BUCKET || !b.BACKUP_BUCKET) throw new AppError('Destination de restauration distincte requise.',409,'restore_destination_invalid');
  if ((await schema(destination)).length || (await targetBucket.list({limit:1})).objects.length) throw new AppError('La destination doit être entièrement vide.',409,'restore_destination_not_empty');
  const stored = await b.BACKUP_BUCKET.get('braand-backups/' + id + '.bin')||await b.BACKUP_BUCKET.get(LEGACY_PREFIX + '-backups/' + id + '.bin');
  if (!stored || stored.size > Math.max(LEGACY_V1_BYTES,MAX_MANIFEST_BYTES+64)+28) throw new AppError('Archive introuvable ou trop volumineuse.',404,'backup_invalid');
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const key=await backupKey();
  let archive: Snapshot|undefined,manifest:Manifest|undefined;
  const currentV2=MAGIC.every((value,index)=>bytes[index]===value),legacyV2=LEGACY_MAGIC.every((value,index)=>bytes[index]===value),v2=currentV2||legacyV2;
  try {
    if(v2){
      if(bytes.byteLength>MAX_MANIFEST_BYTES+MAGIC.length+28)throw invalid();
      const encoded=bytes.subarray((currentV2?MAGIC:LEGACY_MAGIC).length);
      let plain:ArrayBuffer;
      try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:encoded.slice(0,12),additionalData:encoder.encode((currentV2?'braand-backup-v2':LEGACY_BACKUP_V2)+':'+id+':manifest')},key,encoded.slice(12));}
      catch{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:encoded.slice(0,12),additionalData:encoder.encode(LEGACY_BACKUP_V2+':'+id+':manifest')},key,encoded.slice(12));}
      manifest=JSON.parse(new TextDecoder().decode(plain)) as Manifest;
    }else{
      let plain:ArrayBuffer;
      try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:encoder.encode('braand-backup-v1:'+id)},key,bytes.slice(12));}
      catch{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:encoder.encode(LEGACY_BACKUP_V1+':'+id)},key,bytes.slice(12));}
      archive=JSON.parse(new TextDecoder().decode(plain)) as Snapshot;
    }
  }catch{throw integrity();}
  if(manifest){
    if(![ 'braand-backup-v2', LEGACY_BACKUP_V2 ].includes(manifest.format)||manifest.id!==id||!boundedInteger(manifest.databaseBytes,MAX_ARCHIVE_BYTES)||!manifest.databaseBytes||!Array.isArray(manifest.databaseDigests)||manifest.databaseDigests.length!==Math.ceil(manifest.databaseBytes/PART_BYTES)||!manifest.databaseDigests.every(validDigest)||!boundedInteger(manifest.objects,MAX_OBJECTS)||!boundedInteger(manifest.objectPages,MAX_OBJECTS)||manifest.objectPages>manifest.objects||!boundedInteger(manifest.mediaBytes,MAX_MEDIA_BYTES)||!boundedInteger(manifest.tables,MAX_TABLES)||!boundedInteger(manifest.rows,MAX_ROWS))throw invalid();
    const sql=new Uint8Array(manifest.databaseBytes);
    for(let part=0;part<manifest.databaseDigests.length;part++){
      const plain=await readSegment(key,id,'database-'+part,manifest.databaseDigests[part]);
      if(plain.byteLength!==Math.min(PART_BYTES,sql.length-part*PART_BYTES))throw invalid();sql.set(plain,part*PART_BYTES);
    }
    try{archive=JSON.parse(new TextDecoder().decode(sql)) as Snapshot;}catch{throw invalid();}
  }
  if (!archive || !['braand-backup-v1', LEGACY_BACKUP_V1].includes(archive.format) || archive.id !== id || !Array.isArray(archive.schema) || !Array.isArray(archive.tables) || !Array.isArray(archive.objects) || !Array.isArray(archive.sequences) || archive.tables.length > MAX_TABLES || archive.objects.length > (manifest?0:100)) throw invalid();
  if(new Set(archive.tables.map(table=>table.name)).size!==archive.tables.length || archive.schema.filter(entry=>entry.type==='table').length!==archive.tables.length)throw invalid();
  const statements: D1PreparedStatement[] = [destination.prepare('PRAGMA defer_foreign_keys = ON')];
  for (const entry of archive.schema.filter(entry => entry.type === 'table')) {
    identifier(entry.name);
    if (!/^CREATE\s+TABLE\b/i.test(entry.sql) || /^CREATE\s+VIRTUAL/i.test(entry.sql)) throw new AppError('Schéma non pris en charge.',409,'backup_schema_invalid');
    statements.push(destination.prepare(entry.sql));
  }
  // Indexes before rows: a foreign key that targets a unique index (for example
  // response_feedback → messages) cannot accept rows until that index exists.
  for (const entry of archive.schema.filter(entry => entry.type === 'index')) {
    if (!/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(entry.sql)) throw new AppError('Archive invalide.',409,'backup_schema_invalid');
    statements.push(destination.prepare(entry.sql));
  }
  let rows = 0;
  for (const table of archive.tables) {
    identifier(table.name);
    if (!archive.schema.some(entry => entry.type === 'table' && entry.name === table.name) || !Array.isArray(table.rows) || (rows += table.rows.length) > MAX_ROWS) throw new AppError('Archive invalide.',409,'backup_invalid');
    for (const row of table.rows) {
      const columns = Object.keys(row), values = columns.map(column => {
        identifier(column); const value = row[column];
        if (value && typeof value === 'object' && typeof value.blob === 'string') return fromBase64(value.blob);
        if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value)||Number.isSafeInteger(value))) return value;
        throw new AppError('Archive invalide.',409,'backup_invalid');
      });
      statements.push(destination.prepare(`INSERT INTO ${identifier(table.name)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...values));
    }
  }
  for (const sequence of archive.sequences || []) {
    if (!archive.tables.some(table => table.name === sequence.name) || !Number.isSafeInteger(sequence.seq) || sequence.seq < 0) throw new AppError('Archive invalide.',409,'backup_invalid');
    statements.push(destination.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').bind(sequence.seq,sequence.name));
    statements.push(destination.prepare('INSERT INTO sqlite_sequence(name,seq) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)').bind(sequence.name,sequence.seq,sequence.name));
  }
  // Recreate financial triggers AFTER rows, so restoring a grant never issues it twice.
  for (const entry of archive.schema.filter(entry => entry.type !== 'table' && entry.type !== 'index')) {
    if (entry.type !== 'trigger' || !/^CREATE\s+TRIGGER\b/i.test(entry.sql)) throw new AppError('Archive invalide.',409,'backup_schema_invalid');
    statements.push(destination.prepare(entry.sql));
  }
  if(manifest){
    if(manifest.rows!==rows||manifest.tables!==archive.tables.length)throw invalid();
    // Preflight all pages and chunks before the first destination mutation.
    // Re-read and authenticate during streaming as well: a concurrent archive change must fail closed.
    for await(const {entry,index} of objectEntries(key,manifest)){
      for(let part=0;part<entry.digests.length;part++){
        const plain=await readSegment(key,id,'object-'+index+'-'+part,entry.digests[part]);
        if(plain.byteLength!==Math.min(PART_BYTES,entry.size-part*PART_BYTES))throw invalid();
      }
    }
    if(manifest.objects && typeof FixedLengthStream==='undefined')throw new AppError('Le runtime de restauration doit accepter les flux de taille fixe.',503,'restore_stream_unavailable');
    for await(const {entry,index} of objectEntries(key,manifest)){
      const stream=new FixedLengthStream(entry.size),writer=stream.writable.getWriter(),metadata={...entry.httpMetadata};
      if(metadata.cacheExpiry)metadata.cacheExpiry=new Date(metadata.cacheExpiry);
      const upload=targetBucket.put(entry.key,stream.readable,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:metadata,customMetadata:entry.customMetadata})
        .then(result=>{if(!result)throw new AppError('Restauration incomplète ; conserver la destination pour diagnostic.',502,'restore_incomplete');return result;})
        .catch(error=>{void stream.readable.cancel(error).catch(()=>{});void writer.abort(error).catch(()=>{});throw error;});
      const copy=(async()=>{
        try{
          for(let part=0;part<entry.digests.length;part++){
            const plain=await readSegment(key,id,'object-'+index+'-'+part,entry.digests[part]);
            if(plain.byteLength!==Math.min(PART_BYTES,entry.size-part*PART_BYTES))throw invalid();
            await writer.write(plain);
          }
          await writer.close();
        }catch(error){await writer.abort(error).catch(()=>{});throw error;}
      })();
      await Promise.all([upload,copy]);
    }
    // Financial triggers are created only after data. SQL remains one bounded atomic batch.
    await destination.batch(statements);
    return {id,tables:archive.tables.length,rows,objects:manifest.objects};
  }
  const restoredObjects = [];
  for (const object of archive.objects) {
    if (typeof object.key !== 'string' || object.key.length > 2048 || object.key.length < 1) throw new AppError('Archive invalide.',409,'backup_invalid');
    const raw = fromBase64(object.bytes);
    if (await digest(raw.buffer) !== object.sha256) throw new AppError('Objet de sauvegarde altéré.',409,'backup_integrity_failed');
    restoredObjects.push({object,raw});
  }
  // Validate the entire archive before the first write. R2 and D1 cannot share a transaction.
  for (const {object,raw} of restoredObjects) {
    const metadata = {...object.httpMetadata};
    if (metadata.cacheExpiry) metadata.cacheExpiry = new Date(metadata.cacheExpiry);
    const result = await targetBucket.put(object.key,raw,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:metadata,customMetadata:object.customMetadata});
    if (!result) throw new AppError('Restauration incomplète ; conserver la destination pour diagnostic.',502,'restore_incomplete');
  }
  await destination.batch(statements);
  return {id,tables:archive.tables.length,rows,objects:archive.objects.length};
}
