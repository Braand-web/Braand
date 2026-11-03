// Compile reviewed Markdown into lazy, server-only modules. No network or scripts.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCommunity,SOURCES as COMMUNITY_SOURCES} from './import-community-skills.mjs';

const project=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const skills=path.join(project,'skills'),output=path.join(project,'lib','skills');
// Keep the pinned upstream snapshot untouched, but remove legacy product
// naming from the server-only content shipped to Braand users.
const legacyBrandTokens=new RegExp([['a','i','r','a'],['a','ï','r','a']].map(parts=>parts.join('')).join('|'),'giu');
const currentBrand=(value)=>value===value.toUpperCase()?'BRAAND':value[0]===value[0].toUpperCase()?'Braand':'braand';
// Do not compile locally edited prose under a pinned upstream attribution.
// These checks are offline and run only our source-verification code.
for(const script of ['import-marketing-skills.mjs','import-social-skills.mjs','import-design-skill.mjs']){
 execFileSync(process.execPath,[path.join(project,'scripts',script),'--verify'],{cwd:project,stdio:'pipe'});
}
const definitions=JSON.parse(await readFile(path.join(skills,'catalog.json'),'utf8'));
const marketingManifest=JSON.parse(await readFile(path.join(skills,'vendor','marketing','manifest.json'),'utf8'));
const socialManifest=JSON.parse(await readFile(path.join(skills,'vendor','social','manifest.json'),'utf8'));
const designManifest=JSON.parse(await readFile(path.join(skills,'vendor','anthropic','frontend-design','manifest.json'),'utf8'));
const userManifests=new Map(await Promise.all(['social-media-manager','video-motion-studio'].map(async id=>['user/'+id,JSON.parse(await readFile(path.join(skills,'user',id,'manifest.json'),'utf8'))])));
const adaptedManifest=JSON.parse(await readFile(path.join(skills,"user-adapted","manifest.json"),"utf8"));
const generated=new Map();const index=[];const ids=new Set();
const packs=JSON.parse(await readFile(path.join(skills,'packs','manifest.json'),'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const {digest:packDigest,...packBody}=packs;
if(createHash('sha256').update(JSON.stringify(canonical(packBody))).digest('hex')!==packDigest)throw Error('Skill pack manifest changed without import');
if(packs.entries.length>400||packs.objects.length>2000)throw Error('Skill pack bounds exceeded');
const objectIds=new Set();
for(const object of packs.objects){
 if(!/^[a-f0-9]{64}$/.test(object.sha256)||objectIds.has(object.sha256)||object.key!=='skills/packs/v1/'+object.sha256)throw Error('Duplicate or invalid skill object');
 objectIds.add(object.sha256);
 const file=path.resolve(project,object.path);if(!file.startsWith(skills+path.sep))throw Error('Skill object outside skills');
 for(let current=file;current!==project;current=path.dirname(current))if((await lstat(current)).isSymbolicLink())throw Error('Skill object symlink forbidden');
 const bytes=await readFile(file);if(bytes.length!==object.bytes||bytes.length>8*1024*1024||createHash('sha256').update(bytes).digest('hex')!==object.sha256)throw Error('Skill object integrity failed: '+object.sha256);
}
if(packs.privateContext.some(file=>objectIds.has(file.sha256)))throw Error('Private context must never enter shared skills');
const packedById=new Map();
for(const entry of packs.entries){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)||entry.id.length>64||packedById.has(entry.id)||!entry.title||entry.title.length>160||!entry.description||entry.description.length>1200)throw Error('Invalid packed skill metadata');
 packedById.set(entry.id,entry);
 for(const [reference,file]of Object.entries(entry.files))if(reference.length>240||reference.startsWith('/')||reference.split('/').includes('..')||reference.includes('\\')||!objectIds.has(file.sha256)||file.bytes!==packs.objects.find(object=>object.sha256===file.sha256).bytes)throw Error('Invalid packed reference');
 if(!entry.augment&&!entry.files['SKILL.md'])throw Error('Missing packed skill entry');
 generated.set(path.join(output,'pack-content',entry.id+'.generated.mjs'),'// Generated manifest members only; payloads remain in private R2.\nimport {loadPackedReference} from "../pack-storage.mjs";\nexport const files = '+JSON.stringify(entry.files,null,2)+';\nexport const load = (reference,storage) => loadPackedReference('+JSON.stringify(entry.id)+',files,reference,storage);\n');
}

