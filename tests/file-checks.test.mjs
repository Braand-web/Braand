import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGeneratedFile,FileCheckError} from '../lib/file-checks.mjs';
import {OFFICE_TEMPLATES,renderOfficeTemplate} from '../lib/office-templates.mjs';
import {richDocx,richXlsx} from '../lib/office-export.mjs';
import {documentZip} from '../lib/document-export.mjs';

const company={name:'Atelier Test',city:'Douala'};
test('every office template Braand ships passes its own delivery check',async()=>{
 let checked=0;
 for(const [key,def] of Object.entries(OFFICE_TEMPLATES))for(const format of def.formats){
  if(format==='pdf')continue;
  for(const blank of [false,true]){
   const rendered=renderOfficeTemplate(key,format,company,blank?{}:{number:'BD-001',beneficiary:'Awa',amount:25000,reason:'Achat',items:[{label:'Papier',quantity:2,unitPrice:1500}]});
   if(rendered.kind!=='bytes'&&!rendered.bytes)continue;
   const result=await inspectGeneratedFile(format,rendered.bytes);assert.equal(result.passed,true,key+' '+format);checked++;
  }
 }
 assert.ok(checked>=10,'at least ten template renders were inspected, got '+checked);
});
test('rich Word and Excel exports pass and report what they contain',async()=>{
 const docx=await inspectGeneratedFile('docx',richDocx('Rapport','# Rapport\n\nUn paragraphe complet avec plusieurs mots.\n\n| A | B |\n|---|---|\n| 1 | 2 |'));
 assert.match(docx.summary,/mots lisibles/);
 const xlsx=await inspectGeneratedFile('xlsx',richXlsx('| Produit | Prix |\n|---|---|\n| Café | 1500 |\n| Thé | 900 |'));
 assert.match(xlsx.summary,/feuille.*formule.*aucune erreur/);
});
const sheet=cells=>documentZip({
 '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
 'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Total du budget mensuel</t></is></c>'+cells+'</row></sheetData></worksheet>',
});
test('a workbook with a broken formula or a missing value is refused with the cell',async()=>{
 await assert.rejects(()=>inspectGeneratedFile('xlsx',sheet('<c r="C7"><f>SUM(#REF!)</f></c>')),error=>error instanceof FileCheckError&&/Budget.*#REF! en C7/.test(error.message));
 await assert.rejects(()=>inspectGeneratedFile('xlsx',sheet('<c r="B2" t="e"><v>#DIV/0!</v></c>')),/#DIV\/0! en B2/);
 await assert.rejects(()=>inspectGeneratedFile('xlsx',sheet('<c r="B3" t="inlineStr"><is><t>Montant : undefined</t></is></c>')),/undefined/);
 const ok=await inspectGeneratedFile('xlsx',sheet('<c r="B1"><f>SUM(B2:B4)</f><v>0</v></c>'));assert.match(ok.summary,/1 feuille, 1 formule/);
});
test('empty, unreadable and wrongly sized files are refused',async()=>{
 await assert.rejects(()=>inspectGeneratedFile('docx',new Uint8Array()),/vide/);
 await assert.rejects(()=>inspectGeneratedFile('docx',new TextEncoder().encode('not a zip')),/ne s’ouvre pas/);
 await assert.rejects(()=>inspectGeneratedFile('pdf',new TextEncoder().encode('%PDF-1.7\n')),/incomplet/);
 await assert.rejects(()=>inspectGeneratedFile('pdf',new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF')),/aucune page/);
 const png=(w,h)=>{const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);const v=new DataView(b.buffer);v.setUint32(16,w);v.setUint32(20,h);return b;};
 assert.equal((await inspectGeneratedFile('png',png(1080,1080),{width:1080,height:1080})).summary,'1080×1080 px');
 await assert.rejects(()=>inspectGeneratedFile('png',png(800,600),{width:1080,height:1080}),/800×600 au lieu de 1080×1080/);
 await assert.rejects(()=>inspectGeneratedFile('md',new TextEncoder().encode('# Rapport {{ client.name }}')),/client\.name/);
 assert.equal((await inspectGeneratedFile('md',new TextEncoder().encode('# Guide JavaScript\n\nUne variable non affectée vaut undefined en JavaScript.'))).passed,true);
 assert.match((await inspectGeneratedFile('csv',new TextEncoder().encode('a,b\n1,2\n'))).summary,/2 lignes/);
});
