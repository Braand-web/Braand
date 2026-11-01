import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createSkillSession,searchSkills,readSkill,skillDiscoveryContext,publicSkillResult,reviewedSkillMetadata} from '../lib/skills/registry.ts';
import {reviewedSkillCatalogSchema} from '../lib/skill-metadata.ts';
import {SKILL_POLICY} from '../lib/skills/policy.mjs';

test('reviewed sources and generated lazy catalog reproduce the pinned local bytes',()=>{
 for(const [file,args]of [['import-marketing-skills.mjs',['--verify']],['import-social-skills.mjs',['--verify']],['import-design-skill.mjs',['--verify']],['build-skill-catalog.mjs',['--check']]])execFileSync(process.execPath,['scripts/'+file,...args],{cwd:new URL('../',import.meta.url),stdio:'pipe'});
});
test('discovery is bounded metadata and actual method text is loaded only on explicit read',async()=>{
 const result=searchSkills({query:'rédaction vente'});assert.ok(result.skills.some(skill=>skill.id==='copywriting'));assert.ok(result.skills.length<=SKILL_POLICY.maxSearchResults);assert.equal('content' in result.skills[0],false);
 const discovery=skillDiscoveryContext();assert.ok(discovery.includes('braand-xlsx'));assert.ok(!discovery.includes('Three-Question Gate'));assert.ok(!discovery.includes('frontend-design/SKILL.md'));
 const session=createSkillSession();assert.equal(session.calls,0);const loaded=await readSkill({id:'copywriting'},session);assert.ok(loaded.content.includes('# Copywriting'));assert.equal(session.calls,1);assert.equal(session.chars,loaded.content.length);assert.equal(loaded.provenance.license,'MIT');
});
test('long methods can be reconstructed with explicit bounded chunks without lost characters',async()=>{
 const session=createSkillSession();let offset=0,parts=[],first;
 do{const result=await readSkill({id:'ad-creative',offset},session);first??=result;parts.push(result.content);assert.ok(result.chars<=SKILL_POLICY.maxReadChars);if(result.nextOffset===null){assert.equal(parts.join('').length,result.totalChars);break;}assert.equal(result.truncated,true);assert.ok(result.nextOffset>offset);offset=result.nextOffset;}while(parts.length<SKILL_POLICY.maxReadCalls);
 assert.equal(first.truncated,true);assert.ok(parts.join('').includes('# Ad Creative'));assert.ok(session.chars<=SKILL_POLICY.maxRunChars);
});
test('references are an exact reviewed allowlist and must follow the skill entry',async()=>{
 for(const input of [{id:'../../secret'},{id:'copywriting',reference:'../LICENSE'},{id:'copywriting',reference:'https://outside.invalid/secret'},{id:'unknown'},{id:'copywriting',offset:-1},{id:'copywriting',offset:1e9}])await assert.rejects(()=>readSkill(input,createSkillSession()));
 const session=createSkillSession();const entry=await readSkill({id:'copywriting'},session);assert.ok(entry.references.length>0);
 await assert.rejects(()=>readSkill({id:'copywriting',reference:entry.references[0]},createSkillSession()),error=>error.code==='skill_entry_required');
 const reference=await readSkill({id:'copywriting',reference:entry.references[0]},session);assert.ok(reference.content.length>0);assert.equal(reference.reference,entry.references[0]);
});
test('parallel reads cannot exceed distinct-skill or aggregate character budgets',async()=>{
 const session=createSkillSession();const ids=['copywriting','ads','cro','social','seo-audit','analytics','ad-creative'];
 const results=await Promise.allSettled(ids.map(id=>readSkill({id},session)));assert.ok(results.some(result=>result.status==='rejected'));assert.ok(session.selected.size<=SKILL_POLICY.maxDistinctSkills);assert.ok(session.chars<=SKILL_POLICY.maxRunChars);assert.ok(session.calls<=SKILL_POLICY.maxReadCalls);
 const bounded=createSkillSession();bounded.chars=SKILL_POLICY.maxRunChars-40;const result=await readSkill({id:'braand-pdf'},bounded);assert.ok(result.chars<=40);assert.ok(result.truncated);assert.ok(bounded.chars<=SKILL_POLICY.maxRunChars);
 const fresh=createSkillSession();assert.equal(fresh.chars,0);assert.equal(fresh.selected.size,0);
});
test('browser events contain progress metadata, never imported prose or source infrastructure',async()=>{
 const result=await readSkill({id:'copywriting'},createSkillSession());const publicResult=publicSkillResult('read_skill',result);assert.equal(publicResult.id,result.id);assert.equal('content' in publicResult,false);assert.equal('provenance' in publicResult,false);assert.equal('references' in publicResult,false);assert.equal(JSON.stringify(publicResult).includes('coreyhaines31'),false);assert.deepEqual(publicSkillResult('search_skills',searchSkills({query:'conversion'})),{status:'methods_found',total:searchSkills({query:'conversion'}).total});
});
test('document originals are readable and declare content-only execution capabilities',async()=>{
 for(const id of ['braand-docx','braand-pdf','braand-pptx','braand-xlsx']){const method=await readSkill({id},createSkillSession());assert.equal(method.capability,'document_content_only');assert.equal(method.provenance.origin,'Braand');assert.equal(method.version,id==='braand-xlsx'?'1.2.0':'1.1.0');assert.ok(method.references.includes('references/controles.md'));}
});

