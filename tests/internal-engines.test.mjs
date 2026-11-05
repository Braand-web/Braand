import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {tableData,parseTableCSV,analyzeTable,tableCSV,decimalValue} from '../lib/data-engine.mjs';
import {sourceFiles,sourceArchive} from '../lib/source-archive.mjs';
import {discoveredPlatformTools} from '../lib/platform-tools.ts';
const {unzipSync}=createRequire(path.join(process.env.BRAAND_TOOLCHAIN||path.resolve('node_modules'),'package.json'))('fflate');

test('native tool metadata imports without a bundler and discovery still requires readiness and write access',()=>{
 for(const [area,read,write] of [['analysis','get_analysis_result','analyze_data'],['software','get_source_project','save_source_project']]){
  assert.deepEqual(discoveredPlatformTools(area,{[area]:{ready:true},canWrite:false}).map(t=>t.name).sort(),(area==='software'?[read,'list_site_files','read_site_file','check_site']:[read]).sort());
  if(area==='software')assert.ok(!discoveredPlatformTools(area,{[area]:{ready:true},canWrite:false}).some(t=>['create_site','write_site_file','import_site_asset','delete_site_file'].includes(t.name)));
  assert.ok(!discoveredPlatformTools(area,{[area]:{ready:false},canWrite:true}).some(t=>t.name===write));
  assert.ok(discoveredPlatformTools(area,{[area]:{ready:true},canWrite:true}).some(t=>t.name===write));
 }
});

test('real CSV parser retains quotes, newlines, Unicode and explicit delimiters',()=>{
 const table=parseTableCSV('\uFEFFNom;Montant;Note\r\n"مرحبا 世界";0,10;"a; b\n""c"""\r\n',';');
 assert.deepEqual(table,{columns:['Nom','Montant','Note'],rows:[['مرحبا 世界','0,10','a; b\n"c"']]});
 for(const raw of ['a,a\n1,2','a,b\n"open,2','a,b\n"x"bad,2','a,b\n1,2,3'])assert.throws(()=>parseTableCSV(raw));
});
test('decimal aggregation is exact at six positions and missing values never become zero',()=>{
 const data={columns:['groupe','montant'],rows:[['A','0.1'],['A','0.2'],['A',null],['B',''],['C','-0.000001'],['C','0']]};
 const result=analyzeTable(data,[{op:'group',by:['groupe'],aggregates:[{op:'sum',column:'montant',as:'somme'},{op:'mean',column:'montant',as:'moyenne'},{op:'count',column:'montant',as:'observés'}]}]);
 assert.deepEqual(result.rows,[['A','0.3','0.15',2],['B',null,null,0],['C','-0.000001','-0.000001',2]]);assert.ok(result.notes.some(n=>n.includes('vide')));
 assert.deepEqual(analyzeTable({columns:['valeur'],rows:[]},[{op:'group',by:[],aggregates:[{op:'count',as:'nombre'},{op:'sum',column:'valeur',as:'total'}]}]).rows,[[0,null]]);
 assert.equal(decimalValue('999999999999999999.123456'),999999999999999999123456n);
 assert.throws(()=>decimalValue(9007199254740992));assert.throws(()=>decimalValue('1.234','comma'));assert.throws(()=>decimalValue('1,234','dot'));assert.throws(()=>decimalValue('1.0000001'));
 assert.throws(()=>tableData({columns:['entier'],rows:[[9007199254740992]]}));assert.throws(()=>tableData({columns:['texte'],rows:[['\ud800']]}));assert.equal(tableData({columns:['texte'],rows:[['🚀']]}).rows[0][0],'🚀');
 assert.throws(()=>analyzeTable({columns:['montant'],rows:[['999999999999999999'],['1']]},[{op:'group',by:[],aggregates:[{op:'sum',column:'montant',as:'total'}]}]),/18 chiffres/);
});
test('pipeline filters, groups, sorts and limits the whole input without mutating it',()=>{
 const data={columns:['Pays','Valeur'],rows:[['CM','0,10'],['CM','0,20'],['FR','0,05'],['CM',null]]},before=structuredClone(data);
 const result=analyzeTable(data,[{op:'filter',column:'Valeur',operator:'not_empty'},{op:'group',by:['Pays'],aggregates:[{op:'sum',column:'Valeur',as:'Total'}]},{op:'sort',column:'Total',type:'number',direction:'desc'},{op:'limit',count:1}],'comma');
 assert.deepEqual(result.rows,[['CM','0,3']]);assert.equal(result.inputRows,4);assert.equal(result.outputRows,1);assert.ok(result.notes.some(n=>n.includes('exclue')));assert.deepEqual(data,before);
});
test('data and CSV output reject execution, ambiguity and oversize instead of silently truncating',()=>{
 assert.throws(()=>analyzeTable({columns:['x'],rows:[[1]]},[{op:'execute',code:'fetch("outside")'}]));
 assert.throws(()=>tableData({columns:['x'],rows:Array.from({length:501},()=>[1])}));assert.throws(()=>tableData({columns:['x'],rows:[[{nested:true}]]}));assert.throws(()=>analyzeTable({columns:['x'],rows:[['USD 12']]},[{op:'group',by:[],aggregates:[{op:'sum',column:'x',as:'total'}]}]));
 const parsed=tableData(JSON.parse('[{"__proto__":"data", "note":"=HYPERLINK(\"x\")"}]'.replace('HYPERLINK("x")','HYPERLINK(\\"x\\")')));
 const csv=tableCSV(parsed);assert.ok(csv.includes("'=HYPERLINK"));assert.equal({}.polluted,undefined);
});
test('source ZIP has real recoverable Unicode files, hashes and truthful execution state',async()=>{
 const files=[{path:'src/main.js',content:'console.log("مرحبا 世界");\n'},{path:'README.md',content:'# Projet\nSources proposées.'}];
 const archive=await sourceArchive(files,{id:'fixture',version:1}),zip=unzipSync(archive.bytes);
 assert.equal(new TextDecoder().decode(zip['src/main.js']),files[0].content);const manifest=JSON.parse(new TextDecoder().decode(zip['braand.project.json']));
 assert.equal(manifest.execution,'not_executed');assert.equal(manifest.tests,'not_run');assert.equal(manifest.deployment,'not_deployed');assert.equal(manifest.files.length,2);assert.match(manifest.files[0].sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(archive.bytes,(await sourceArchive(files,{id:'fixture',version:1})).bytes);
});
test('source paths cannot traverse, collide, overwrite their manifest or include credentials',()=>{
 for(const name of ['../x','/x','C:/x','a\\x','a//b','.env','.env.production','a/.git/config','node_modules/x','CON.txt','braand.project.json'])assert.throws(()=>sourceFiles([{path:name,content:'x'}]),name);
 for(const files of [[{path:'x',content:'a'},{path:'x/y',content:'b'}],[{path:'X.js',content:'a'},{path:'x.js',content:'b'}],[{path:'a.js',content:'\0'}],[{path:'a.js',content:'\ud800'}],Array.from({length:33},(_,i)=>({path:i+'.js',content:''}))])assert.throws(()=>sourceFiles(files));
 assert.equal(sourceFiles([{path:'.env.example',content:'EXAMPLE=replace_me'}])[0].path,'.env.example');
});
