// Native, editable Office files with real styles, built from Markdown.
// DOCX: title page, automatic table of contents, Heading styles, lists, tables,
// callouts and page numbers. XLSX: one formatted sheet per Markdown table with
// typed numbers, widths, frozen header and filters. No macros, no remote parts.
import {documentZip} from './document-export.mjs';

const x=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const REL='http://schemas.openxmlformats.org/package/2006/relationships',OFF='http://schemas.openxmlformats.org/officeDocument/2006/relationships',W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const hex=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value.slice(1).toUpperCase():'2563EB';

/** Markdown to typed blocks shared by the Office writers. */
export function markdownBlocks(markdown){
 const lines=String(markdown).replace(/\r\n?/g,'\n').split('\n'),blocks=[],para=[];let i=0;
 const flush=()=>{if(para.length){blocks.push({type:'p',text:para.join(' ')});para.length=0;}};
 while(i<lines.length){
  const line=lines[i],h=/^(#{1,4})\s+(.+)$/.exec(line);
  if(h){flush();blocks.push({type:'h',level:h[1].length,text:h[2].trim()});i++;continue;}
  if(/^\s*(---|\*\*\*)\s*$/.test(line)){flush();blocks.push({type:'hr'});i++;continue;}
  if(/^>\s?/.test(line)){flush();const q=[];while(i<lines.length&&/^>\s?/.test(lines[i]))q.push(lines[i++].replace(/^>\s?/,''));blocks.push({type:/^\*\*[^*]+:?\*\*/.test(q[0]||'')?'callout':'quote',text:q.join(' ')});continue;}
  if(/^\s*\|.*\|\s*$/.test(line)){flush();const rows=[];while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(lines[i++]);const cells=rows.filter(r=>!/^\s*\|[\s:|-]+\|\s*$/.test(r)).map(r=>r.trim().slice(1,-1).split('|').map(c=>c.trim()));if(cells.length)blocks.push({type:'table',rows:cells});continue;}
  if(/^\s*([-*•]|\d+[.)])\s+/.test(line)){flush();const ordered=/^\s*\d+[.)]/.test(line),items=[];while(i<lines.length&&/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]))items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/,''));blocks.push({type:'list',ordered,items});continue;}
  if(/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line.trim())){flush();const alt=/^!\[([^\]]*)\]/.exec(line.trim())[1];if(alt)blocks.push({type:'p',text:'['+alt+']'});i++;continue;}
  if(!line.trim()){flush();i++;continue;}
  para.push(line.trim());i++;
 }
 flush();return blocks;
}

/** Inline **bold**, *italic*, `code` and [links](url) to Word runs. */
function runs(text,base=''){
 const out=[],re=/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;let last=0,m;
 const run=(t,props='')=>out.push(`<w:r>${props||base?`<w:rPr>${base}${props}</w:rPr>`:''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`);
 while((m=re.exec(text))){if(m.index>last)run(text.slice(last,m.index));const t=m[0];
  if(t.startsWith('**'))run(t.slice(2,-2),'<w:b/>');else if(t.startsWith('`'))run(t.slice(1,-1),'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F3F6"/>');
  else if(t.startsWith('['))run(/^\[([^\]]+)\]/.exec(t)[1],'<w:color w:val="2563EB"/><w:u w:val="single"/>');else run(t.slice(1,-1),'<w:i/>');
  last=m.index+t.length;}
 if(last<text.length)run(text.slice(last));if(!out.length)run('');return out.join('');
}