test('software methods are selected by the model across languages with bounded progressive evidence guidance',async()=>{
 const id='braand-software-delivery';
 for(const query of ['Fix the build and verify deployment','صحح التطبيق وتحقق من الاختبارات','Corriger et déployer mon application']){
  const found=searchSkills({query,category:'operations',semanticIds:[id]});assert.equal(found.skills[0].id,id);assert.equal(found.strategy,'model_selected_and_lexical');assert.equal('content' in found.skills[0],false);assert.equal(found.skills[0].capability,'text_draft');
 }
 const session=createSkillSession();await assert.rejects(()=>readSkill({id,reference:'references/delivery-evidence.md'},session),e=>e.code==='skill_entry_required');
 const method=await readSkill({id},session);assert.equal(method.provenance.origin,'Braand');assert.equal(method.provenance.license,'Braand-original');assert.equal(method.truncated,false);assert.ok(method.chars<4000);assert.equal(session.calls,1);
 const reference=await readSkill({id,reference:'references/delivery-evidence.md'},session);assert.equal(reference.truncated,false);assert.equal(reference.provenance.digest,method.provenance.digest);assert.equal(session.calls,2);assert.ok(session.chars<10000);
 await assert.rejects(()=>readSkill({id,reference:'scripts/deploy.sh'},session),e=>e.code==='skill_not_found');assert.equal(Object.hasOwn(publicSkillResult('read_skill',method),'content'),false);
});

test('growth and community requests discover focused methods without granting execution capabilities',async()=>{
 const requests=[
  ['entretiens besoins','customer-research'],
  ['offre valeur conditions','offers'],
  ['expériences métrique répartition','ab-testing'],
  ['emails séquences','emails'],
  ['activation premier résultat','onboarding'],
  ['réclamations critique abus','crisis-and-moderation'],
  ['déclinaison plateforme versions','cross-platform-repurposing'],
  ['goulot croissance canal','braand-growth-strategy'],
 ];
 for(const [query,id] of requests){
  const result=searchSkills({query,category:'marketing'});
  assert.equal(result.skills[0]?.id,id,query);
  const loaded=await readSkill({id},createSkillSession());
  assert.ok(loaded.content.length>0);
  assert.ok(['provided_data_analysis','text_draft','campaign_plan'].includes(loaded.capability));
  assert.equal(loaded.provenance.origin,id==='braand-growth-strategy'?'Braand':id==='crisis-and-moderation'||id==='cross-platform-repurposing'?'https://github.com/social-media-skills/skills':'https://github.com/coreyhaines31/marketingskills');
  assert.equal(Object.hasOwn(publicSkillResult('read_skill',loaded),'content'),false);
 }
});

test('adapted methods support model-led multilingual selection and progressive references within existing budgets',async()=>{
 const ids=['braand-campaign-operations','braand-business-research','braand-decision-prioritization','braand-project-delivery','braand-professional-writing','braand-meeting-actions'];
 for(const [index,id]of ids.entries()){
  const query=['Publicité','بحث موثق','優先順位を決める','Organize dependencies','Rédiger une lettre','总结会议'][index];
  const result=searchSkills({query,semanticIds:[id]});
  assert.equal(result.skills[0].id,id);assert.equal(result.strategy,'model_selected_and_lexical');
  const loaded=await readSkill({id},createSkillSession());
  assert.equal(loaded.provenance.license,'User-provided-adapted');
  assert.equal(loaded.provenance.origin,'user-provided://braand/2026-10-25');
  assert.equal(loaded.version,'1.0.0');assert.equal(loaded.truncated,false);
  assert.ok(loaded.chars<4000,'Focused entry should not load the original long guide');
 }
 const session=createSkillSession();
 await assert.rejects(()=>readSkill({id:ids[0],reference:'references/live-actions.md'},session),error=>error.code==='skill_entry_required');
 const entry=await readSkill({id:ids[0]},session);assert.equal(entry.references.length,3);
 const reference=await readSkill({id:ids[0],reference:'references/live-actions.md'},session);
 assert.equal(reference.reference,'references/live-actions.md');assert.equal(session.calls,2);
 assert.equal(reference.budget.remainingChars,SKILL_POLICY.maxRunChars-entry.chars-reference.chars);
 assert.equal(searchSkills({category:'operations',semanticIds:[ids[0],ids[1]]}).skills.some(skill=>skill.id===ids[0]),false);
});

