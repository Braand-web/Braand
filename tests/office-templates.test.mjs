import assert from 'node:assert/strict';
import test from 'node:test';
import {inflateRawSync} from 'node:zlib';
import {amountInWords,numberToFrenchWords} from '../lib/amount-in-words.mjs';
import {renderOfficeTemplate,OFFICE_TEMPLATES,EXCEL_LESSONS,parseDate,frDate} from '../lib/office-templates.mjs';

// Minimal reader for the stored (uncompressed) zip entries our writer produces.
function entries(bytes){
 const files={},view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;
 while(view.getUint32(offset,true)===0x04034b50){const method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);const name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength));const data=bytes.subarray(offset+30+nameLength+extra,offset+30+nameLength+extra+size);files[name]=method===8?inflateRawSync(data):data;offset+=30+nameLength+extra+size;}
 return files;
}
const text=(files,name)=>new TextDecoder().decode(files[name]);

test('amounts are written in French words with the traditional rules',()=>{
 assert.equal(numberToFrenchWords(21),'vingt et un');assert.equal(numberToFrenchWords(71),'soixante et onze');
 assert.equal(numberToFrenchWords(80),'quatre-vingts');assert.equal(numberToFrenchWords(81),'quatre-vingt-un');
 assert.equal(numberToFrenchWords(200),'deux cents');assert.equal(numberToFrenchWords(201),'deux cent un');
 assert.equal(numberToFrenchWords(80000),'quatre-vingt mille');assert.equal(numberToFrenchWords(1000),'mille');
 assert.equal(amountInWords(150000),'Cent cinquante mille francs CFA (150 000)');
 assert.equal(amountInWords(1000000),'Un million de francs CFA (1 000 000)');
 assert.equal(amountInWords(1),'Un franc CFA (1)');
 assert.throws(()=>numberToFrenchWords(-1));assert.throws(()=>numberToFrenchWords(1e13));
});

test('dates accept ISO and French formats and reject impossible days',()=>{
 assert.deepEqual(parseDate('2026-11-04'),{y:2026,m:11,d:4});assert.deepEqual(parseDate('04/11/2026'),{y:2026,m:11,d:4});
 assert.equal(parseDate('31/02/2026'),null);assert.equal(frDate('2026-03-09'),'09/03/2026');
});

test('the treasury journal has real formulas, drop-down categories, print titles and a how-to sheet',()=>{
 const {kind,bytes}=renderOfficeTemplate('journal_tresorerie','xlsx',{name:'Cabinet <Test>'},{openingBalance:1000,entries:[{date:'2026-11-02',label:'Carburant',category:'Carburant et transport',out:300}]});
 assert.equal(kind,'xlsx');const files=entries(bytes),sheet=text(files,'xl/worksheets/sheet1.xml'),book=text(files,'xl/workbook.xml');
 assert.match(sheet,/<f>IF\(AND\(F7=&quot;&quot;,G7=&quot;&quot;\),&quot;&quot;,\$F\$4\+SUM\(\$F\$7:F7\)-SUM\(\$G\$7:G7\)\)<\/f>/);
 assert.match(sheet,/<dataValidation type="list"[^>]*sqref="D7:D\d+"><formula1>Listes!\$A\$2/);
 assert.match(text(files,'xl/worksheets/sheet2.xml'),/SUMIFS\(Journal!/);
 assert.match(book,/_xlnm.Print_Titles/);assert.match(book,/Comment le refaire/);assert.match(book,/fullCalcOnLoad="1"/);
 assert.match(sheet,/Cabinet &lt;Test&gt;/);assert.ok(!sheet.includes('<Test>'));
});

test('attendance counts codes per person and per day with weekend shading',()=>{
 const files=entries(renderOfficeTemplate('fiche_presence','xlsx',{},{month:2,year:2026,staff:[{name:'Awa'},{name:'Paul'}]},{learn:false}).bytes);
 const sheet=text(files,'xl/worksheets/sheet1.xml');
 assert.match(sheet,/COUNTIF\(C7:AD7,&quot;A&quot;\)/,'28 days in February 2026');assert.match(sheet,/<formula1>&quot;P,A,R,C,M,F&quot;<\/formula1>/);
 assert.ok(!text(files,'xl/workbook.xml').includes('Comment le refaire'),'learn:false removes the annex');
});

test('Word documents carry the letterhead, the amount in words and escape every field',()=>{
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZAAAHzAP9fH+bwgAAAABJRU5ErkJggg==','base64'));
 const files=entries(renderOfficeTemplate('bon_decaissement','docx',{name:'Cabinet',city:'Douala',rccm:'RC/DLA/1',logo:{bytes:png},signatories:[{name:'Jean',role:'Directeur'}]},{number:'BD-2026-001',beneficiary:'<b>Paul</b>',amount:150000,date:'2026-11-04'}).bytes);
 const doc=text(files,'word/document.xml');
 assert.match(doc,/Cent cinquante mille francs CFA/);assert.match(doc,/BD-2026-001/);assert.match(doc,/&lt;b&gt;Paul&lt;\/b&gt;/);assert.match(doc,/Fait à Douala, le 4 novembre 2026/);
 assert.ok(files['word/media/logo.png']);assert.match(text(files,'word/header1.xml'),/r:embed="rIdLogo"/);assert.match(text(files,'word/footer1.xml'),/RCCM : RC\/DLA\/1/);
 assert.match(doc,/Comment le refaire vous-même dans Word/);
});

test('PDF forms are printable HTML without scripts; formats are enforced',()=>{
 const {kind,html}=renderOfficeTemplate('attestation','pdf',{name:'C'},{kind:'stage',name:'<script>x</script>'});
 assert.equal(kind,'html');assert.ok(!html.includes('<script>x'));assert.match(html,/Attestation de stage/i);
 assert.throws(()=>renderOfficeTemplate('ordre_mission','xlsx'),/Format non disponible/);assert.throws(()=>renderOfficeTemplate('inconnu','docx'),/Modèle inconnu/);
 for(const [id,def] of Object.entries(OFFICE_TEMPLATES))for(const format of def.formats)assert.ok(renderOfficeTemplate(id,format,{},{}),id+' '+format);
});

test('every Excel lesson has a self-check using a real formula test and a hidden solution',()=>{
 for(const id of Object.keys(EXCEL_LESSONS)){
  const files=entries(renderOfficeTemplate('lecon_excel','xlsx',{},{lesson:id}).bytes);
  assert.match(text(files,'xl/worksheets/sheet1.xml'),/_xlfn.ISFORMULA\(/,id);assert.match(text(files,'xl/workbook.xml'),/name="Solution" sheetId="2" state="hidden"/,id);
 }
});