export function richDocx(title,markdown,{subtitle='',author='',accent='#2563eb',sources=[]}={}){
 const color=hex(accent),blocks=markdownBlocks(markdown),body=[],orderedLists=[];let nextNum=3;
 const p=(content,style='',extra='')=>`<w:p>${style||extra?`<w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${extra}</w:pPr>`:''}${content}</w:p>`;
 // Title page.
 body.push(p(runs(title),'Title'));if(subtitle)body.push(p(runs(subtitle),'Subtitle'));if(author)body.push(p(runs(author),'Author'));
 // Automatic table of contents (Word fills it when the document opens).
 if(blocks.filter(b=>b.type==='h'&&b.level<=2).length>=3){body.push(p('<w:r><w:br w:type="page"/></w:r>'));body.push(p(runs('Sommaire'),'TOCHeading'));body.push(`<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${blocks.filter(b=>b.type==='h'&&b.level<=2).map((b,i)=>`${i?'<w:r><w:br/></w:r>':''}<w:r>${b.level===1?'<w:rPr><w:b/></w:rPr>':''}<w:t xml:space="preserve">${b.level===2?'    ':''}${x(b.text.replace(/\*\*/g,''))}</w:t></w:r>`).join('')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`);}
 for(const b of blocks){
  if(b.type==='h'){const style='Heading'+Math.min(b.level,3);body.push(p(runs(b.text),style,b.level===1?'<w:pageBreakBefore/>':''));}
  else if(b.type==='p')body.push(p(runs(b.text),'BodyText'));
  else if(b.type==='quote')body.push(p(runs(b.text),'Quote'));
  else if(b.type==='callout')body.push(p(runs(b.text),'Callout'));
  else if(b.type==='hr')body.push(p('','',`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="E3E6EB"/></w:pBdr>`));
  else if(b.type==='list'){const numId=b.ordered?nextNum++:1;if(b.ordered)orderedLists.push(numId);for(const item of b.items)body.push(p(runs(item),'ListParagraph',`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`));}
  else if(b.type==='table'){const cols=Math.max(...b.rows.map(r=>r.length));const width=Math.floor(9638/cols);
   body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="BraandTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:firstRow="1" w:val="04A0"/></w:tblPr><w:tblGrid>${Array.from({length:cols},()=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${b.rows.map((row,r)=>`<w:tr>${r===0?'<w:trPr><w:tblHeader/></w:trPr>':''}${Array.from({length:cols},(_,c)=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${r===0?`<w:shd w:val="clear" w:color="auto" w:fill="${color}"/>`:r%2===0?'<w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/>':''}</w:tcPr>${p(runs(row[c]||'',r===0?'<w:b/><w:color w:val="FFFFFF"/>':''),'TableText')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`);body.push(p(''));}
 }
 if(sources.length){const numId=nextNum++;orderedLists.push(numId);body.push(p(runs('Sources'),'Heading2'));for(const s of sources)body.push(p(runs(s),'ListParagraph',`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`));}
 const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${OFF}"><w:body>${body.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1304" w:bottom="1418" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 const font='<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>';
 const style=(id,name,ppr,rpr,extra='')=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Title','Title','<w:spacing w:before="2400" w:after="240"/>',`<w:b/><w:color w:val="16181D"/><w:sz w:val="64"/>`)}
${style('Subtitle','Subtitle','<w:spacing w:after="480"/>',`<w:color w:val="${color}"/><w:sz w:val="32"/>`)}
${style('Author','Author','<w:spacing w:after="120"/>','<w:color w:val="5B616B"/><w:sz w:val="24"/>')}
${style('TOCHeading','TOC Heading','<w:spacing w:after="240"/>','<w:b/><w:sz w:val="36"/>')}
${style('Heading1','heading 1','<w:keepNext/><w:spacing w:before="360" w:after="200"/><w:pBdr><w:top w:val="single" w:sz="24" w:space="8" w:color="'+color+'"/></w:pBdr><w:outlineLvl w:val="0"/>','<w:b/><w:color w:val="16181D"/><w:sz w:val="40"/>','<w:next w:val="BodyText"/>')}
${style('Heading2','heading 2','<w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/>',`<w:b/><w:color w:val="${color}"/><w:sz w:val="28"/>`,'<w:next w:val="BodyText"/>')}
${style('Heading3','heading 3','<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>','<w:b/><w:sz w:val="24"/>','<w:next w:val="BodyText"/>')}
${style('BodyText','Body Text','<w:jc w:val="both"/>','')}
${style('ListParagraph','List Paragraph','<w:spacing w:after="60"/><w:ind w:left="720"/>','')}
${style('Quote','Quote','<w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="C9CED6"/></w:pBdr>','<w:i/><w:color w:val="5B616B"/>')}
${style('Callout','Callout','<w:ind w:left="284" w:right="284"/><w:spacing w:before="160" w:after="200"/><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="'+color+'"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEF4FF"/>','')}
${style('TableText','Table Text','<w:spacing w:after="0"/>','<w:sz w:val="20"/>')}
<w:style w:type="table" w:styleId="BraandTable"><w:name w:val="Braand Table"/><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="E3E6EB"/><w:insideH w:val="single" w:sz="4" w:color="E3E6EB"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="8A909A"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;
 const numbering=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:color w:val="${color}"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${orderedLists.map(id=>`<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
 const footer=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
 const settings=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W}"><w:updateFields w:val="true"/><w:defaultTabStop w:val="709"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
 const ct='application/vnd.openxmlformats-officedocument.wordprocessingml';
 return documentZip({
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${ct}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${ct}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${ct}.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="${ct}.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="${ct}.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFF}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  'docProps/core.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title><dc:creator>${x(author||'Braand')}</dc:creator><dc:language>fr-FR</dc:language></cp:coreProperties>`,
  'word/_rels/document.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${OFF}/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="${OFF}/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="${OFF}/settings" Target="settings.xml"/><Relationship Id="rIdFooter" Type="${OFF}/footer" Target="footer1.xml"/></Relationships>`,
  'word/document.xml':document,'word/styles.xml':styles,'word/numbering.xml':numbering,'word/settings.xml':settings,'word/footer1.xml':footer,
 });
}

/** "25 €", "1 200", "12,5 %", "-3.4" to a typed number with a display format. */
export function typedCell(raw){
 const text=String(raw).trim(),plain=text.replace(/\*\*/g,'');
 const m=/^(-?)\s*([€$£]?)\s*(\d{1,3}(?:[   .]\d{3})+|\d+)(?:[,.](\d+))?\s*(€|\$|£|%|k€|FCFA|XAF)?$/i.exec(plain);
 if(!m||/^0\d/.test(m[3]))return {text:plain};
 const integer=m[3].replace(/[   .]/g,''),value=Number((m[1]||'')+integer+(m[4]?'.'+m[4]:''));if(!Number.isFinite(value))return {text:plain};
 const unit=(m[5]||m[2]||'').toUpperCase();
 if(unit==='%')return {value:value/100,format:m[4]?3:12};
 if(unit==='€'||unit==='K€')return {value:unit==='K€'?value*1000:value,format:m[4]?4:5};
 if(unit==='$'||unit==='£')return {value,format:m[4]?6:7};
 if(unit==='FCFA'||unit==='XAF')return {value,format:8};
 return {value,format:m[4]?2:/[ \u00a0\u202f.]/.test(m[3])?1:11};
}

/** @param {string} markdown @param {{accent?:string,sources?:string[]}} [options] */
export function richXlsx(markdown,{accent='#2563eb',sources=[]}={}){
 const blocks=markdownBlocks(markdown),tables=[];let heading='';
 for(const b of blocks){if(b.type==='h')heading=b.text;if(b.type==='table')tables.push({name:heading,rows:b.rows});}
 // Explanations and sources travel with the figures, on a Notes sheet.
 const notes=blocks.filter(b=>b.type!=='table'&&b.type!=='hr').map(b=>[b.type==='h'?b.text:b.type==='list'?b.items.join(' ; '):b.text||'']).filter(r=>r[0]);
 const noteRows=[['Notes'],...notes,...sources.map(s=>['Source : '+s])];
 if(!tables.length)tables.push({name:'Contenu',rows:noteRows.length>1?noteRows:[['Contenu']]});
 else if(noteRows.length>1)tables.push({name:'Notes',rows:noteRows});
 if(tables.length>10||tables.some(t=>t.rows.length>5000||t.rows.some(r=>r.length>60)))throw new RangeError('Le tableau dépasse la limite de cet export.');
 const used=new Set(),sheetName=(name,i)=>{let base=(name||'Tableau '+(i+1)).replace(/[\\/?*[\]:]/g,' ').trim().slice(0,28)||'Tableau '+(i+1),n=base,k=2;while(used.has(n.toLowerCase()))n=base.slice(0,25)+' '+k++;used.add(n.toLowerCase());return n;};
 const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
 const files={},sheets=[];
 tables.forEach((table,t)=>{
  const cols=Math.max(...table.rows.map(r=>r.length)),widths=Array.from({length:cols},(_,c)=>Math.min(60,Math.max(10,...table.rows.map(r=>String(r[c]||'').length+2))));
  const rows=table.rows.map((row,r)=>`<row r="${r+1}">${Array.from({length:cols},(_,c)=>{const ref=col(c)+(r+1),raw=row[c]||'';if(r===0)return `<c r="${ref}" s="9" t="inlineStr"><is><t xml:space="preserve">${x(raw.replace(/\*\*/g,''))}</t></is></c>`;const v=typedCell(raw);return v.value!==undefined?`<c r="${ref}" s="${v.format}"><v>${v.value}</v></c>`:`<c r="${ref}" s="10" t="inlineStr"><is><t xml:space="preserve">${x(v.text)}</t></is></c>`;}).join('')}</row>`).join('');
  const last=col(cols-1)+table.rows.length;
  files[`xl/worksheets/sheet${t+1}.xml`]=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${t===0?' tabSelected="1"':''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,c)=>`<col min="${c+1}" max="${c+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData>${table.rows.length>1?`<autoFilter ref="A1:${last}"/>`:''}</worksheet>`;
  sheets.push(sheetName(table.name,t));
 });
 const color='FF'+hex(accent);
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="#,##0\\ &quot;€&quot;"/><numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="167" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="168" formatCode="#,##0\\ &quot;FCFA&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFE3E6EB"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 const sm='application/vnd.openxmlformats-officedocument.spreadsheetml';
 return documentZip({
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${sm}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${sm}.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="${sm}.worksheet+xml"/>`).join('')}</Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFF}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OFF}"><sheets>${sheets.map((name,i)=>`<sheet name="${x(name)}" sheetId="${i+1}" r:id="rIdSheet${i+1}"/>`).join('')}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}">${sheets.map((_,i)=>`<Relationship Id="rIdSheet${i+1}" Type="${OFF}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${OFF}/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml':styles,...files,
 });
}
