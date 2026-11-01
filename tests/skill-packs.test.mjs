import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SKILL_CATALOG} from '../lib/skills/catalog.generated.mjs';
import {createSkillSession,readSkill,searchSkills,skillPackFiles} from '../lib/skills/registry.ts';
import {packedAsset,PACK_PREFIX} from '../lib/skills/pack-storage.mjs';
import {packAssetResponse} from '../lib/skills/pack-response.mjs';

const root=new URL('../',import.meta.url),manifest=JSON.parse(readFileSync(new URL('skills/packs/manifest.json',root),'utf8'));
const objects=new Map(manifest.objects.map(file=>[PACK_PREFIX+file.sha256,file]));
const buffer=file=>readFileSync(new URL(file.path,root));
const storage={async get(key){const file=objects.get(key);assert.ok(file,'Only content-addressed manifest objects are accessible');const bytes=buffer(file);return {size:bytes.length,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};}};

test('all supplied sources are represented once, including nested .skill archives, scripts, fonts and prompts',()=>{
 assert.equal(manifest.sources.length,18);
 assert.equal(manifest.counts.skills,123);assert.equal(manifest.counts.newEntries,124);assert.equal(manifest.counts.augmentedEntries,1);
 assert.equal(SKILL_CATALOG.length,166);assert.equal(new Set(SKILL_CATALOG.map(entry=>entry.id)).size,166);
 assert.equal(manifest.sources.find(file=>file.name==='Codex-Skills-Cloud.zip').sha256,manifest.sources.find(file=>file.name==='Codex-Skills-Cloud (1).zip').sha256);
 assert.equal(new Set(manifest.objects.map(file=>file.sha256)).size,manifest.objects.length);
 for(const file of manifest.objects){const bytes=buffer(file);assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 for(const file of manifest.coverage)assert.ok(objects.has(PACK_PREFIX+file.sha256),'Every supplied shared file is retained');
 assert.ok(manifest.coverage.some(file=>file.path.includes('.skill!/')));
 for(const ending of ['.py','.ttf','.md','.json'])assert.ok(manifest.coverage.some(file=>file.path.endsWith(ending)));
 assert.equal(manifest.coverage.filter(file=>file.path.includes('02-fichiers-de-contexte')).length,0);
 assert.equal(manifest.privateContext.length,5);for(const file of manifest.privateContext)assert.equal(objects.has(PACK_PREFIX+file.sha256),false);
 for(const id of ['reels-viraux-motion-design','totp-login-handoff','prescription-refill','use-railway','create-pet','inventaire-outils-fournis','braand-instructions-importees'])assert.ok(SKILL_CATALOG.some(entry=>entry.id===id),'No utility-based selection');
});

test('all packed methods can be selected and read progressively through the actual registry without any external call',async()=>{
 for(const entry of manifest.entries){
  assert.equal(searchSkills({semanticIds:[entry.id]}).skills[0].id,entry.id);
  const session=createSkillSession(),reference=entry.augment?Object.keys(entry.files).find(path=>path.endsWith('/SKILL.md')):'SKILL.md';
  if(entry.augment)await readSkill({id:entry.id},session);
  const result=await readSkill({id:entry.id,reference},session,storage);
  assert.ok(result.chars>0);assert.equal(result.provenance.origin,'User-provided skill packs');
  if(!entry.augment){assert.match(result.content,/Braand/);assert.ok(result.references.some(path=>path.startsWith('imports/')||path.startsWith('sources/')));}
 }
});

test('same named versions enrich one existing method; supplied scripts and assets are inert allowlisted resources',async()=>{
 const frontend=SKILL_CATALOG.filter(entry=>entry.id==='frontend-design');assert.equal(frontend.length,1);
 const entry=manifest.entries.find(entry=>entry.id==='skill-creator');assert.equal(entry.variants.length,2);
 const session=createSkillSession();await readSkill({id:entry.id},session,storage);
 const script=Object.keys(entry.files).find(reference=>reference.endsWith('.py'));assert.ok(script);
 await assert.rejects(()=>readSkill({id:entry.id,reference:script},createSkillSession(),storage),error=>error.code==='skill_entry_required');
 const source=await readSkill({id:entry.id,reference:script},session,storage);assert.ok(source.content.length>0);
 const files=await skillPackFiles(entry.id);assert.equal(files[script].sha256,entry.files[script].sha256);
 for(const path of ['../system_prompt.md','/etc/passwd','imports/not-allowed.py','__proto__'])await assert.rejects(()=>packedAsset(files,path,storage),error=>error.code==='skill_not_found');
});

test('standalone aliases and copied kits retain one method and link the complete motion and browser resources',async()=>{
 for(const [a,b]of [['kit-agent-video-motion.zip','kit-agent-video-motion (1).zip'],['SKILL.md','SKILL (1).md'],['SKILL (2).md','SKILL (3).md']])assert.equal(manifest.sources.find(source=>source.name===a).sha256,manifest.sources.find(source=>source.name===b).sha256);
 for(const id of ['artifact-creation','montage-video-complet'])assert.equal(SKILL_CATALOG.filter(entry=>entry.id===id).length,1);
 const montage=manifest.entries.find(entry=>entry.id==='montage-video-complet');assert.equal(montage.variants.length,1);
 for(const filename of ['moteur-monolithe.py','moteur-reels-spec-json.py','post-niveaux-audio.py'])assert.ok(Object.keys(montage.files).some(path=>path.endsWith('/'+filename)));
 assert.ok(Object.keys(manifest.entries.find(entry=>entry.id==='computer-use').files).some(path=>path.endsWith('/session-service.ts')));
 const artifact=manifest.entries.find(entry=>entry.id==='artifact-creation');assert.equal(artifact.variants.length,1);assert.ok(manifest.coverage.some(file=>file.providedPath==='SKILL.md'));assert.ok(manifest.coverage.some(file=>file.providedPath==='SKILL (1).md'));
 const session=createSkillSession(),method=await readSkill({id:'montage-video-complet'},session,storage);assert.match(method.content,/Opus 5\.5/);
});

test('storage reads verify hashes, sizes and availability; never substitute another object after an integrity failure',async()=>{
 const entry=manifest.entries.find(entry=>!entry.augment),files=entry.files;
 await assert.rejects(()=>packedAsset(files,'SKILL.md'),error=>error.code==='skill_storage_unavailable');
 await assert.rejects(()=>packedAsset(files,'SKILL.md',{async get(){return null;}}),error=>error.code==='skill_content_unavailable');
 const file=files['SKILL.md'];let reads=0;
 await assert.rejects(()=>packedAsset(files,'SKILL.md',{async get(){reads++;return {size:file.bytes,async arrayBuffer(){return new Uint8Array(file.bytes).buffer;}};}}),error=>error.code==='skill_content_invalid');assert.equal(reads,1);
});

test('binary resources produce private attachment receipts and downloads cannot execute imported HTML or JavaScript',async()=>{
 const entry=manifest.entries.find(entry=>Object.values(entry.files).some(file=>!file.text)),reference=Object.keys(entry.files).find(path=>!entry.files[path].text);
 const session=createSkillSession();if(entry.augment)await readSkill({id:entry.id},session);else await readSkill({id:entry.id},session,storage);
 const result=await readSkill({id:entry.id,reference},session,storage);assert.match(result.content,/Téléchargement privé/);assert.match(result.content,/ne signifie pas/);
 const response=await packAssetResponse(entry.files,reference,storage);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('content-security-policy'),/sandbox/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal((await response.arrayBuffer()).byteLength,entry.files[reference].bytes);
});
