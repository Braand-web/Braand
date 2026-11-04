// Methods taught by users: personal by default, team on request, never across
// workspaces; versioned edits; Braand's own changes limited to minor ones; no
// secrets; references must be the workspace's own files. Also checks that PDF
// and Office attachments become readable text.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/workspace-skills-test.mjs');mkdirSync(path.dirname(out),{recursive:true});

// In-memory stand-in for lib/server (resources, files, workspace owner).
globalThis.__skillStore={resources:new Map(),files:new Set(['file-a']),owner:'owner-1',seq:0};
const serverStub=`
import {AppError} from ${JSON.stringify(path.join(root,'lib/core.mjs'))};
const S=globalThis.__skillStore;
export async function createResource(tenant,kind,title,data={},status='draft'){const id='r'+(++S.seq);const r={id,workspace_id:tenant,kind,title,data:structuredClone(data),status,version:1};S.resources.set(id,r);return structuredClone(r);}
export async function getResource(tenant,id){const r=S.resources.get(id);if(!r||r.workspace_id!==tenant)throw new AppError('Élément introuvable.',404);return structuredClone(r);}
export async function updateResource(tenant,id,version,patch){const r=S.resources.get(id);if(!r||r.workspace_id!==tenant||r.version!==version)throw new AppError('La version a changé.',409,'stale_version');Object.assign(r,{title:patch.title??r.title,data:structuredClone(patch.data??r.data),status:patch.status??r.status,version:r.version+1});return structuredClone(r);}
export function db(){return {prepare(sql){let args=[];const q={bind(...a){args=a;return q;},async first(){
 if(sql.includes('owner_id'))return {owner_id:S.owner};
 if(sql.includes('FROM files'))return S.files.has(args[0])&&args[1]==='ws-1'?{id:args[0]}:null;return null;},
 async all(){if(sql.includes("kind='skill'"))return {results:[...S.resources.values()].filter(r=>r.workspace_id===args[0]&&r.kind==='skill'&&['ready','candidate'].includes(r.status)).reverse().map(r=>({id:r.id,title:r.title,status:r.status,data:JSON.stringify(r.data)}))};return {results:[]};}};return q;}};}
`;
await build({entryPoints:[path.join(root,'lib/workspace-skills.ts')],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'error',external:['zod'],plugins:[{name:'stub',setup(b){b.onResolve({filter:/^\.\/server$/},()=>({path:'server',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:serverStub,loader:'js',resolveDir:root}));}}]});
const skills=await import(pathToFileURL(out).href);

const base={title:'Faire un devis',whenToUse:'Quand on me demande un devis client',objective:'Produire un devis clair',steps:['Reprendre le nom du client','Lister les prestations','Ajouter la TVA'],source:'Expliqué par l’utilisateur dans la discussion'};
const results=[];const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};

await check('a taught method is active at once and personal to its author',async()=>{
 const skill=await skills.teachSkill('ws-1','alice',base);
 assert.equal(skill.status,'ready');assert.equal(skill.data.visibility,'personal');assert.equal(skill.data.ownerId,'alice');assert.equal(skill.data.origin,'taught');
 assert.match(await skills.skillIndexContext('ws-1','alice'),/Faire un devis/);
 assert.equal(await skills.skillIndexContext('ws-1','bob'),'','A teammate does not see a personal method');
 assert.equal(await skills.skillIndexContext('ws-2','alice'),'','Never visible from another workspace');
 assert.equal(skills.skillHiddenFrom(skill.data,'bob'),true);
});

await check('sharing with the team makes it visible to members, and only the author or owner can change it',async()=>{
 const id=[...globalThis.__skillStore.resources.keys()][0];let skill=await (async()=>globalThis.__skillStore.resources.get(id))();
 await assert.rejects(()=>skills.setSkillState('ws-1','bob',{id,version:skill.version,visibility:'team'}),/introuvable/,'Hidden from a teammate before sharing');
 skill=await skills.setSkillState('ws-1','alice',{id,version:skill.version,visibility:'team'});
 assert.match(await skills.skillIndexContext('ws-1','bob'),/Faire un devis.*équipe/);
 await assert.rejects(()=>skills.reviseSkill('ws-1','bob',{id,version:skill.version,changes:{steps:['Autre chose']},reason:'Je préfère'}),e=>e.code==='skill_not_owner');
 skill=await skills.setSkillState('ws-1','owner-1',{id,version:skill.version,active:false});
 assert.equal(skill.status,'disabled');assert.equal(await skills.skillIndexContext('ws-1','alice'),'','A deactivated method is not offered');
 await skills.setSkillState('ws-1','alice',{id,version:skill.version,active:true});
});

