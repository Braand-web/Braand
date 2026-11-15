import {config, db, uid} from './server';
import {AppError} from './core.mjs';
import {contextSchemaStatements} from './agent-context-schema.generated.mjs';

// SQL remains bounded for one atomic D1 restore. Media never enters this buffer.
// The SQL snapshot is read by pages: a Worker run may issue at most 1,000
// database queries, so one query per row could never finish a real backup.
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const LEGACY_V1_BYTES = 8 * 1024 * 1024; // Single-object v1 archives stay bounded as before.
const MAX_ROWS = 250000;
const PAGE_ROWS = 500;
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
// The progress of the backup being written is not data to restore (a restored row would resume a phantom backup).
const derivedContextObject=(name:string)=>name==='operations_backup_progress'||/^agent_context_fts(?:_(?:data|idx|content|docsize|config|insert|update|delete))?$/.test(name);
async function schema(database: D1Database,omitDerived=false) {
  const result = await database.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all<SchemaEntry>();
  // The search index is derived from resources. Never archive FTS shadow
  // internals or accept arbitrary virtual-table SQL from an archive.
  const entries=omitDerived?result.results.filter(row=>!derivedContextObject(row.name)):result.results;
  if (entries.filter(row => row.type === 'table').length > MAX_TABLES) throw new AppError('Sauvegarde trop volumineuse pour ce parcours.',409,'backup_too_large');
  for (const row of entries) {
    identifier(row.name);
    if (!['table','index','trigger'].includes(row.type) || !/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\b/i.test(row.sql)) throw new AppError('Schéma non pris en charge.',409,'backup_schema_invalid');
  }
  return entries;
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
// ——— Writing a backup in resumable steps ———
// A daily backup used to run as one long piece of work inside a scheduled
// tick; it was cut off every night before finishing. It now advances in
// bounded steps that save their position in operations_backup_progress:
// 1. database: the SQL snapshot, streamed into encrypted 1 MiB segments
//    (memory holds one segment, not the whole archive);
// 2. objects: media files by pages of the bucket listing, a few hundred
//    storage operations per step, resumed from the saved position;
// 3. commit: the encrypted manifest last, then the operations_backups row.
// Nothing counts as a backup before step 3, so a cut never leaves a false one.
export const BACKUP_PROGRESS_SCHEMA = 'CREATE TABLE IF NOT EXISTS operations_backup_progress(id TEXT PRIMARY KEY,phase TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,error_code TEXT,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)';
type Partial = {key:string; size:number; etag:string; offset:number; digests:string[]; httpMetadata?:R2HTTPMetadata; customMetadata?:Record<string,string>};
type Progress = {manifest:Manifest; bytes:number; cursor?:string; previous?:string; entries:ObjectEntry[]; pageSize:number; partial?:Partial; listed?:boolean};
type Phase = 'database'|'objects'|'commit'|'completed'|'failed';
const FATAL = new Set(['backup_too_large','backup_schema_invalid','backup_data_unsupported','backup_key_missing','backup_listing_invalid','backup_not_ready','backup_disabled','separate_backup_bucket_required','backup_maintenance_required']);
const STALLED_MS = 36 * 3600 * 1000, MAX_ATTEMPTS = 6;

async function putSegment(key:CryptoKey,id:string,label:string,plain:Uint8Array) {
  if(plain.byteLength>PART_BYTES)throw invalid();
  const stored=await encryptSegment(key,id,label,plain),bucket=bindings().BACKUP_BUCKET!,path=segmentPath(id,label),options={onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}};
  let written=await bucket.put(path,stored,options);
  // A resumed step rewrites a segment of this same unfinished backup (never another one).
  if(!written){await bucket.delete(path);written=await bucket.put(path,stored,options);}
  if(!written)throw new AppError('La sauvegarde n’a pas été confirmée.',502,'backup_write_unknown');
  return stored.byteLength;
}

