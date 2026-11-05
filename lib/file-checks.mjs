// Reopens every file Braand produced before it is delivered, like a person
// opening the document once before sending it. A blocking problem stops the
// delivery with a precise message so the agent can fix and regenerate.
import {FILE_POLICY,OFFICE_MIME_TYPES} from './file-policy.mjs';
import {readOfficeZipDirectory,inflateOfficeEntry} from './office-archive.mjs';
import {parseOfficePreview} from './office-preview.mjs';
import {officePreviewText} from './chat-attachments.mjs';
import {pdfText} from './pdf-text.mjs';

// Values that only appear when data failed to reach a template.
// Only shapes a template leaves behind ("Montant : undefined", "NaN FCFA", an
// empty table cell): a guide that merely mentions the word stays valid.
const LEFTOVERS=[/:\s*(?:undefined|NaN|null)\b/,/\b(?:undefined|NaN)\s*(?:€|FCFA|XAF|F CFA|%)/,/(?:^|\|)\s*(?:undefined|NaN)\s*(?:\||$)/m,/\[object Object\]/,/\{\{\s*[\w.]+\s*\}\}/];
const EXCEL_ERRORS=['#REF!','#DIV/0!','#VALUE!','#NAME?','#N/A','#NUM!','#NULL!'];
const limits=()=>({maxEntries:FILE_POLICY.officeMaxArchiveEntries,maxExpandedBytes:FILE_POLICY.officeMaxExpandedBytes,maxRatio:FILE_POLICY.officeMaxCompressionRatio,maxXmlPartBytes:FILE_POLICY.officeMaxXmlPartBytes,maxXmlNodes:FILE_POLICY.officeMaxXmlNodes});
const words=text=>(text.match(/[\p{L}\p{N}]+/gu)||[]).length;
const decoder=new TextDecoder();

export class FileCheckError extends Error{constructor(message){super(message);this.name='FileCheckError';}}
const fail=message=>{throw new FileCheckError(message);};

function leftover(text,where){
 for(const pattern of LEFTOVERS){const match=text.match(pattern);if(match)fail(`${where} contient « ${match[0]} » : une donnée n’a pas été remplie. Corrige les données puis régénère le fichier.`);}
}

async function sheetFormulas(bytes){
 const lim=limits(),directory=readOfficeZipDirectory(bytes,lim),entries=new Map(directory.entries.map(entry=>[entry.name,entry]));
 const workbook=decoder.decode(await inflateOfficeEntry(bytes,entries.get('xl/workbook.xml'),lim));
 const names=[...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map(match=>match[1]);
 let formulas=0;const sheetEntries=[...entries.keys()].filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
 for(const [index,name] of sheetEntries.entries()){
  const xml=decoder.decode(await inflateOfficeEntry(bytes,entries.get(name),lim)),sheet=names[index]||'Feuille '+(index+1);
  for(const cell of xml.matchAll(/<c\b([^>]*)>(.*?)<\/c>/gs)){
   const ref=cell[1].match(/\br="([A-Z]+\d+)"/)?.[1]||'?',body=cell[2];
   const formula=body.match(/<f\b[^>]*>(.*?)<\/f>/s)?.[1];
   if(formula!==undefined||/<f\b[^>]*\/>/.test(body))formulas++;
   const error=EXCEL_ERRORS.find(code=>formula?.includes(code)||/\bt="e"/.test(cell[1])&&body.includes(code));
   if(error)fail(`La feuille « ${sheet} » contient ${error} en ${ref}. Corrige la formule ou les données, puis régénère le classeur.`);
   if(formula&&/(?:^|[^A-Za-z])(?:undefined|NaN)(?:[^A-Za-z]|$)/.test(formula))fail(`La formule de ${ref} (feuille « ${sheet} ») contient une valeur vide. Corrige-la puis régénère le classeur.`);
  }
 }
 return {sheets:names.length||sheetEntries.length,formulas};
}

function pngSize(bytes){
 const signature=[137,80,78,71,13,10,26,10];
 if(bytes.length<24||signature.some((value,index)=>bytes[index]!==value)||decoder.decode(bytes.subarray(12,16))!=='IHDR')fail('L’image produite n’est pas un PNG lisible. Régénère le visuel.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 return {width:view.getUint32(16),height:view.getUint32(20)};
}

/**
 * @param {string} format docx|xlsx|pptx|pdf|png|csv|md|html|txt|zip|...
 * @param {Uint8Array} bytes
 * @param {{width?:number,height?:number}} [expect]
 * @returns {Promise<{passed:true,summary:string,details:Record<string,number>}>}
 */
export async function inspectGeneratedFile(format,bytes,expect={}){
 if(!(bytes instanceof Uint8Array)||!bytes.length)fail('Le fichier produit est vide. Régénère-le.');
 if(format==='docx'||format==='xlsx'||format==='pptx'){
  let preview;
  try{preview=await parseOfficePreview(bytes,OFFICE_MIME_TYPES[format]);}catch{fail(`Le fichier ${format.toUpperCase()} produit ne s’ouvre pas. Régénère-le.`);}
  const text=officePreviewText(preview);
  if(words(text)<3)fail(`Le fichier ${format.toUpperCase()} produit est presque vide. Vérifie les données transmises puis régénère-le.`);
  leftover(text,'Le document');
  if(format==='xlsx'){const {sheets,formulas}=await sheetFormulas(bytes);return {passed:true,summary:`${sheets} feuille${sheets>1?'s':''}, ${formulas} formule${formulas>1?'s':''}, aucune erreur de calcul`,details:{sheets,formulas,words:words(text)}};}
  if(format==='pptx'){const slides=preview.slides?.length||0;if(!slides)fail('La présentation produite n’a aucune diapositive. Régénère-la.');return {passed:true,summary:`${slides} diapositive${slides>1?'s':''}`,details:{slides,words:words(text)}};}
  return {passed:true,summary:`${words(text)} mots lisibles`,details:{words:words(text)}};
 }
 if(format==='pdf'){
  const head=decoder.decode(bytes.subarray(0,5)),tail=decoder.decode(bytes.subarray(Math.max(0,bytes.length-2048)));
  if(head!=='%PDF-'||!tail.includes('%%EOF'))fail('Le PDF produit est incomplet. Régénère-le.');
  const raw=decoder.decode(bytes),pages=(raw.match(/\/Type\s*\/Page(?![s\w])/g)||[]).length;
  if(!pages)fail('Le PDF produit n’a aucune page. Régénère-le.');
  const {text}=await pdfText(bytes,200000);
  if(text)leftover(text,'Le PDF');
  return {passed:true,summary:`${pages} page${pages>1?'s':''}${text?`, ${words(text)} mots`:''}`,details:{pages,words:words(text)}};
 }
 if(format==='png'){
  const {width,height}=pngSize(bytes);
  if(expect.width&&expect.height&&(width!==expect.width||height!==expect.height))fail(`Le visuel mesure ${width}×${height} au lieu de ${expect.width}×${expect.height}. Régénère-le.`);
  return {passed:true,summary:`${width}×${height} px`,details:{width,height}};
 }
 if(['csv','md','html','txt'].includes(format)){
  const text=decoder.decode(bytes);
  if(words(text)<1)fail('Le fichier texte produit est vide. Régénère-le.');
  leftover(format==='html'?text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,''):text,'Le fichier');
  return {passed:true,summary:format==='csv'?`${text.trim().split(/\r?\n/).length} lignes`:`${words(text)} mots`,details:{words:words(text)}};
 }
 // Archives and other binary formats: presence and size only.
 return {passed:true,summary:`${bytes.length} octets`,details:{bytes:bytes.length}};
}
