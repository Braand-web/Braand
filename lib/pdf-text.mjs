// Best-effort text extraction from a PDF, without third-party code: inflate
// FlateDecode streams (including object streams), read each font's ToUnicode
// map, and collect the strings shown by text operators, line by line.
// Scanned PDFs (images only) return little or no text; the caller must then
// say so instead of guessing the content.

const latin1=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return s;};

// Keep what was inflated even if the stream ends with padding bytes.
async function inflate(bytes){
 for(const format of ['deflate','deflate-raw']){
  const chunks=[];let size=0;
  try{const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
   for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length;if(size>20*1024*1024)break;}
  }catch{/* keep the data read so far */}
  if(size){const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}
 }
 return null;
}

/** Objects of the file: number → {dict, stream?} (object streams expanded). */
async function readObjects(bytes){
 const raw=latin1(bytes),objects=new Map(),re=/(\d+)\s+(\d+)\s+obj\b/g;let m,total=0;
 while((m=re.exec(raw))){
  const start=m.index+m[0].length,end=raw.indexOf('endobj',start);if(end<0)break;
  const body=raw.slice(start,end),si=body.search(/\bstream\r?\n/);
  if(si<0){objects.set(Number(m[1]),{dict:body});re.lastIndex=end;continue;}
  const dict=body.slice(0,si);let dataStart=start+si+6;if(raw[dataStart]==='\r')dataStart++;if(raw[dataStart]==='\n')dataStart++;
  let dataEnd=raw.indexOf('endstream',dataStart);if(dataEnd<0||dataEnd>end)dataEnd=end;while(dataEnd>dataStart&&/[\r\n]/.test(raw[dataEnd-1]))dataEnd--;
  let stream=null;
  if(!/\/Subtype\s*\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFax/.test(dict)){const data=bytes.subarray(dataStart,dataEnd);const decoded=/\/FlateDecode/.test(dict)?await inflate(data):/\/Filter/.test(dict)?null:data;if(decoded){total+=decoded.length;if(total<=60*1024*1024)stream=latin1(decoded);}}
  objects.set(Number(m[1]),{dict,stream});re.lastIndex=end;
  // Object streams hold more objects (often the fonts).
  if(stream&&/\/Type\s*\/ObjStm/.test(dict)){const n=Number(dict.match(/\/N\s+(\d+)/)?.[1]||0),first=Number(dict.match(/\/First\s+(\d+)/)?.[1]||0);const header=stream.slice(0,first).trim().split(/\s+/).map(Number);
   for(let i=0;i<n&&i*2+1<header.length;i++){const num=header[i*2],off=first+header[i*2+1],next=i+1<n?first+header[i*2+3]:stream.length;if(!objects.has(num))objects.set(num,{dict:stream.slice(off,next)});}}
 }
 return objects;
}

const hexToString=hex=>{let s='';for(let i=0;i<hex.length;i+=4){const code=parseInt(hex.slice(i,i+4).padEnd(4,'0'),16);if(Number.isFinite(code))s+=String.fromCharCode(code);}return s;};
function cmap(text){
 const map=new Map();if(!text||!/begincmap/.test(text))return map;
 for(const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g))map.set(m[1].toLowerCase(),hexToString(m[2]));
 for(const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))for(const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)){
  const lo=parseInt(m[1],16),hi=parseInt(m[2],16),width=m[1].length;if(!(hi>=lo)||hi-lo>5000)continue;
  if(m[3]){const base=parseInt(m[3],16);for(let c=lo;c<=hi;c++)try{map.set(c.toString(16).padStart(width,'0'),String.fromCodePoint(base+(c-lo)));}catch{/* skip invalid */}}
  else{const items=[...m[4].matchAll(/<([0-9a-fA-F]+)>/g)].map(x=>hexToString(x[1]));for(let c=lo;c<=hi&&c-lo<items.length;c++)map.set(c.toString(16).padStart(width,'0'),items[c-lo]);}
 }
 return map;
}

/** Font resource name (/F1) → ToUnicode map, plus a per-font code width. */
function fontMaps(objects){
 const byObject=new Map(),byName=new Map();
 for(const [num,obj] of objects){const ref=obj.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);if(ref&&/\/Type\s*\/Font/.test(obj.dict)){const target=objects.get(Number(ref[1]));const map=cmap(target?.stream);if(map.size)byObject.set(num,map);}}
 for(const obj of objects.values()){const fonts=obj.dict.match(/\/Font\s*<<([\s\S]*?)>>/);const list=fonts?fonts[1]:/\/Type\s*\/Font\b/.test(obj.dict)?'':null;
  if(list)for(const m of list.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)){const map=byObject.get(Number(m[2]));if(map&&!byName.has(m[1]))byName.set(m[1],map);}
  const ref=obj.dict.match(/\/Font\s+(\d+)\s+\d+\s+R/);if(ref){const dict=objects.get(Number(ref[1]))?.dict||'';for(const m of dict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)){const map=byObject.get(Number(m[2]));if(map&&!byName.has(m[1]))byName.set(m[1],map);}}
 }
 return byName;
}