test('settings metadata matches the reviewed registry and rejects private prose or extra executable fields',()=>{
 const skills=reviewedSkillMetadata();const dto=reviewedSkillCatalogSchema.parse({skills});
 assert.equal(dto.skills.length,166);assert.equal(new Set(dto.skills.map(skill=>skill.id)).size,166);
 assert.equal(reviewedSkillCatalogSchema.safeParse({skills:[{...skills[0],content:'private instructions'}]}).success,false);
 assert.equal(reviewedSkillCatalogSchema.safeParse({skills:[{...skills[0],tools:['shell']}]}).success,false);
 assert.equal(reviewedSkillCatalogSchema.safeParse({skills:[{...skills[0],id:'../unreviewed'}]}).success,false);
 assert.ok(dto.skills.every(skill=>Object.keys(skill).sort().join(',')==='capability,category,description,id,title,version'));
});

test('growth pack adds focused sales and retention methods without a second router or assumed tools',async()=>{
 const cases=[
  ['braand-sales-conversion','Preparar una conversación de ventas'],
  ['braand-lead-magnets','リード向けの役立つ資料'],
  ['braand-outbound-referrals','Prospecter et préparer un parrainage'],
  ['braand-revenue-models','Compare revenue and cash collection'],
  ['braand-retention-economics','تحليل الاحتفاظ بالعملاء'],
 ];
 for(const [id,query]of cases){
  const discovered=searchSkills({query,semanticIds:[id],category:'marketing'});
  assert.equal(discovered.skills[0].id,id);assert.equal(discovered.skills[0].version,'1.0.0');
  const session=createSkillSession(),method=await readSkill({id},session);
  assert.equal(method.truncated,false);assert.ok(method.chars<4000);assert.equal(session.calls,1);
  for(const reference of method.references){const detail=await readSkill({id,reference},session);assert.ok(detail.content.length>100);assert.ok(detail.budget.remainingChars>0);}
  assert.ok(['text_draft','text_and_page_draft','provided_data_analysis'].includes(method.capability));
 }
 assert.equal(reviewedSkillMetadata().some(item=>item.id==='hormozi-growth-router'),false);
 assert.equal(reviewedSkillMetadata().some(item=>item.id==='hormozi-paid-ads-lab'),false);
});
test('video methods expose reviewed references and templates, with no executable archive entries',async()=>{
 const discovery=searchSkills({query:'montage anime AMV typographie',category:'creative'});
 assert.equal(discovery.skills[0]?.id,'video-motion-studio');
 assert.equal(reviewedSkillMetadata().find(skill=>skill.id==='video-motion-studio')?.category,'creative');
 const session=createSkillSession(),entry=await readSkill({id:'video-motion-studio'},session);
 assert.equal(entry.capability,'media_proposal');
 assert.equal(entry.provenance.revision,'43e8544a2b894204e715dc75ff399e009bc627fa39c31fb0041324b7e9d18e7a');
 assert.equal(entry.references.length,13);
 assert.ok(entry.references.includes('references/motion-design.md'));
 assert.ok(entry.references.includes('assets/timeline.example.json'));
 const timeline=await readSkill({id:'video-motion-studio',reference:'assets/timeline.example.json'},session);
 assert.ok(Array.isArray(JSON.parse(timeline.content).clips));
 for(const reference of ['scripts/build_timeline.py','INSTALL.md','assets/remotion-starter/package.json'])
  await assert.rejects(()=>readSkill({id:'video-motion-studio',reference},session),error=>error.code==='skill_not_found');
 const publicResult=publicSkillResult('read_skill',entry);assert.equal('provenance' in publicResult,false);assert.equal('content' in publicResult,false);
});