/** Streams bytes into encrypted 1 MiB database segments, keeping only their digests. */
class SegmentWriter {
  private buffer = new Uint8Array(PART_BYTES); private used = 0; private index = 0;
  digests: string[] = []; total = 0; stored = 0;
  constructor(private key: CryptoKey, private id: string) {}
  async text(value: string) {await this.write(encoder.encode(value));}
  async write(chunk: Uint8Array) {
    this.total += chunk.byteLength;
    if (this.total > MAX_ARCHIVE_BYTES) throw new AppError('Le snapshot SQL dépasse la limite de restauration transactionnelle.',409,'backup_too_large');
    let at = 0;
    while (at < chunk.byteLength) {
      const length = Math.min(PART_BYTES - this.used, chunk.byteLength - at);
      this.buffer.set(chunk.subarray(at, at + length), this.used); this.used += length; at += length;
      if (this.used === PART_BYTES) await this.flush();
    }
  }
  /** A snapshot that can never be restored leaves nothing behind. */
  async discard() {
    const bucket = bindings().BACKUP_BUCKET!;
    for (let index = 0; index < this.index; index++) await bucket.delete(segmentPath(this.id, 'database-' + index)).catch(() => undefined);
  }
  async flush() {
    if (!this.used) return;
    const part = this.buffer.slice(0, this.used); this.used = 0;
    this.digests.push(await digest(part.slice().buffer));
    this.stored += await putSegment(this.key, this.id, 'database-' + this.index++, part);
  }
}

// The same JSON document as a v1 snapshot (restore is unchanged), written as it is read.
// Reads are grouped in db.batch() calls (one query each against the per-run limit).
// The table being written gets the pages; later tables only have their first page
// read ahead, so memory holds at most one page per table, not the whole database.
async function writeSnapshot(writer: SegmentWriter, id: string, now: number): Promise<{tables: number; rows: number}> {
  const database = db(), entries = await schema(database,true), tableNames = entries.filter(entry => entry.type === 'table').map(entry => entry.name);
  const sequenceTable = await database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").first();
  const sequences = sequenceTable ? (await database.prepare('SELECT name,seq FROM sqlite_sequence').all<{name:string;seq:number}>()).results : [];
  await writer.text(JSON.stringify({format:'braand-backup-v1',id,createdAt:now,schema:entries,sequences,objects:[]}).slice(0,-1) + ',"tables":[');
  const withoutRowid = new Set(entries.filter(entry => entry.type === 'table' && /\bWITHOUT\s+ROWID\b/i.test(entry.sql)).map(entry => entry.name));
  const select = (name: string, offset: number) => database.prepare('SELECT * FROM ' + identifier(name) + (withoutRowid.has(name) ? '' : ' ORDER BY rowid') + ' LIMIT ? OFFSET ?').bind(PAGE_ROWS, offset);
  const tables = tableNames.map(name => ({name, next: 0, fetched: false, done: false, opened: false, written: 0, waiting: [] as string[]}));
  let head = 0, count = 0;
  const emit = async (table: typeof tables[number], json: string) => {await writer.text((table.written++ ? ',' : '') + json);};
  while (head < tables.length) {
    const requests: {table: typeof tables[number]; offset: number}[] = [];
    const current = tables[head];
    if (current.fetched && !current.done) for (let page = 0; page < BATCH_STATEMENTS - 8 && requests.length < BATCH_STATEMENTS; page++) requests.push({table: current, offset: current.next + page * PAGE_ROWS});
    for (const table of tables.slice(head)) {if (requests.length >= BATCH_STATEMENTS) break; if (!table.fetched) requests.push({table, offset: 0});}
    const results = await database.batch<Record<string, unknown>>(requests.map(request => select(request.table.name, request.offset)));
    for (const [index, result] of results.entries()) {
      const {table, offset} = requests[index], rows = result.results || [];
      if (table.done) continue;
      const writing = table === tables[head];
      if (writing && !table.opened) {await writer.text((head ? ',' : '') + '{"name":' + JSON.stringify(table.name) + ',"rows":[');table.opened = true;}
      for (const row of rows) {
        if (++count > MAX_ROWS) throw new AppError('Le snapshot SQL dépasse la limite de restauration transactionnelle.',409,'backup_too_large');
        const encoded = JSON.stringify(encodeRow(row));
        if (writing) await emit(table, encoded); else table.waiting.push(encoded);
      }
      table.fetched = true;
      if (rows.length < PAGE_ROWS) table.done = true; else table.next = offset + PAGE_ROWS;
    }
    // Move on through every table that is now complete, writing what was read ahead.
    while (head < tables.length && tables[head].fetched) {
      const table = tables[head];
      if (!table.opened) {await writer.text((head ? ',' : '') + '{"name":' + JSON.stringify(table.name) + ',"rows":[');table.opened = true;}
      for (const encoded of table.waiting) await emit(table, encoded);
      table.waiting = [];
      if (!table.done) break;
      await writer.text(']}'); head++;
    }
  }
  await writer.text(']}');
  await writer.flush();
  return {tables: tableNames.length, rows: count};
}