function literal(s,i){
 let depth=1,out='';i++;
 while(i<s.length&&depth>0){const c=s[i];
  if(c==='\\'){const n=s[i+1],esc={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'}[n];
   if(esc!==undefined){out+=esc;i+=2;continue;}
   const oct=s.slice(i+1,i+4).match(/^[0-7]{1,3}/);if(oct){out+=String.fromCharCode(parseInt(oct[0],8));i+=1+oct[0].length;continue;}
   i+=2;continue;}
  if(c==='(')depth++;else if(c===')'){depth--;if(!depth){i++;break;}}
  out+=c;i++;}
 return [out,i];
}
function decodeCodes(hex,map){
 if(!map)return hex.match(/../g)?.map(h=>String.fromCharCode(parseInt(h,16))).join('')||'';
 let out='',i=0;while(i<hex.length){const four=hex.slice(i,i+4),two=hex.slice(i,i+2);if(map.has(four)){out+=map.get(four);i+=4;}else if(map.has(two)){out+=map.get(two);i+=2;}else i+=hex.length%4===0?4:2;}
 return out;
}
const toHex=text=>[...text].map(ch=>ch.charCodeAt(0).toString(16).padStart(2,'0')).join('');

function contentText(s,fonts){
 if(!/\b(Tj|TJ)\b/.test(s))return '';
 let out='',i=0,map=null,lastY=null;const stack=[];
 const newline=()=>{if(out&&!out.endsWith('\n'))out+='\n';};
 while(i<s.length){const c=s[i];
  if(c==='%'){const e=s.indexOf('\n',i);i=e<0?s.length:e;continue;}
  if(c==='('){const [t,n]=literal(s,i);stack.push({str:map?decodeCodes(toHex(t),map):t});i=n;continue;}
  if(c==='<'&&s[i+1]!=='<'){const end=s.indexOf('>',i);if(end<0)break;stack.push({str:decodeCodes(s.slice(i+1,end).replace(/\s+/g,'').toLowerCase(),map)});i=end+1;continue;}
  if(c==='/'){const m=s.slice(i+1).match(/^[^\s/<>[\]()]+/);stack.push({name:m?m[0]:''});i+=1+(m?m[0].length:0);continue;}
  if(c==='['||c===']'){i++;continue;}
  if(/[-+0-9.]/.test(c)){const m=s.slice(i).match(/^[-+]?\d*\.?\d+/);if(m){stack.push({num:Number(m[0])});i+=m[0].length;continue;}}
  if(/[A-Za-z'"*]/.test(c)){const m=s.slice(i).match(/^[A-Za-z'"*]+/),op=m[0];i+=op.length;
   if(op==='Tf'){const name=stack.filter(x=>x.name!==undefined).pop()?.name;map=name&&fonts.get(name)||null;}
   else if(op==='Tj'||op==="'"||op==='"'){if(op!=='Tj')newline();out+=stack.filter(x=>x.str!==undefined).map(x=>x.str).join('');}
   else if(op==='TJ'){for(const x of stack){if(x.str!==undefined)out+=x.str;else if(x.num!==undefined&&x.num<-200&&!out.endsWith(' '))out+=' ';}}
   else if(op==='Td'||op==='TD'){const nums=stack.filter(x=>x.num!==undefined);const ty=nums.at(-1)?.num||0;if(Math.abs(ty)>0.5)newline();}
   else if(op==='Tm'){const y=stack.filter(x=>x.num!==undefined).at(-1)?.num;if(y!==undefined&&lastY!==null&&Math.abs(y-lastY)>0.5)newline();if(y!==undefined)lastY=y;}
   else if(op==='T*'||op==='ET'){if(op==='T*')newline();}
   else if(op==='BT'){/* keep line state */}
   stack.length=0;continue;}
  i++;}
 return out;
}

/** Text of a PDF (bounded) and whether it looks readable. */
export async function pdfText(bytes,maxChars=60000){
 if(!(bytes instanceof Uint8Array)||latin1(bytes.subarray(0,5))!=='%PDF-')return {text:'',readable:false,truncated:false};
 const objects=await readObjects(bytes),fonts=fontMaps(objects);
 let text='';
 for(const obj of objects.values()){if(!obj.stream||/begincmap/.test(obj.stream)||/\/Type\s*\/(ObjStm|XRef|Metadata)/.test(obj.dict))continue;const page=contentText(obj.stream,fonts);if(page){text+=page+'\n';if(text.length>maxChars*2)break;}}
 text=text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 const letters=(text.match(/\p{L}/gu)||[]).length;
 return {text:text.slice(0,maxChars),readable:letters>=40,truncated:text.length>maxChars};
}