await check('edits are versioned and reversible; Braand may only apply minor improvements by itself',async()=>{
 const id=[...globalThis.__skillStore.resources.keys()][0];let skill=globalThis.__skillStore.resources.get(id);
 await assert.rejects(()=>skills.reviseSkill('ws-1','bob',{id,version:skill.version,changes:{steps:['Tout changer']},reason:'Mieux',by:'braand',impact:'major'}),e=>e.code==='skill_change_needs_agreement');
 skill=await skills.reviseSkill('ws-1','bob',{id,version:skill.version,changes:{checks:['Vérifier que le total TTC = HT + TVA']},reason:'Le total était faux au dernier devis',by:'braand',impact:'minor'});
 assert.deepEqual(skill.data.checks,['Vérifier que le total TTC = HT + TVA']);assert.equal(skill.data.history.length,1);assert.match(JSON.stringify(skill.data.changeLog),/Amélioration Braand/);
 skill=await skills.restoreSkill('ws-1','alice',{id,version:skill.version});assert.deepEqual(skill.data.checks,[]);
 await assert.rejects(()=>skills.reviseSkill('ws-1','alice',{id,version:1,changes:{},reason:'x'}),e=>e.code==='stale_version');
});

await check('secrets and foreign files are refused; invented-free fields are bounded',async()=>{
 await assert.rejects(()=>skills.teachSkill('ws-1','alice',{...base,steps:['Se connecter','mot de passe : Azerty123']}),e=>e.code==='skill_secret_refused');
 await assert.rejects(()=>skills.teachSkill('ws-1','alice',{...base,references:[{kind:'file',id:'file-of-someone-else'}]}),e=>e.code==='skill_reference_invalid');
 const ok=await skills.teachSkill('ws-1','alice',{...base,title:'Avec référence',references:[{kind:'file',id:'file-a',note:'modèle de devis'},{kind:'link',url:'https://exemple.cm/tarifs'}],toComplete:['Taux de remise habituel']});
 assert.equal(ok.data.references.length,2);assert.deepEqual(ok.data.toComplete,['Taux de remise habituel']);
 await assert.rejects(()=>skills.teachSkill('ws-1','alice',{...base,steps:[]}));
});

await check('PDF and Office attachments are read as text, scans are reported honestly',async()=>{
 const {pdfText}=await import('../lib/pdf-text.mjs');const {officePreviewText}=await import('../lib/chat-attachments.mjs');
 assert.deepEqual((await pdfText(new TextEncoder().encode('not a pdf'))).readable,false);
 // Minimal uncompressed PDF with one text line.
 const pdf=`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 72 712 Td (Bon de caisse : carburant 15 000 FCFA, valide par la direction) Tj ET\nendstream\nendobj\n%%EOF`;
 const read=await pdfText(new TextEncoder().encode(pdf));assert.equal(read.readable,true);assert.match(read.text,/Bon de caisse : carburant 15 000 FCFA/);
 const text=officePreviewText({kind:'xlsx',sheets:[{name:'Caisse',rows:[{number:1,cells:['Date','Montant']},{number:2,cells:['04/11','15000']}]}],truncated:false});
 assert.match(text,/Feuille « Caisse »/);assert.match(text,/2 : 04\/11 \| 15000/);
 const sample=path.join(root,'.tmp/visuals/presentation-16x9.pdf');if(existsSync(sample))assert.match((await pdfText(new Uint8Array(readFileSync(sample)))).text,/Le problème/);
});
console.log(results.length+' workspace skill checks passed; storage simulated in memory.');