type Budget = {deadline: number; operations: number};
const spent = (budget: Budget) => Date.now() >= budget.deadline || budget.operations <= 0;

/** Copies media objects from the saved position until done or out of budget. Returns true when finished. */
async function copyObjects(key: CryptoKey, id: string, state: Progress, budget: Budget, save: () => Promise<void>) {
  const media = bindings().BUCKET!, manifest = state.manifest;
  const flush = async () => {if (!state.entries.length) return; state.bytes += await putSegment(key,id,'objects-' + manifest.objectPages,encoder.encode(JSON.stringify(state.entries))); manifest.objectPages++; state.entries = []; state.pageSize = 2; budget.operations--;};
  for (;;) {
    if (spent(budget)) return false;
    const page = await media.list({limit: 100, cursor: state.cursor, include: ['httpMetadata','customMetadata']} as R2ListOptions & {include: string[]});
    budget.operations--;
    let seen: string | undefined;
    for (const item of page.objects) {
      if (seen !== undefined && compareKeys(seen, item.key) >= 0) throw new AppError('Pagination de sauvegarde incohérente.',502,'backup_listing_invalid');
      seen = item.key;
      // Resuming inside a page: skip what the saved position already covers.
      if (state.previous !== undefined && compareKeys(state.previous, item.key) >= 0) continue;
      if (spent(budget)) {await save(); return false;}
      if (!boundedInteger(item.size,MAX_OBJECT_BYTES) || manifest.objects >= MAX_OBJECTS || manifest.mediaBytes + item.size > MAX_MEDIA_BYTES) throw new AppError('Le volume média dépasse les limites de cette sauvegarde.',409,'backup_too_large');
      const partial: Partial = state.partial?.key === item.key && state.partial.etag === item.etag ? state.partial : {key:item.key,size:item.size,etag:item.etag,offset:0,digests:[],httpMetadata:item.httpMetadata,customMetadata:item.customMetadata};
      state.partial = partial;
      while (partial.offset < partial.size) {
        if (spent(budget)) {await save(); return false;}
        const length = Math.min(PART_BYTES, partial.size - partial.offset);
        const object = await media.get(item.key,{onlyIf:{etagMatches:item.etag},range:{offset:partial.offset,length}});
        if (!object || !('body' in object)) throw new AppError('Les données ont changé pendant la sauvegarde.',409,'backup_changed');
        const part = await object.arrayBuffer();
        if (part.byteLength !== length) throw new AppError('Lecture partielle de sauvegarde incohérente.',409,'backup_changed');
        partial.digests.push(await digest(part));
        state.bytes += await putSegment(key,id,'object-' + manifest.objects + '-' + (partial.offset / PART_BYTES),new Uint8Array(part));
        partial.offset += length; budget.operations -= 2;
        if (partial.size > 8 * PART_BYTES && partial.digests.length % 8 === 0) await save();
      }
      // Even an empty object needs an ETag check (there are no ranges to read).
      if (item.size === 0) {const object = await media.get(item.key,{onlyIf:{etagMatches:item.etag}});budget.operations--;if (!object || !('body' in object)) throw new AppError('Les données ont changé pendant la sauvegarde.',409,'backup_changed');}
      const entry: ObjectEntry = {key:partial.key,size:partial.size,digests:partial.digests,httpMetadata:partial.httpMetadata,customMetadata:partial.customMetadata};
      validateObject(entry);
      const entryBytes = encoder.encode(JSON.stringify(entry)).byteLength + 1;
      if (entryBytes + 2 > MAX_MANIFEST_BYTES) throw new AppError('Métadonnées de sauvegarde trop volumineuses.',409,'backup_too_large');
      if (state.entries.length >= 100 || state.pageSize + entryBytes > MAX_MANIFEST_BYTES) await flush();
      state.entries.push(entry); state.pageSize += entryBytes; manifest.objects++; manifest.mediaBytes += partial.size;
      state.previous = item.key; state.partial = undefined;
    }
    if (page.truncated && (!page.cursor || page.cursor === state.cursor)) throw new AppError('Pagination de sauvegarde incohérente.',502,'backup_listing_invalid');
    if (!page.truncated) {await flush(); await save(); return true;}
    state.cursor = page.cursor; await save();
  }
}