for(const definition of definitions){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id)||ids.has(definition.id))throw Error('Invalid or duplicate skill identifier');
 ids.add(definition.id);
 const directory=path.resolve(skills,definition.directory);
 if(!directory.startsWith(skills+path.sep))throw Error('Skill outside approved directory');
 for(let current=directory;current!==project;current=path.dirname(current)){
  if((await lstat(current)).isSymbolicLink())throw Error('Skill directory symlinks forbidden');
 }
 const original=definition.license==='Braand-original';
 const adapted=definition.directory.startsWith('user-adapted/')&&definition.license==='User-provided-adapted';
 const marketing=definition.directory.startsWith('vendor/marketing/');
 const social=definition.directory.startsWith('vendor/social/');
 const design=definition.directory==='vendor/anthropic/frontend-design';
 const user=userManifests.has(definition.directory)&&definition.license==='User-provided';
 if(!original&&!adapted&&!marketing&&!social&&!design&&!user)throw Error('Unknown vendored skill source');
 if((marketing||social)&&definition.license!=='MIT'||design&&definition.license!=='Apache-2.0')throw Error('Skill license disagrees with pinned source');
 const manifest=adapted?adaptedManifest:marketing?marketingManifest:social?socialManifest:user?userManifests.get(definition.directory):designManifest;
 const sourcePrefix=adapted?path.relative(path.join(skills,"user-adapted"),directory).split(path.sep).join("/")+"/":marketing||social?path.relative(path.join(skills,'vendor',marketing?'marketing':'social'),directory).split(path.sep).join('/')+'/':'';
 const expectedFiles=original?null:new Map(manifest.files.map(file=>[file.path,file]));
 const entries={};
 async function collect(folder,inReferences=false){for(const item of await readdir(folder,{withFileTypes:true})){
  if(item.isSymbolicLink())throw Error('Skill symlinks forbidden');
  const full=path.join(folder,item.name);
  if(item.isDirectory()){if(inReferences||item.name==='references'||user&&item.name==='assets')await collect(full,true);continue;}
  if(!item.isFile()||!item.name.endsWith('.md')&&!(user&&item.name.endsWith('.json')))continue;
  const relative=path.relative(directory,full).split(path.sep).join('/');
  if(relative!=='SKILL.md'&&!relative.startsWith('references/')&&!(user&&relative.startsWith('assets/')))continue;
  const bytes=await readFile(full);
  if(bytes.length>64000)throw Error('Skill file exceeds reviewed size');
  if(expectedFiles){
   const expected=expectedFiles.get(sourcePrefix+relative);
   if(!expected||bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Unreviewed vendored content: '+relative);
  }
  const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(original&&content.includes('\r'))throw Error('Original skill must use stable LF line endings');
  entries[relative]=content.replace(legacyBrandTokens,currentBrand);
 }}
 await collect(directory);if(!entries['SKILL.md'])throw Error('Missing SKILL.md: '+definition.id);
 if(adapted){const pinned=manifest.files.filter(file=>file.path.startsWith(sourcePrefix)).map(file=>file.path.slice(sourcePrefix.length));if(pinned.length!==Object.keys(entries).length||pinned.some(file=>!Object.hasOwn(entries,file))||path.basename(directory)!==definition.id||!entries['SKILL.md'].startsWith('---\nname: '+definition.id+'\n'))throw Error('Invalid reviewed adapted content: '+definition.id);}
 if(definition.id==='video-motion-studio'){
  const adaptation=await readFile(path.join(skills,'integrations','video-motion-studio.md'),'utf8');
  entries['SKILL.md']=adaptation+'\n\n'+entries['SKILL.md'];
 }
 if(original&&(!definition.directory.startsWith('braand/')||path.basename(directory)!==definition.id||!entries['SKILL.md'].startsWith('---\nname: '+definition.id+'\n')))throw Error('Original skill directory and name must match');
 const ordered=Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b,'en')));
 const provenance=manifest.source??manifest;
 const originalVersion=definition.version??'1.0.0';
 if(original&&(typeof originalVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(originalVersion)))throw Error('Invalid original method version');
 const source=original?{origin:'Braand',revision:originalVersion}:{origin:provenance.repository,revision:provenance.commit};
 const version=adapted?adaptedManifest.version:original?originalVersion:source.revision.slice(0,12);
 const references=Object.keys(ordered).filter(file=>file!=='SKILL.md');
 const metadata={id:definition.id,title:definition.title,description:definition.description,category:definition.category,license:definition.license,capability:definition.capability,version,source,references,digest:createHash('sha256').update(JSON.stringify(ordered)).digest('hex')};
 generated.set(path.join(output,'content',definition.id+'.generated.mjs'),'// Generated by scripts/build-skill-catalog.mjs. Reviewed source only.\nconst content = '+JSON.stringify(ordered,null,2)+';\nexport default content;\n');
 const packed=packedById.get(definition.id);
 if(packed&&!packed.augment)throw Error('Duplicate installed skill: '+definition.id);
 if(packed){
  const packReferences=Object.keys(packed.files);
  if(packReferences.some(reference=>metadata.references.includes(reference)))throw Error('Packed reference shadows an installed file');
  metadata.references=[...metadata.references,...packReferences];
  index.push('  {...'+JSON.stringify({...metadata,packReferences,packRevision:packDigest})+', load: (reference="SKILL.md",storage) => '+JSON.stringify(packReferences)+'.includes(reference) ? import("./pack-content/'+definition.id+'.generated.mjs").then(module => module.load(reference,storage)) : import("./content/'+definition.id+'.generated.mjs").then(module => module.default), packFiles: () => import("./pack-content/'+definition.id+'.generated.mjs").then(module => module.files)}');
 }else index.push('  {...'+JSON.stringify(metadata)+', load: () => import("./content/'+definition.id+'.generated.mjs").then(module => module.default)}');
}
for(const entry of packs.entries.filter(entry=>!entry.augment)){
 if(ids.has(entry.id))throw Error('Duplicate packed skill');ids.add(entry.id);
 const references=Object.keys(entry.files).filter(reference=>reference!=='SKILL.md');
 const metadata={id:entry.id,title:entry.title,description:entry.description,category:entry.category,license:'User-provided',capability:entry.capability,version:'1.0.0+'+packDigest.slice(0,12),source:{origin:'User-provided skill packs',revision:packDigest},references,digest:createHash('sha256').update(JSON.stringify(entry.files)).digest('hex'),packReferences:Object.keys(entry.files),packRevision:packDigest};
 index.push('  {...'+JSON.stringify(metadata)+', load: (reference="SKILL.md",storage) => import("./pack-content/'+entry.id+'.generated.mjs").then(module => module.load(reference,storage)), packFiles: () => import("./pack-content/'+entry.id+'.generated.mjs").then(module => module.files)}');
}
for(const entry of packs.entries.filter(entry=>entry.augment))if(!ids.has(entry.id))throw Error('Cannot augment an unknown skill');
// Reviewed community skills: pinned commits, Markdown only, hash-verified.
const community=await verifyCommunity(),communitySources=new Map(COMMUNITY_SOURCES.map(source=>[source.key,source]));
for(const skill of community.skills){
 if(ids.has(skill.id))throw Error('Duplicate community skill: '+skill.id);ids.add(skill.id);
 const source=communitySources.get(skill.source);if(!source)throw Error('Unknown community source: '+skill.source);
 const ordered={};
 for(const rel of Object.keys(skill.files).sort((a,b)=>a.localeCompare(b,'en'))){const bytes=await readFile(path.join(skills,'vendor','community',skill.source,skill.id,rel));ordered[rel]=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 const metadata={id:skill.id,title:skill.title,description:skill.description,category:skill.category,license:source.license,capability:skill.capability,version:source.commit.slice(0,12),source:{origin:'https://github.com/'+source.repository,revision:source.commit},references:Object.keys(ordered).filter(file=>file!=='SKILL.md'),digest:createHash('sha256').update(JSON.stringify(ordered)).digest('hex'),community:true};
 generated.set(path.join(output,'content',skill.id+'.generated.mjs'),'// Generated by scripts/build-skill-catalog.mjs. Reviewed community source only.\nconst content = '+JSON.stringify(ordered,null,2)+';\nexport default content;\n');
 index.push('  {...'+JSON.stringify(metadata)+', load: () => import("./content/'+skill.id+'.generated.mjs").then(module => module.default)}');
}
generated.set(path.join(output,'catalog.generated.mjs'),'// Generated by scripts/build-skill-catalog.mjs. Server only; no client imports.\nexport const SKILL_CATALOG = [\n'+index.join(',\n')+'\n];\n');
if(process.argv.includes('--check')){
 for(const [file,content]of generated)if(await readFile(file,'utf8')!==content)throw Error('Stale generated skill: '+path.relative(project,file));
 console.log('Reviewed skill catalog is current.');
}else{
 for(const [file,content]of generated){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);}
 console.log('Compiled '+index.length+' reviewed skills with lazy content.');
}
