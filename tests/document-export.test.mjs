import test from 'node:test';import assert from 'node:assert/strict';
import {renderDocument,documentRows} from '../lib/document-export.mjs';
import {detectFileType,OFFICE_MIME_TYPES} from '../lib/file-policy.mjs';
test('generated Office files have actual independently recognized OPC packages and preserve multilingual text',()=>{
 for(const format of ['docx','xlsx','pptx']){const result=renderDocument(format,'Rapport','Bonjour & <test>\nمرحبا 世界\n=HYPERLINK("unsafe")',['https://example.com/source']);assert.equal(detectFileType(result.bytes),OFFICE_MIME_TYPES[format]);const xml=new TextDecoder().decode(result.bytes);assert.ok(xml.includes('مرحبا 世界'));assert.ok(!xml.includes('<f>'));assert.ok(xml.includes('&lt;test&gt;'));}
});
test('PDF offsets and page counts are valid, accents survive and unsupported scripts fail explicitly',()=>{
 const result=renderDocument('pdf','Étude de marché','Coût : 4 900 FCFA. L’offre — vérifiée.\n'.repeat(100)),text=new TextDecoder().decode(result.bytes);assert.equal(detectFileType(result.bytes),'application/pdf');assert.match(text,/\/Count 3/);const start=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(start,start+4),'xref');const offsets=text.slice(start).split('\n').filter(line=>/^\d{10} 00000 n/.test(line));offsets.forEach((line,i)=>assert.ok(text.slice(Number(line.slice(0,10))).startsWith((i+1)+' 0 obj')));assert.throws(()=>renderDocument('pdf','Rapport','مرحبا'),/DOCX ou HTML/);
});
test('HTML is escaped, offline and cannot embed executable user content',()=>{
 const html=new TextDecoder().decode(renderDocument('html','<script>title</script>','<img src=x onerror=alert(1)>').bytes);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('default-src'));assert.ok(!html.includes('https://'));
});
test('CSV preserves real rows while neutralizing spreadsheet formulas and bounding exports',()=>{
 const csv=new TextDecoder().decode(renderDocument('csv','Table','| Nom | Valeur |\n|---|---|\n| Test | =1+1 |').bytes);assert.ok(csv.includes('"\'=1+1"'));assert.deepEqual(documentRows('Texte seul'),[['Texte seul']]);assert.throws(()=>renderDocument('zip','X','Y'));assert.throws(()=>renderDocument('md','X','x'.repeat(150001)));assert.doesNotThrow(()=>renderDocument('md','X','x'.repeat(20000)));
});
test('tabular exports keep the surrounding explanation and source provenance',()=>{
 for(const format of ['xlsx','csv']){const text=new TextDecoder().decode(renderDocument(format,'Mesures','Une estimation, pas des ventes.\n| Nom | Valeur |\n|---|---|\n| Test | 123 |',['https://example.com/source']).bytes);assert.ok(text.includes('Une estimation'));assert.ok(text.includes('https://example.com/source'));}
 const csv=new TextDecoder().decode(renderDocument('csv','Titre','  =1+1').bytes);assert.ok(csv.includes("'  =1+1"));
 const hidden=new TextDecoder().decode(renderDocument('csv','Titre','\u0000=HYPERLINK("https://example.com")').bytes);assert.ok(hidden.includes("'\u0000=HYPERLINK"));
});