async function commitBackup(key: CryptoKey, id: string, state: Progress, now: number) {
  const manifest = state.manifest;
  const encrypted=await encryptSegment(key,id,'manifest',encoder.encode(JSON.stringify(manifest))),stored=new Uint8Array(MAGIC.length+encrypted.byteLength);stored.set(MAGIC);stored.set(encrypted,MAGIC.length);
  const objectKey='braand-backups/'+id+'.bin',bucket=bindings().BACKUP_BUCKET!,options={onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}};
  let written=await bucket.put(objectKey,stored,options);
  if(!written){await bucket.delete(objectKey);written=await bucket.put(objectKey,stored,options);}
  if(!written)throw new AppError('La sauvegarde n’a pas été confirmée.',502,'backup_write_unknown');
  const bytes=state.bytes+stored.byteLength;
  await db().prepare("INSERT OR IGNORE INTO operations_backups(id,object_key,status,bytes,tables_count,rows_count,objects_count,created_at) VALUES (?,?,'completed',?,?,?,?,?)")
    .bind(id,objectKey,bytes,manifest.tables,manifest.rows,manifest.objects,now).run();
  return {id,bytes,tables:manifest.tables,rows:manifest.rows,objects:manifest.objects};
}

const progressRow = (id: string) => db().prepare('SELECT id,phase,state,attempts,created_at FROM operations_backup_progress WHERE id=?').bind(id).first<{id:string;phase:Phase;state:string;attempts:number;created_at:number}>();

/** Opens today's backup unless one is still in progress. Fast: the work happens in advanceBackup. */
export async function startBackup(now = Date.now()) {
  const readiness = backupReadiness();
  if (!readiness.ready) throw new AppError('La sauvegarde nécessite une configuration et une fenêtre de maintenance validées.',503,readiness.reason || 'backup_not_ready');
  await backupKey();
  await db().prepare(BACKUP_PROGRESS_SCHEMA).run();
  const active = await db().prepare("SELECT id,created_at FROM operations_backup_progress WHERE phase IN ('database','objects','commit') ORDER BY created_at DESC LIMIT 1").first<{id:string;created_at:number}>();
  if (active && now - active.created_at < STALLED_MS) return {id: active.id, status: 'in_progress'};
  // One completed backup per day: open the next one 20 hours after the last success.
  const recent = await db().prepare("SELECT id FROM operations_backups WHERE status='completed' AND created_at>? ORDER BY created_at DESC LIMIT 1").bind(now - 20 * 3600 * 1000).first<{id:string}>();
  if (recent && !active) return {id: recent.id, status: 'done_recently'};
  if (active) await db().prepare("UPDATE operations_backup_progress SET phase='failed',error_code='backup_stalled',lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").bind(now,active.id).run();
  const id = uid();
  await db().prepare("INSERT INTO operations_backup_progress(id,phase,state,created_at,updated_at) VALUES (?,'database','{}',?,?)").bind(id,now,now).run();
  return {id, status: 'started'};
}

/**
 * Advances the backup in progress within a time and storage-operation budget.
 * strict: errors are thrown (manual run and tests); otherwise a transient error
 * is retried on a later step and a lasting one marks the backup failed.
 */
