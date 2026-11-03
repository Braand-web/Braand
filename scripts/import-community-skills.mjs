#!/usr/bin/env node
/**
 * Pin reviewed community Agent Skills as inert Markdown.
 *
 *   node scripts/import-community-skills.mjs --import --source-dir <clones>
 *   node scripts/import-community-skills.mjs --verify
 *
 * --source-dir holds shallow clones named owner_repo, checked out at the pinned
 * commits below. Only SKILL.md and Markdown references inside each selected
 * skill directory are copied (64 KB max each); scripts, binaries, packages and
 * "legacy" folders are never copied or executed. The 2026-11-03 review scanned
 * every selected file (scripts included) for remote shell pipes, encoded
 * payloads, credential paths, webhook exfiltration, install hooks, prompt
 * injection phrases and hidden Unicode; no malicious content was found.
 * Excluded: remotion-dev/skills (no licence; Remotion requires a company
 * licence), cursor/plugins (Cursor IDE only) and Blender packs (no Blender
 * runtime in Braand).
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const TARGET=path.join(ROOT,'skills','vendor','community');
const MAX_FILE=64_000;
export const SOURCES=Object.freeze([
 {key:'mattpocock',repository:'mattpocock/skills',commit:'4ae2317ddb22b046e26455e4f9c9b3aaaf62212d',license:'MIT',skills:['skills/**']},
 {key:'superpowers',repository:'obra/superpowers',commit:'2ce8aa15d05bd57213e6f746f953aafb7ded7a8b',license:'MIT',skills:['skills/*']},
 {key:'marketing',repository:'coreyhaines31/marketingskills',commit:'88c79f6528a9347420e57ceb1fff9a60de651768',license:'MIT',skills:['skills/*']},
 {key:'uiux',repository:'nextlevelbuilder/ui-ux-pro-max-skill',commit:'713eef51b04efc98d6fa565323b495f7c9c89fd4',license:'MIT',skills:['.claude/skills/ui-ux-pro-max']},
 {key:'agentbrowser',repository:'vercel-labs/agent-browser',commit:'2d1271baefa026161de333a0da55c0f9e118a07f',license:'Apache-2.0',skills:['skills/agent-browser']},
 {key:'hyperframes',repository:'heygen-com/hyperframes',commit:'47dddedd6cd1dea646c5ae53d40bb5821f45590f',license:'Apache-2.0',skills:['skills/hyperframes','skills/hyperframes-cli','skills/media-use']},
 {key:'designedbyai',repository:'designed-by-ai/skills',commit:'03c20aec6dcedb5fabfb03dc37982eb52ef19ed6',license:'MIT',skills:['skills/design-mobile-apps']},
 {key:'skills101',repository:'101-skills/superpowers',commit:'becc25649700d5457772a00e5143e28ccf9e5afa',license:'MIT',skills:['tools/video/ai-video-generation','tools/image/ai-image-generation','tools/social/twitter-automation','tools/video/ai-avatar-video']},
 {key:'vercelskills',repository:'vercel-labs/skills',commit:'7a5e920bead4b1039a6d6df5d7e1163b7b09423a',license:'MIT',skills:['skills/find-skills']},
 {key:'uizze',repository:'uizze/uizze',commit:'fc401e9e654cbafe427b0c98142fc8bccd0c4e7e',license:'MIT',skills:['skills/image-to-ui']},
 {key:'lottie',repository:'LottieFiles/motion-design-skill',commit:'f9a8a041b85185ee4881b3471d3415e939aac772',license:'MIT',skills:['skills/motion-design']},
 {key:'gsap',repository:'greensock/gsap-skills',commit:'aed9cfd3277740755f6bfc1155c7aa645403b760',license:'MIT',skills:['skills/*']},
 {key:'claudemotion',repository:'whaleyxbt/claude-motion',commit:'e627941543d9988b155dc610bb9cc0115a5e365e',license:'MIT',skills:['.claude/skills/*']},
 {key:'motiondesign',repository:'howseen-ai/claude-motion-design',commit:'3d90d349ef3fdde9b7e89de4df4a2159c9e8697f',license:'MIT',skills:['skill/motion-design']},
 {key:'launchmotion',repository:'AbubakrChan/product-launch-motion',commit:'edbfb105382f21507bad895d8b5f6e0faa67487c',license:'MIT',skills:['.']},
 {key:'motiongraphics',repository:'Mort1d/motion-graphics-skills',commit:'7f0c3714dc81bea52644a5287c6350345009e579',license:'MIT',skills:['skills/motion-graphics']},
]);
const SKIP_DIRS=new Set(['.git','node_modules','legacy','dist','build','.github','scripts','assets','examples','tests','test']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const slug=value=>value.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);

export function frontmatter(text){
 const head=text.startsWith('---')?text.split('---',3)[1]||'':'';
 const field=name=>{const match=head.match(new RegExp('^'+name+':\\s*(.*)$','m'));if(!match)return '';let value=match[1].trim();if(['>','|','>-','|-'].includes(value)){const lines=head.slice(head.indexOf(match[0])+match[0].length).split('\n').slice(1);const block=[];for(const line of lines){if(/^\S/.test(line))break;block.push(line.trim());}value=block.join(' ').trim();}return value.replace(/^["']|["']$/g,'');};
 return {name:field('name'),description:field('description')};
}
export function classify(id,text){
 const value=(id+' '+text.slice(0,600)).toLowerCase();
 if(/motion|gsap|lottie|hyperframe|animation|video|avatar|launch|sound-design|web-sims|media-use/.test(value))return {category:'creative',capability:/video|avatar|image-generation/.test(id)?'media_proposal':'text_draft'};
 if(/ui-ux|design-mobile|image-to-ui|frontend|design/.test(id))return {category:'creative',capability:'text_and_page_draft'};
 if(/image/.test(id))return {category:'creative',capability:'media_proposal'};
 if(/seo|ads|ad-|campaign|marketing|copy|email|social|twitter|launch|pricing|cro|growth|referral|brand|content|sales|lead|churn|onboarding|paywall|popup|signup|offer|influenc|pr$|public-relations|events|community|competitor|customer|analytics|attribution|tracking|revops|prospect|aso|sms|schema|link|directory|free-tool|video/.test(id))return {category:'marketing',capability:/ads|campaign/.test(id)?'campaign_plan':/analytics|attribution|tracking|research|audit/.test(id)?'provided_data_analysis':'text_draft'};
 if(/browser/.test(id))return {category:'operations',capability:'browser_mandate'};
 if(/research/.test(id))return {category:'operations',capability:'research'};
 return {category:'operations',capability:'text_draft'};
}

async function markdownFiles(directory,base=directory){
 const files=[];
 for(const item of await readdir(directory,{withFileTypes:true})){
  if(item.isSymbolicLink())continue;
  const full=path.join(directory,item.name);
  if(item.isDirectory()){if(!SKIP_DIRS.has(item.name)&&!item.name.startsWith('.'))files.push(...await markdownFiles(full,base));continue;}
  if(item.isFile()&&item.name.toLowerCase().endsWith('.md')&&!/^(changelog|contributing|code_of_conduct|security)\.md$/i.test(item.name)&&(await lstat(full)).size<=MAX_FILE)files.push(path.relative(base,full).split(path.sep).join('/'));
 }
 return files.sort();
}
async function skillDirectories(repoDir,pattern){
 if(pattern==='.')return [repoDir];
 if(pattern.endsWith('/**')){const base=path.join(repoDir,pattern.slice(0,-3)),found=[];const walk=async dir=>{const entries=await readdir(dir,{withFileTypes:true});if(entries.some(e=>e.isFile()&&e.name==='SKILL.md')){found.push(dir);return;}for(const e of entries)if(e.isDirectory()&&!SKIP_DIRS.has(e.name)&&!e.isSymbolicLink())await walk(path.join(dir,e.name));};await walk(base);return found.sort();}
 if(pattern.endsWith('/*')){const base=path.join(repoDir,pattern.slice(0,-2));return (await readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>path.join(base,e.name)).sort();}
 return [path.join(repoDir,pattern)];
}

async function importAll(sourceDir){
 const existing=new Set(JSON.parse(await readFile(path.join(ROOT,'skills','catalog.json'),'utf8')).map(e=>e.id));
 for(const entry of JSON.parse(await readFile(path.join(ROOT,'skills','packs','manifest.json'),'utf8')).entries)existing.add(entry.id);
 await rm(TARGET,{recursive:true,force:true});
 const skills=[],ids=new Set(),skipped=[];
 for(const source of SOURCES){
  const repoDir=path.join(sourceDir,source.repository.replace('/','_'));
  const head=execFileSync('git',['-C',repoDir,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(head!==source.commit)throw Error(`${source.repository} is at ${head}, expected pinned ${source.commit}`);
  for(const pattern of source.skills)for(const dir of await skillDirectories(repoDir,pattern)){
   const skillFile=path.join(dir,'SKILL.md');
   try{await lstat(skillFile);}catch{continue;}
   const text=await readFile(skillFile,'utf8'),meta=frontmatter(text);
   const base=slug(meta.name||path.basename(dir));
   if(!base)throw Error('Skill without a usable name: '+skillFile);
   if(existing.has(base)){skipped.push({id:base,source:source.repository,reason:'already installed'});continue;}
   let id=base;if(ids.has(id))id=slug(source.key+'-'+base);
   if(ids.has(id))throw Error('Duplicate community skill id: '+id);ids.add(id);
   const relativeDir=path.relative(repoDir,dir).split(path.sep).join('/')||'.';
   const files={};
   for(const rel of await markdownFiles(dir)){const bytes=await readFile(path.join(dir,rel));if(bytes.includes(0))continue;const destination=path.join(TARGET,source.key,id,rel);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);files[rel]={sha256:sha(bytes),bytes:bytes.length};}
   if(!files['SKILL.md'])throw Error('SKILL.md not retained: '+skillFile);
   const {category,capability}=classify(id,meta.description||text);
   skills.push({id,name:meta.name||base,title:(meta.name||base).replace(/[-_]+/g,' ').replace(/^\w/,c=>c.toUpperCase()),description:(meta.description||'Community method '+base).replace(/\s+/g,' ').slice(0,1000),category,capability,source:source.key,directory:source.key+'/'+id,upstreamPath:relativeDir,files});
  }
 }
 const manifest={schemaVersion:1,reviewedAt:'2026-11-03',sources:SOURCES.map(({key,repository,commit,license})=>({key,repository,commit,license,commitUrl:`https://github.com/${repository}/commit/${commit}`})),skipped,skills:skills.sort((a,b)=>a.id.localeCompare(b.id,'en'))};
 await mkdir(TARGET,{recursive:true});
 await writeFile(path.join(TARGET,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');
 console.log(JSON.stringify({skills:skills.length,skipped:skipped.length,files:skills.reduce((n,s)=>n+Object.keys(s.files).length,0),bytes:skills.reduce((n,s)=>n+Object.values(s.files).reduce((m,f)=>m+f.bytes,0),0)}));
}

export async function verifyCommunity(){
 const manifest=JSON.parse(await readFile(path.join(TARGET,'manifest.json'),'utf8'));
 const keys=new Set(SOURCES.map(s=>s.key));
 for(const skill of manifest.skills){
  if(!keys.has(skill.source)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id))throw Error('Unknown community skill source or id: '+skill.id);
  for(const [rel,file]of Object.entries(skill.files)){
   if(rel.startsWith('/')||rel.split('/').includes('..'))throw Error('Unsafe community path');
   const full=path.join(TARGET,skill.source,skill.id,rel);if((await lstat(full)).isSymbolicLink())throw Error('Community symlink forbidden');
   const bytes=await readFile(full);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Unreviewed community content: '+skill.id+'/'+rel);
  }
 }
 return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--import')){const index=process.argv.indexOf('--source-dir');if(index<0||!process.argv[index+1])throw Error('--source-dir is required');await importAll(path.resolve(process.argv[index+1]));}
 else if(process.argv.includes('--verify')){const manifest=await verifyCommunity();console.log('Verified '+manifest.skills.length+' community skills.');}
 else throw Error('Use --import --source-dir <dir> or --verify');
}