export async function advanceBackup(now = Date.now(), options: {budgetMs?: number; operations?: number; strict?: boolean; id?: string} = {}) {
  await db().prepare(BACKUP_PROGRESS_SCHEMA).run();
  const target = options.id ? await progressRow(options.id) : await db().prepare("SELECT id,phase,state,attempts,created_at FROM operations_backup_progress WHERE phase IN ('database','objects','commit') ORDER BY created_at LIMIT 1").first<{id:string;phase:Phase;state:string;attempts:number;created_at:number}>();
  if (!target || !['database','objects','commit'].includes(target.phase)) return {status: 'idle' as const};
  const budgetMs = options.budgetMs ?? 45000, token = uid(), start = Date.now();
  // Every claimed step counts as an attempt until it reports progress, so a step
  // cut off by the platform (no error to catch) cannot be retried forever.
  const claim = await db().prepare('UPDATE operations_backup_progress SET lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND lease_until<=?').bind(token,start+budgetMs+120000,start,target.id,start).run();
  if (!claim.meta.changes) return {id: target.id, status: 'busy' as const};
  if (target.attempts >= MAX_ATTEMPTS) {
    await db().prepare("UPDATE operations_backup_progress SET phase='failed',error_code=COALESCE(error_code,'backup_step_interrupted'),lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").bind(Date.now(),target.id).run();
    await (await import('./operations')).raiseOperationalAlert('backup:' + target.id,'backup_failed',target.id,now).catch(() => undefined);
    return {id: target.id, status: 'failed' as const, errorCode: 'backup_step_interrupted'};
  }
  const id = target.id, budget: Budget = {deadline: start + budgetMs, operations: options.operations ?? 400};
  let phase: Phase = target.phase, state = JSON.parse(target.state || '{}') as Progress;
  const save = async () => {await db().prepare('UPDATE operations_backup_progress SET phase=?,state=?,updated_at=? WHERE id=? AND lease_token=?').bind(phase,JSON.stringify(state),Date.now(),id,token).run();};
  try {
    const key = await backupKey();
    if (phase === 'database') {
      const writer = new SegmentWriter(key, id), snapshot = await writeSnapshot(writer, id, target.created_at).catch(async error => {if (error instanceof AppError && error.code === 'backup_too_large') await writer.discard();throw error;});
      state = {manifest:{format:'braand-backup-v2',id,createdAt:target.created_at,databaseBytes:writer.total,databaseDigests:writer.digests,objectPages:0,objects:0,mediaBytes:0,tables:snapshot.tables,rows:snapshot.rows},bytes:writer.stored,entries:[],pageSize:2};
      phase = 'objects'; await save();
    }
    if (phase === 'objects') {
      if (!await copyObjects(key, id, state, budget, save)) {
        await db().prepare('UPDATE operations_backup_progress SET attempts=0,error_code=NULL,lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(id,token).run();
        return {id, status: 'in_progress' as const, phase, objects: state.manifest.objects};
      }
      phase = 'commit'; await save();
    }
    const result = await commitBackup(key, id, state, target.created_at);
    phase = 'completed';
    await db().prepare("UPDATE operations_backup_progress SET phase='completed',state='{}',error_code=NULL,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?").bind(Date.now(),id).run();
    return {...result, status: 'completed' as const};
  } catch (error) {
    const code = error instanceof AppError && error.code ? error.code : 'backup_step_failed';
    const attempts = target.attempts + 1, lasting = options.strict || FATAL.has(code) || attempts >= MAX_ATTEMPTS;
    // A transient error restarts the current object from the saved listing position.
    if (state.partial) state.partial = undefined;
    await db().prepare('UPDATE operations_backup_progress SET phase=?,state=?,attempts=?,error_code=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?').bind(lasting ? 'failed' : phase,JSON.stringify(state),attempts,code,Date.now(),id).run();
    if (options.strict) throw error;
    if (lasting) {await (await import('./operations')).raiseOperationalAlert('backup:' + id,'backup_failed',id,now).catch(() => undefined);return {id, status: 'failed' as const, errorCode: code};}
    return {id, status: 'retrying' as const, errorCode: code};
  }
}

/** Runs a whole backup now (manual run and tests): open, then advance until done. */
export async function createEncryptedBackup(now = Date.now()) {
  const readiness = backupReadiness();
  if (!readiness.ready) throw new AppError('La sauvegarde nécessite une configuration et une fenêtre de maintenance validées.',503,readiness.reason || 'backup_not_ready');
  await backupKey();
  await db().prepare(BACKUP_PROGRESS_SCHEMA).run();
  const id = uid();
  await db().prepare("INSERT INTO operations_backup_progress(id,phase,state,created_at,updated_at) VALUES (?,'database','{}',?,?)").bind(id,now,now).run();
  for (;;) {
    const step = await advanceBackup(now, {id, strict: true, budgetMs: 10 * 60 * 1000, operations: Number.MAX_SAFE_INTEGER});
    if (step.status === 'completed') return {id: step.id, bytes: step.bytes, tables: step.tables, rows: step.rows, objects: step.objects};
    if (step.status !== 'in_progress') throw new AppError('La sauvegarde n’a pas pu avancer.',409,'backup_busy');
  }
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
  // Rebuild only from restored primary data using this release's trusted SQL.
  // Preserve all archived business rows, including the migration marker.
  if(archive.tables.some(table=>table.name==='resources')&&archive.tables.some(table=>table.name==='platform_settings'))statements.push(...contextSchemaStatements.map(sql=>destination.prepare(sql)));
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
