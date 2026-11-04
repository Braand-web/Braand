// Office documents for administrative work (secrétariat, caisse, RH) and
// Excel/Word lessons. Deterministic: real Excel formulas, drop-down lists,
// print layout, Word letterhead with the company logo, amounts in words and a
// "how to do it yourself" annex so the user learns while Braand works.
// Every text value is escaped; no macro, external link or remote resource.
import {documentZip} from './document-export.mjs';
import {amountInWords} from './amount-in-words.mjs';

const x=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const REL='http://schemas.openxmlformats.org/package/2006/relationships',OFF='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',SS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const accentHex=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value.slice(1).toUpperCase():'1F4E8C';
const BLANK='……………………………………';

// ---------- dates and numbers ----------
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const DAYS=['D','L','M','M','J','V','S'];
/** Accepts 2026-11-04, 04/11/2026 or 4/11/26. Returns null when not a real date. */
export function parseDate(value){
 const s=String(value??'').trim();let y,m,d;
 let match=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(match)[y,m,d]=[+match[1],+match[2],+match[3]];
 else if((match=s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)))[d,m,y]=[+match[1],+match[2],+(match[3].length===2?'20'+match[3]:match[3])];
 else return null;
 const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?{y,m,d}:null;
}
const serial=({y,m,d})=>Math.round((Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/86400000);
export const frDate=value=>{const p=typeof value==='object'&&value?value:parseDate(value);return p?String(p.d).padStart(2,'0')+'/'+String(p.m).padStart(2,'0')+'/'+p.y:String(value??'');};
const longDate=value=>{const p=parseDate(value);return p?(p.d===1?'1er':p.d)+' '+MONTHS[p.m-1]+' '+p.y:String(value??'');};
const money=n=>Math.round(Number(n)||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ')+' FCFA';
const num=value=>{if(typeof value==='number')return value;const n=Number(String(value??'').replace(/[\s  ]/g,'').replace(/fcfa|f\s*cfa|xaf|f$/i,'').replace(',','.'));return Number.isFinite(n)?n:null;};
const col=n=>{let s='';n++;while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;};

// ---------- XLSX writer ----------
const STYLE_NAMES=['default','title','subtitle','header','text','money','date','int','center','inText','inMoney','inDate','inCenter','totalLabel','totalMoney','totalInt','note','weekendHeader','inWeekend','label','check','wrap'];
const S=Object.fromEntries(STYLE_NAMES.map((name,i)=>[name,i]));
function stylesXml(color){
 const fonts=['<font><sz val="11"/><name val="Calibri"/></font>','<font><b/><sz val="11"/><name val="Calibri"/></font>','<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',`<font><b/><sz val="16"/><color rgb="FF${color}"/><name val="Calibri"/></font>`,'<font><i/><sz val="10"/><color rgb="FF5B616B"/><name val="Calibri"/></font>','<font><sz val="10"/><color rgb="FF5B616B"/><name val="Calibri"/></font>','<font><b/><sz val="12"/><color rgb="FF1B7F3B"/><name val="Calibri"/></font>'];
 const fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>',`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`,'<fill><patternFill patternType="solid"><fgColor rgb="FFFFF7D6"/><bgColor indexed="64"/></patternFill></fill>','<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill>','<fill><patternFill patternType="solid"><fgColor rgb="FFE4E7EC"/><bgColor indexed="64"/></patternFill></fill>'];
 const borders=['<border><left/><right/><top/><bottom/><diagonal/></border>','<border><left style="thin"><color rgb="FFC9CFD8"/></left><right style="thin"><color rgb="FFC9CFD8"/></right><top style="thin"><color rgb="FFC9CFD8"/></top><bottom style="thin"><color rgb="FFC9CFD8"/></bottom><diagonal/></border>'];
 const xf=({font=0,fill=0,border=0,fmt=0,h='',wrap=false,input=false}={})=>`<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt?' applyNumberFormat="1"':''}${font?' applyFont="1"':''}${fill?' applyFill="1"':''}${border?' applyBorder="1"':''} applyAlignment="1" applyProtection="1"><alignment vertical="center"${h?` horizontal="${h}"`:''}${wrap?' wrapText="1"':''}/><protection locked="${input?0:1}"/></xf>`;
 const defs={default:{},title:{font:3},subtitle:{font:5},header:{font:2,fill:2,border:1,h:'center',wrap:true},text:{border:1,wrap:true},money:{border:1,fmt:164},date:{border:1,fmt:165,h:'center'},int:{border:1,fmt:3,h:'center'},center:{border:1,h:'center'},inText:{fill:3,border:1,input:true,wrap:true},inMoney:{fill:3,border:1,fmt:164,input:true},inDate:{fill:3,border:1,fmt:165,h:'center',input:true},inCenter:{fill:3,border:1,h:'center',input:true},totalLabel:{font:1,fill:4,border:1},totalMoney:{font:1,fill:4,border:1,fmt:164},totalInt:{font:1,fill:4,border:1,fmt:3,h:'center'},note:{font:4,wrap:true},weekendHeader:{font:1,fill:5,border:1,h:'center'},inWeekend:{fill:5,border:1,h:'center',input:true},label:{font:1},check:{font:6,border:1,wrap:true},wrap:{wrap:true}};
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${SS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0 &quot;FCFA&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${STYLE_NAMES.length}">${STYLE_NAMES.map(name=>xf(defs[name])).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
function cellXml(ref,cell){
 if(cell===null||cell===undefined)return '';
 const c=typeof cell==='object'?cell:{v:cell};const s=S[c.s||'default']??0;
 if(c.f)return `<c r="${ref}" s="${s}"${c.str?' t="str"':''}><f>${x(c.f)}</f></c>`;
 if(c.v===undefined||c.v===null||c.v==='')return s?`<c r="${ref}" s="${s}"/>`:'';
 if(typeof c.v==='number')return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
 return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(c.v)}</t></is></c>`;
}
function sheetXml(sheet){
 const rows=sheet.rows.map((row,r)=>{const cells=(row||[]).map((cell,c)=>cellXml(col(c)+(r+1),cell)).join('');const height=sheet.heights?.[r];return cells||height?`<row r="${r+1}"${height?` ht="${height}" customHeight="1"`:''}>${cells}</row>`:'';}).join('');
 const width=Math.max(1,...sheet.rows.map(row=>(row||[]).length)),last=col(width-1)+Math.max(1,sheet.rows.length);
 const freeze=sheet.freeze?`<pane ${sheet.freeze.col?`xSplit="${sheet.freeze.col}" `:''}ySplit="${sheet.freeze.row}" topLeftCell="${col(sheet.freeze.col||0)}${sheet.freeze.row+1}" activePane="bottomRight" state="frozen"/>`:'';
 const validations=(sheet.validations||[]).map(v=>`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"${v.prompt?` promptTitle="Choisir" prompt="${x(v.prompt)}"`:''} errorTitle="Valeur non prévue" error="Choisissez une valeur dans la liste." sqref="${v.sqref}"><formula1>${v.ref?x(v.ref):'&quot;'+x(v.list.join(','))+'&quot;'}</formula1></dataValidation>`).join('');
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${SS}" xmlns:r="${OFF}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"${sheet.zoom?` zoomScale="${sheet.zoom}"`:''}${sheet.hideGrid?' showGridLines="0"':''}>${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${sheet.cols?.length?`<cols>${sheet.cols.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`:''}<sheetData>${rows}</sheetData>${sheet.merges?.length?`<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`:''}${validations?`<dataValidations count="${sheet.validations.length}">${validations}</dataValidations>`:''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.landscape?'landscape':'portrait'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${x(sheet.footer||'')}&amp;RPage &amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
}
/** sheets: [{name, rows, cols, merges, validations, freeze, landscape, printTitles:'5:5', hidden}] */
export function buildXlsx(sheets,{accent,title='Classeur',author='Braand'}={}){
 const color=accentHex(accent),names=sheets.map(s=>s.name.replace(/[\\/?*[\]:]/g,' ').slice(0,31));
 const files={
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFF}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  'docProps/core.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title><dc:creator>${x(author)}</dc:creator><dc:language>fr-FR</dc:language></cp:coreProperties>`,
  'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${OFF}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${OFF}/styles" Target="styles.xml"/></Relationships>`,
  'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${SS}" xmlns:r="${OFF}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((name,i)=>`<sheet name="${x(name)}" sheetId="${i+1}"${sheets[i].hidden?' state="hidden"':''} r:id="rId${i+1}"/>`).join('')}</sheets>${sheets.some(s=>s.printTitles)?`<definedNames>${sheets.map((s,i)=>s.printTitles?`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${x(names[i])}'!$${s.printTitles.replace(':',':$')}</definedName>`:'').join('')}</definedNames>`:''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  'xl/styles.xml':stylesXml(color),
 };
 sheets.forEach((sheet,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(sheet);});
 return documentZip(files);
}

// ---------- shared Excel blocks ----------
const companyHeader=(company,title,width)=>{
 const lines=[[{v:company.name||'Votre entreprise',s:'label'}],[{v:[company.address,company.city].filter(Boolean).join(' – ')||'',s:'subtitle'}],[{v:title,s:'title'}]];
 return {rows:lines,merges:[`A1:${col(width-1)}1`,`A2:${col(width-1)}2`,`A3:${col(width-1)}3`],heights:{2:24}};
};
function howToSheet(title,steps,formulas=[]){
 const rows=[[{v:'Comment le refaire vous-même — '+title,s:'title'}],[{v:'Suivez les étapes dans Excel. Les cellules jaunes sont à remplir, les autres se calculent toutes seules.',s:'note'}],[],[{v:'N°',s:'header'},{v:'Étape',s:'header'}]];
 steps.forEach((step,i)=>rows.push([{v:i+1,s:'center'},{v:step,s:'text'}]));
 if(formulas.length){rows.push([],[{v:'Formule',s:'header'},{v:'Ce qu’elle fait (noms des fonctions dans Excel en français)',s:'header'}]);for(const [formula,meaning] of formulas)rows.push([{v:formula,s:'text'},{v:meaning,s:'text'}]);}
 rows.push([],[{v:'Astuce : Ctrl+Z annule, F2 modifie une cellule, Ctrl+P imprime. Une formule commence toujours par =.',s:'note'}]);
 return {name:'Comment le refaire',rows,cols:[22,96],merges:['A1:B1','A2:B2'],hideGrid:true};
}

// SYSCOHADA-oriented default categories for a small office's cash book.
export const TREASURY_CATEGORIES=['Encaissement client / honoraires','Apport ou approvisionnement','Retrait banque vers caisse','Salaires et primes','Loyer et charges','Carburant et transport','Fournitures de bureau','Électricité et eau','Téléphone et internet','Impôts et taxes','Frais bancaires','Missions et déplacements','Entretien et réparations','Divers'];

/** Journal de trésorerie with running balance, monthly totals and a summary by category. */
function journalWorkbook(company,data,learn){
 const width=8,head=companyHeader(company,'Journal de trésorerie'+(data.period?' — '+data.period:''),width);
 const rows=[...head.rows,[{v:'Compte',s:'label'},{v:data.account||'571 Caisse',s:'inText'},null,null,{v:'Solde initial',s:'label'},{v:num(data.openingBalance)??0,s:'inMoney'}],[]];
 const headerRow=rows.length;rows.push(['Date','N° pièce','Libellé','Catégorie','Mode','Entrée (FCFA)','Sortie (FCFA)','Solde (FCFA)'].map(v=>({v,s:'header'})));
 const first=rows.length+1,entries=(data.entries||[]).slice(0,500),count=Math.max(entries.length+15,40),last=first+count-1;
 for(let i=0;i<count;i++){const r=first+i,e=entries[i]||{},d=parseDate(e.date);
  rows.push([d?{v:serial(d),s:'inDate'}:{s:'inDate'},{v:e.piece||'',s:'inCenter'},{v:e.label||'',s:'inText'},{v:e.category||'',s:'inText'},{v:e.mode||'',s:'inCenter'},{v:num(e.in)||'',s:'inMoney'},{v:num(e.out)||'',s:'inMoney'},{f:`IF(AND(F${r}="",G${r}=""),"",$F$4+SUM($F$${first}:F${r})-SUM($G$${first}:G${r}))`,s:'money'}]);}
 const total=rows.length+1;
 rows.push([{v:'Totaux',s:'totalLabel'},{s:'totalLabel'},{s:'totalLabel'},{s:'totalLabel'},{s:'totalLabel'},{f:`SUM(F${first}:F${last})`,s:'totalMoney'},{f:`SUM(G${first}:G${last})`,s:'totalMoney'},{f:`$F$4+F${total}-G${total}`,s:'totalMoney'}]);
 rows.push([],[{v:'Solde final de la période',s:'label'},null,{f:`H${total}`,s:'totalMoney'}],[{v:'Contrôle : le solde final doit être égal à l’argent réellement en caisse (ou au relevé bancaire).',s:'note'}]);
 const categories=(data.categories?.length?data.categories:TREASURY_CATEGORIES).slice(0,40);
 const lists={name:'Listes',rows:[[{v:'Catégories',s:'header'},{v:'Modes de paiement',s:'header'}],...Array.from({length:Math.max(categories.length,5)},(_,i)=>[{v:categories[i]||'',s:'text'},{v:['Espèces','Chèque','Virement','Mobile money','Carte'][i]||'',s:'text'}])],cols:[40,22]};
 const summaryRows=[[{v:'Récapitulatif par catégorie',s:'title'}],[],[{v:'Catégorie',s:'header'},{v:'Entrées',s:'header'},{v:'Sorties',s:'header'},{v:'Net',s:'header'}]];
 categories.forEach((cat,i)=>{const r=summaryRows.length+1;summaryRows.push([{f:`Listes!A${i+2}`,s:'text',str:true},{f:`SUMIFS(Journal!$F$${first}:$F$${last},Journal!$D$${first}:$D$${last},A${r})`,s:'money'},{f:`SUMIFS(Journal!$G$${first}:$G$${last},Journal!$D$${first}:$D$${last},A${r})`,s:'money'},{f:`B${r}-C${r}`,s:'money'}]);});
 const sr=summaryRows.length;summaryRows.push([{v:'Total',s:'totalLabel'},{f:`SUM(B4:B${sr})`,s:'totalMoney'},{f:`SUM(C4:C${sr})`,s:'totalMoney'},{f:`B${sr+1}-C${sr+1}`,s:'totalMoney'}]);
 const sheets=[{name:'Journal',rows,cols:[12,11,38,30,14,16,16,18],merges:head.merges,heights:head.heights,freeze:{row:headerRow+1},printTitles:`${headerRow+1}:${headerRow+1}`,landscape:true,footer:company.name||'',validations:[{sqref:`D${first}:D${last}`,ref:`Listes!$A$2:$A$${categories.length+1}`,prompt:'Choisissez la catégorie'},{sqref:`E${first}:E${last}`,ref:'Listes!$B$2:$B$6'}]},{name:'Récapitulatif',rows:summaryRows,cols:[40,18,18,18],merges:['A1:D1']},lists];
 if(learn)sheets.push(howToSheet('Journal de trésorerie',['Saisissez le solde initial en F4 : l’argent en caisse au premier jour de la période.','Pour chaque mouvement, remplissez une ligne jaune : date (JJ/MM/AAAA), numéro de la pièce justificative, libellé clair.','Choisissez la catégorie dans la liste déroulante (cliquez sur la petite flèche à droite de la cellule).','Mettez le montant soit dans Entrée, soit dans Sortie, jamais les deux sur la même ligne.','La colonne Solde se calcule seule. Pour voir la formule, cliquez sur une cellule de la colonne H et regardez la barre de formule en haut.','En fin de mois, comptez la caisse : le solde final (ligne Totaux) doit être égal à l’argent réel. Sinon, cherchez une ligne oubliée ou inversée.','L’onglet Récapitulatif additionne automatiquement les entrées et sorties par catégorie : c’est ce que le patron regarde.','Pour ajouter une catégorie, écrivez-la à la suite dans l’onglet Listes, colonne A.'],[['=SOMME(F7:F46)','SOMME additionne une plage de cellules (ici toutes les entrées).','=SI(ET(F7="";G7="");"";…)','SI teste une condition : si la ligne est vide, on n’affiche rien, sinon on calcule le solde.'],['=$F$4+SOMME($F$7:F7)-SOMME($G$7:G7)','Solde cumulé : solde initial + toutes les entrées jusqu’à cette ligne − toutes les sorties. Les $ figent F4 et le début de la plage quand on recopie la formule vers le bas.'],['=SOMME.SI.ENS(Journal!F:F;Journal!D:D;A4)','Additionne les entrées dont la catégorie est celle de la ligne : c’est le récapitulatif.']]));
 return sheets;
}

/** Monthly attendance sheet with drop-downs and automatic counts. */
function attendanceWorkbook(company,data,learn){
 const now=new Date(),month=Math.min(12,Math.max(1,Number(data.month)||now.getUTCMonth()+1)),year=Number(data.year)||now.getUTCFullYear();
 const days=new Date(Date.UTC(year,month,0)).getUTCDate(),staff=(data.staff?.length?data.staff:Array.from({length:10},()=>({}))).slice(0,200);
 const width=2+days+4,head=companyHeader(company,`Fiche de présence — ${MONTHS[month-1]} ${year}`,width);
 const rows=[...head.rows,[{v:'Codes : P = présent, A = absent, R = retard, C = congé, M = mission, F = férié',s:'note'}],[]];
 const headerRow=rows.length+1,weekend=d=>[0,6].includes(new Date(Date.UTC(year,month-1,d)).getUTCDay());
 rows.push([{v:'Nom et prénom',s:'header'},{v:'Fonction',s:'header'},...Array.from({length:days},(_,i)=>({v:DAYS[new Date(Date.UTC(year,month-1,i+1)).getUTCDay()]+' '+(i+1),s:weekend(i+1)?'weekendHeader':'header'})),...['Présences','Absences','Retards','Congés/Missions'].map(v=>({v,s:'header'}))]);
 const first=headerRow+1,last=first+staff.length-1,dc=c=>col(2+c),lastDay=dc(days-1);
 staff.forEach((p,i)=>{const r=first+i;rows.push([{v:p.name||'',s:'inText'},{v:p.role||'',s:'inText'},...Array.from({length:days},(_,d)=>({v:'',s:weekend(d+1)?'inWeekend':'inCenter'})),{f:`COUNTIF(C${r}:${lastDay}${r},"P")+COUNTIF(C${r}:${lastDay}${r},"R")`,s:'int'},{f:`COUNTIF(C${r}:${lastDay}${r},"A")`,s:'int'},{f:`COUNTIF(C${r}:${lastDay}${r},"R")`,s:'int'},{f:`COUNTIF(C${r}:${lastDay}${r},"C")+COUNTIF(C${r}:${lastDay}${r},"M")`,s:'int'}]);});
 rows.push([{v:'Présents du jour',s:'totalLabel'},{s:'totalLabel'},...Array.from({length:days},(_,d)=>({f:`COUNTIF(${dc(d)}${first}:${dc(d)}${last},"P")+COUNTIF(${dc(d)}${first}:${dc(d)}${last},"R")`,s:'totalInt'})),{f:`SUM(${col(2+days)}${first}:${col(2+days)}${last})`,s:'totalInt'},{f:`SUM(${col(3+days)}${first}:${col(3+days)}${last})`,s:'totalInt'},{f:`SUM(${col(4+days)}${first}:${col(4+days)}${last})`,s:'totalInt'},{f:`SUM(${col(5+days)}${first}:${col(5+days)}${last})`,s:'totalInt'}]);
 rows.push([],[{v:'Visa du responsable :',s:'label'}]);
 const sheets=[{name:'Présence',rows,cols:[28,18,...Array(days).fill(4.6),10,10,9,13],merges:[...head.merges,`A4:${col(width-1)}4`],heights:head.heights,freeze:{row:headerRow,col:2},landscape:true,printTitles:`${headerRow}:${headerRow}`,footer:company.name||'',validations:[{sqref:`C${first}:${lastDay}${last}`,list:['P','A','R','C','M','F'],prompt:'P, A, R, C, M ou F'}]}];
 if(learn)sheets.push(howToSheet('Fiche de présence',['Écrivez les noms du personnel dans la colonne A (une personne par ligne) et la fonction en colonne B.','Chaque jour, cliquez dans la case de la personne et choisissez le code dans la liste : P, A, R, C, M ou F.','Les colonnes grisées sont les week-ends.','Les totaux à droite et la ligne « Présents du jour » se calculent seuls.','Pour le mois suivant, faites un clic droit sur l’onglet › Déplacer ou copier › cocher « Créer une copie », puis effacez les codes (sélectionnez la zone et touche Suppr).','Impression : Fichier › Imprimer ; la fiche est déjà réglée en paysage sur une page de large.'],[['=NB.SI(C7:AG7;"A")','NB.SI compte les cellules qui contiennent une valeur : ici le nombre de « A » (absences) de la personne.'],['=NB.SI(…;"P")+NB.SI(…;"R")','Un retard compte comme une présence : on additionne les deux comptages.']]));
 return sheets;
}

/** Cash voucher as a printable Excel form (two copies per page). */
function voucherWorkbook(company,data,learn){
 const width=6,head=companyHeader(company,'Bon de décaissement',width),amount=num(data.amount);
 const rows=[...head.rows,[]];
 const field=(label,value,style='inText')=>[{v:label,s:'label'},{v:value??'',s:style},null,null,null,null];
 rows.push(field('N° du bon',data.number||''),field('Date',parseDate(data.date)?serial(parseDate(data.date)):'',parseDate(data.date)?'inDate':'inText'),field('Bénéficiaire',data.beneficiary||''),field('Motif',data.purpose||''),field('Imputation',data.account||''),field('Mode de paiement',data.mode||'Espèces'),[{v:'Montant',s:'label'},{v:amount??'',s:'inMoney'}],[{v:'Montant en lettres',s:'label'},{v:amount!==null?amountInWords(amount):'',s:'inText'}],[]);
 const sig=rows.length+1;rows.push([{v:'Le bénéficiaire',s:'header'},{v:'Le caissier',s:'header'},{v:'Le responsable',s:'header'}],[{v:'',s:'text'},{v:'',s:'text'},{v:'',s:'text'}]);
 const merges=[...head.merges];for(let r=5;r<=12;r++)merges.push(`B${r}:F${r}`);merges.push(`C${sig}:F${sig}`,`C${sig+1}:F${sig+1}`);
 const sheets=[{name:'Bon',rows,cols:[22,22,12,12,12,12],merges,heights:{...head.heights,[sig]:60},footer:company.name||''}];
 if(learn)sheets.push(howToSheet('Bon de décaissement',['Remplissez les cellules jaunes : numéro, date, bénéficiaire, motif et montant.','Le montant en lettres évite les falsifications : écrivez-le toujours en toutes lettres (Braand le calcule pour vous dans le document Word).','Faites signer le bénéficiaire, le caissier et le responsable avant de sortir l’argent.','Reportez ensuite la sortie dans le journal de trésorerie avec le même numéro de pièce.','Pour fusionner des cellules comme ici : sélectionnez-les › Accueil › Fusionner et centrer.']));
 return sheets;
}

// ---------- Excel lessons with automatic correction ----------
const ok='"✔ Correct, bravo !"';
export const EXCEL_LESSONS={
 somme:{title:'Leçon 1 — Additionner avec SOMME',goal:'Calculer le total des dépenses de la semaine.',data:[['Jour','Dépense (FCFA)'],['Lundi',12500],['Mardi',8000],['Mercredi',15750],['Jeudi',4300],['Vendredi',22000]],task:'Dans la cellule jaune B8, tapez =SOMME(B3:B7) puis Entrée.',answer:'B8',check:'IF(AND(ISFORMULA(B8),B8=SUM(B3:B7)),'+ok+',"✘ Pas encore : tapez =SOMME(B3:B7) dans B8")',solution:'=SOMME(B3:B7)'},
 solde:{title:'Leçon 2 — Solde cumulé et références',goal:'Calculer le solde de la caisse après chaque opération.',data:[['Opération','Entrée','Sortie','Solde'],['Solde initial','','',50000],['Vente',25000,'',''],['Carburant','',10000,''],['Fournitures','',7500,''],['Encaissement',40000,'','']],task:'En D4, tapez =D3+B4-C4 puis recopiez vers le bas jusqu’à D7 (tirez le petit carré en bas à droite de la cellule).',answer:'D7',check:'IF(AND(ISFORMULA(D7),D7=D3+SUM(B4:B7)-SUM(C4:C7)),'+ok+',"✘ Pas encore : en D4 tapez =D3+B4-C4 puis recopiez jusqu’à D7")',solution:'=D6+B7-C7',answerRange:'D4:D7'},
 si:{title:'Leçon 3 — Décider avec SI',goal:'Afficher « À payer » quand une facture n’est pas réglée.',data:[['Facture','Montant','Payé ?','Statut'],['F-001',150000,'Oui',''],['F-002',85000,'Non',''],['F-003',230000,'Non',''],['F-004',60000,'Oui','']],task:'En D3, tapez =SI(C3="Oui";"Réglée";"À payer") puis recopiez jusqu’à D6.',answer:'D6',check:'IF(AND(ISFORMULA(D6),D6=IF(C6="Oui","Réglée","À payer"),D4=IF(C4="Oui","Réglée","À payer")),'+ok+',"✘ Pas encore : en D3 tapez =SI(C3=""Oui"";""Réglée"";""À payer"") et recopiez")',solution:'=SI(C6="Oui";"Réglée";"À payer")',answerRange:'D3:D6'},
 nbsi:{title:'Leçon 4 — Compter avec NB.SI',goal:'Compter les absences d’un employé.',data:[['Jour','Code'],['01/11','P'],['02/11','A'],['03/11','P'],['04/11','R'],['05/11','A'],['06/11','P']],task:'En B10, tapez =NB.SI(B3:B8;"A") pour compter les absences.',answer:'B10',check:'IF(AND(ISFORMULA(B10),B10=COUNTIF(B3:B8,"A")),'+ok+',"✘ Pas encore : tapez =NB.SI(B3:B8;""A"") dans B10")',solution:'=NB.SI(B3:B8;"A")'},
 sommesi:{title:'Leçon 5 — Totaliser par catégorie avec SOMME.SI',goal:'Savoir combien on a dépensé en carburant.',data:[['Libellé','Catégorie','Montant'],['Plein véhicule','Carburant',30000],['Rame de papier','Fournitures',4500],['Plein moto','Carburant',8000],['Stylos','Fournitures',2500],['Gasoil groupe','Carburant',15000]],task:'En C10, tapez =SOMME.SI(B3:B7;"Carburant";C3:C7).',answer:'C10',check:'IF(AND(ISFORMULA(C10),C10=SUMIF(B3:B7,"Carburant",C3:C7)),'+ok+',"✘ Pas encore : tapez =SOMME.SI(B3:B7;""Carburant"";C3:C7) dans C10")',solution:'=SOMME.SI(B3:B7;"Carburant";C3:C7)'},
 absolue:{title:'Leçon 6 — Références absolues avec $',goal:'Calculer la TVA de chaque ligne avec un taux unique.',headerIndex:2,data:[['Taux de TVA',0.1925],['',''],['Article','Prix HT','TVA'],['Ordinateur',350000,''],['Imprimante',120000,''],['Onduleur',75000,'']],task:'En C5, tapez =B5*$B$2 puis recopiez jusqu’à C7. Le $ garde le taux fixe quand vous recopiez.',answer:'C7',check:'IF(AND(ISFORMULA(C7),ROUND(C7,0)=ROUND(B7*B2,0),ROUND(C6,0)=ROUND(B6*B2,0)),'+ok+',"✘ Pas encore : en C5 tapez =B5*$B$2 et recopiez jusqu’à C7")',solution:'=B7*$B$2',answerRange:'C5:C7'},
 recherchev:{title:'Leçon 7 — Retrouver une information avec RECHERCHEV',goal:'Retrouver la fonction d’un employé à partir de son matricule.',data:[['Matricule','Nom','Fonction'],['M01','Awa Ndiaye','Comptable'],['M02','Paul Mbarga','Chauffeur'],['M03','Fatou Diallo','Secrétaire'],['',''],['Matricule cherché','M02']],task:'En C7, tapez =RECHERCHEV(B7;A3:C5;3;FAUX) pour trouver la fonction de M02.',answer:'C7',check:'IF(AND(ISFORMULA(C7),C7=VLOOKUP(B7,A3:C5,3,FALSE)),'+ok+',"✘ Pas encore : tapez =RECHERCHEV(B7;A3:C5;3;FAUX) dans C7")',solution:'=RECHERCHEV(B7;A3:C5;3;FAUX)'},
 pourcentage:{title:'Leçon 8 — Pourcentages',goal:'Calculer la part de chaque poste dans le budget.',data:[['Poste','Montant','Part'],['Salaires',600000,''],['Loyer',200000,''],['Transport',100000,''],['Total','','']],task:'En B6 tapez =SOMME(B3:B5). En C3 tapez =B3/$B$6, recopiez jusqu’à C5, puis cliquez sur Accueil › % pour afficher en pourcentage.',answer:'C5',check:'IF(AND(ISFORMULA(C5),ISFORMULA(B6),ROUND(C5,4)=ROUND(B5/SUM(B3:B5),4)),'+ok+',"✘ Pas encore : B6 =SOMME(B3:B5) puis C3 =B3/$B$6 recopiée jusqu’à C5")',solution:'=B5/$B$6 (et =SOMME(B3:B5) en B6)',answerRange:'C3:C5',inputs:['B6']},
};
function lessonWorkbook(id){
 // Layout: row 1 title, data from row 2 (cell references in the lesson assume it).
 const lesson=EXCEL_LESSONS[id];if(!lesson)throw new RangeError('Leçon inconnue.');
 const header=lesson.headerIndex??0,rows=[[{v:lesson.title,s:'title'}]];
 lesson.data.forEach((row,i)=>rows.push(row.map(v=>({v,s:i===header?'header':typeof v==='number'?(v>0&&v<1?'text':'money'):'text'}))));
 const put=(ref,cell)=>{const c=ref.match(/[A-Z]+/)[0],r=+ref.slice(c.length)-1,ci=c.charCodeAt(0)-65;while(rows.length<=r)rows.push([]);rows[r]=rows[r]||[];rows[r][ci]=cell;};
 const answerCells=new Set(lesson.inputs||[]);
 if(lesson.answerRange){const [a,b]=lesson.answerRange.split(':');const c=a.match(/[A-Z]+/)[0];for(let r=+a.slice(c.length);r<=+b.slice(c.length);r++)answerCells.add(c+r);}else answerCells.add(lesson.answer);
 for(const ref of answerCells)put(ref,{v:'',s:'inMoney'});
 const after=Math.max(rows.length,...[...answerCells].map(ref=>+ref.replace(/[A-Z]+/,'')))+2;
 put('A'+after,{v:'Objectif : '+lesson.goal,s:'note'});put('A'+(after+1),{v:'À faire : '+lesson.task,s:'note'});
 put('A'+(after+2),{v:'Vérification',s:'label'});put('B'+(after+2),{f:lesson.check.replace(/ISFORMULA\(/g,'_xlfn.ISFORMULA('),s:'check',str:true});
 put('A'+(after+4),{v:'Bloqué ? La solution est dans l’onglet caché « Solution » : clic droit sur un onglet › Afficher.',s:'note'});
 return [{name:'Exercice',rows,cols:[26,22,16,16],merges:['A1:D1',`A${after}:D${after}`,`A${after+1}:D${after+1}`,`B${after+2}:D${after+2}`,`A${after+4}:D${after+4}`],heights:{[after]:36,[after+1]:30}},{name:'Solution',hidden:true,rows:[[{v:'Solution',s:'title'}],[{v:'Formule à taper dans '+lesson.answer+(lesson.answerRange?' (puis recopier sur '+lesson.answerRange+')':'')+' :',s:'label'}],[{v:lesson.solution,s:'text'}]],cols:[70]}];
}

// ---------- Word form documents ----------
function imageSize(bytes){
 if(bytes[0]===0x89&&bytes[1]===0x50){const v=new DataView(bytes.buffer,bytes.byteOffset);return {w:v.getUint32(16),h:v.getUint32(20),ext:'png'};}
 if(bytes[0]===0xff&&bytes[1]===0xd8){let i=2;while(i<bytes.length-9){if(bytes[i]!==0xff){i++;continue;}const marker=bytes[i+1],len=(bytes[i+2]<<8)|bytes[i+3];if(marker>=0xc0&&marker<=0xc3)return {h:(bytes[i+5]<<8)|bytes[i+6],w:(bytes[i+7]<<8)|bytes[i+8],ext:'jpeg'};i+=2+len;}}
 return null;
}
const run=(text,{b=false,i=false,size=0,color=''}={})=>`<w:r><w:rPr>${b?'<w:b/>':''}${i?'<w:i/>':''}${color?`<w:color w:val="${color}"/>`:''}${size?`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`:''}</w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
const para=(content,{align='',after=120,before=0,keep=false,style=''}={})=>`<w:p><w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${keep?'<w:keepNext/>':''}<w:spacing w:before="${before}" w:after="${after}"/>${align?`<w:jc w:val="${align}"/>`:''}</w:pPr>${content}</w:p>`;
const cell=(content,{width,fill='',borders=true,valign='center'}={})=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${borders?'':'<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>'}${fill?`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`:''}<w:vAlign w:val="${valign}"/></w:tcPr>${content}</w:tc>`;
const table=(rows,widths,{borders=true}={})=>`<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a,b)=>a+b,0)}" w:type="dxa"/>${borders?'<w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9CFD8"/><w:left w:val="single" w:sz="4" w:color="C9CFD8"/><w:bottom w:val="single" w:sz="4" w:color="C9CFD8"/><w:right w:val="single" w:sz="4" w:color="C9CFD8"/><w:insideH w:val="single" w:sz="4" w:color="C9CFD8"/><w:insideV w:val="single" w:sz="4" w:color="C9CFD8"/></w:tblBorders>':''}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;

/** Form document spec → DOCX bytes. blocks: fields, para, heading, table, signatures, placeDate, spacer, howTo */
export function buildFormDocx(spec){
 const color=accentHex(spec.accent),company=spec.company||{},logo=company.logo&&company.logo.bytes?company.logo:null,size=logo?imageSize(logo.bytes):null;
 const body=[];
 body.push(para(run(spec.title.toUpperCase(),{b:true,size:30,color}),{align:'center',before:120,after:spec.number?60:240}));
 if(spec.number)body.push(para(run('N° '+spec.number,{b:true,size:22}),{align:'center',after:240}));
 for(const block of spec.blocks){
  if(block.type==='heading')body.push(para(run(block.text,{b:true,size:24,color}),{before:200,after:100,keep:true}));
  else if(block.type==='para')body.push(para(run(block.text,{b:block.bold}),{align:block.align||'both',after:block.after??140}));
  else if(block.type==='spacer')body.push(para('',{after:block.size||200}));
  else if(block.type==='fields')body.push(table(block.rows.map(([label,value])=>`<w:tr>${cell(para(run(label,{b:true,size:20}),{after:0}),{width:3200,fill:'EEF2F7'})}${cell(para(run(value===''||value===undefined||value===null?BLANK:String(value),{size:21}),{after:0}),{width:6400})}</w:tr>`),[3200,6400]),para('',{after:120}));
  else if(block.type==='table'){const n=block.header.length,widths=block.widths||Array(n).fill(Math.floor(9600/n));body.push(table([`<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.header.map((t,i)=>cell(para(run(t,{b:true,color:'FFFFFF',size:20}),{after:0}),{width:widths[i],fill:color})).join('')}</w:tr>`,...block.rows.map(row=>`<w:tr>${row.map((t,i)=>cell(para(run(t??'',{size:20}),{after:0,align:block.align?.[i]||''}),{width:widths[i]})).join('')}</w:tr>`)],widths),para('',{after:120}));}
  else if(block.type==='placeDate')body.push(para(run(block.text),{align:'right',before:200,after:240}));
  else if(block.type==='signatures'){const n=block.items.length,w=Math.floor(9600/n);body.push(table([`<w:tr>${block.items.map(item=>cell(para(run(item.label,{b:true,size:20}),{align:'center',after:0})+para(run(item.name||'',{size:20}),{align:'center',after:0}),{width:w,borders:false,valign:'top'})).join('')}</w:tr>`,`<w:tr><w:trPr><w:trHeight w:val="1300"/></w:trPr>${block.items.map(()=>cell(para('',{after:0}),{width:w,borders:false})).join('')}</w:tr>`],Array(n).fill(w),{borders:false}));}
 }
 if(spec.howTo?.length){body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');body.push(para(run('Comment le refaire vous-même dans Word',{b:true,size:28,color}),{after:160}));body.push(para(run('Cette page est un aide-mémoire : supprimez-la avant d’imprimer (cliquez au début de la page, Ctrl+Maj+Fin, puis Suppr).',{i:true,size:19,color:'5B616B'}),{after:160}));spec.howTo.forEach((step,i)=>body.push(para(run((i+1)+'. ',{b:true})+run(step),{after:100})));}
 const footerText=[company.name,company.rccm?'RCCM : '+company.rccm:'',company.niu?'NIU : '+company.niu:'',company.phone?'Tél. : '+company.phone:'',company.email].filter(Boolean).join(' · ');
 const emu=cm=>Math.round(cm*360000),logoH=1.7,logoW=size?Math.min(5,logoH*size.w/Math.max(1,size.h)):0;
 const drawing=logo&&size?`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${emu(logoW)}" cy="${emu(logoH)}"/><wp:docPr id="1" name="Logo"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="logo.${size.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo" xmlns:r="${OFF}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(logoW)}" cy="${emu(logoH)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`:'';
 const ident=[run(company.name||'',{b:true,size:24,color}),...[company.address,company.city,company.phone?'Tél. : '+company.phone:'',company.email].filter(Boolean).map(line=>'<w:r><w:br/></w:r>'+run(line,{size:18,color:'5B616B'}))].join('');
 const header=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}" xmlns:r="${OFF}">${table([`<w:tr>${cell(para(drawing,{after:0}),{width:3000,borders:false})}${cell(para(ident,{align:'right',after:0}),{width:6600,borders:false})}</w:tr>`],[3000,6600],{borders:false})}<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="${color}"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p></w:hdr>`;
 const footer=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}"><w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="C9CFD8"/></w:pBdr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>${run(footerText,{size:16,color:'8A909A'})}</w:p></w:ftr>`;
 const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${OFF}"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1800" w:right="1134" w:bottom="1300" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
 const ct='application/vnd.openxmlformats-officedocument.wordprocessingml';
 const files={
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logo&&size?`<Default Extension="${size.ext==='png'?'png':'jpeg'}" ContentType="image/${size.ext}"/>`:''}<Override PartName="/word/document.xml" ContentType="${ct}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${ct}.styles+xml"/><Override PartName="/word/header1.xml" ContentType="${ct}.header+xml"/><Override PartName="/word/footer1.xml" ContentType="${ct}.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFF}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  'docProps/core.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(spec.title)}</dc:title><dc:creator>${x(company.name||'Braand')}</dc:creator><dc:language>fr-FR</dc:language></cp:coreProperties>`,
  'word/_rels/document.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${OFF}/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="${OFF}/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="${OFF}/footer" Target="footer1.xml"/></Relationships>`,
  'word/document.xml':document,'word/styles.xml':styles,'word/header1.xml':header,'word/footer1.xml':footer,
 };
 if(logo&&size){files['word/_rels/header1.xml.rels']=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rIdLogo" Type="${OFF}/image" Target="media/logo.${size.ext}"/></Relationships>`;files['word/media/logo.'+size.ext]=logo.bytes;}
 return documentZip(files);
}

/** Same form spec → printable HTML (Chromium renders it to PDF). */
export function buildFormHtml(spec){
 const color='#'+accentHex(spec.accent),company=spec.company||{},logo=company.logoDataUri&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(company.logoDataUri)?company.logoDataUri:'';
 const blocks=spec.blocks.map(block=>{
  if(block.type==='heading')return `<h2>${h(block.text)}</h2>`;
  if(block.type==='para')return `<p class="${block.bold?'b':''}" style="text-align:${block.align||'justify'}">${h(block.text)}</p>`;
  if(block.type==='spacer')return '<div style="height:10mm"></div>';
  if(block.type==='fields')return `<table class="fields">${block.rows.map(([l,v])=>`<tr><th>${h(l)}</th><td>${v===''||v===undefined||v===null?BLANK:h(v)}</td></tr>`).join('')}</table>`;
  if(block.type==='table')return `<table class="grid"><thead><tr>${block.header.map(t=>`<th>${h(t)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(r=>`<tr>${r.map((t,i)=>`<td style="text-align:${block.align?.[i]==='right'?'right':'left'}">${h(t??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if(block.type==='placeDate')return `<p class="place">${h(block.text)}</p>`;
  if(block.type==='signatures')return `<div class="sigs">${block.items.map(i=>`<div><strong>${h(i.label)}</strong><span>${h(i.name||'')}</span></div>`).join('')}</div>`;
  return '';
 }).join('');
 const footer=[company.name,company.rccm?'RCCM : '+company.rccm:'',company.niu?'NIU : '+company.niu:'',company.phone?'Tél. : '+company.phone:'',company.email].filter(Boolean).map(h).join(' · ');
 return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${h(spec.title)}</title><style>
@page{size:A4;margin:16mm 16mm 18mm 16mm}*{box-sizing:border-box}body{font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;font-size:11pt;color:#1d2026;margin:0}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid ${color};padding-bottom:4mm;margin-bottom:8mm}header img{max-height:17mm;max-width:50mm}
.ident{text-align:right;font-size:9pt;color:#5b616b;line-height:1.4}.ident strong{display:block;font-size:12pt;color:${color}}
h1{text-align:center;font-size:16pt;letter-spacing:.04em;color:${color};margin:0 0 2mm}.num{text-align:center;font-weight:700;margin:0 0 7mm}
h2{font-size:12pt;color:${color};margin:6mm 0 2mm}p{line-height:1.5;margin:0 0 3mm}.b{font-weight:700}
table{width:100%;border-collapse:collapse;margin:0 0 5mm}td,th{border:1px solid #c9cfd8;padding:2mm 3mm;vertical-align:middle;font-size:10.5pt}
.fields th{width:33%;background:#eef2f7;text-align:left}.grid th{background:${color};color:#fff;text-align:left}
.place{text-align:right;margin-top:6mm}.sigs{display:flex;gap:6mm;margin-top:4mm}.sigs div{flex:1;text-align:center;min-height:32mm}.sigs strong,.sigs span{display:block;font-size:10pt}
footer{position:fixed;bottom:-10mm;left:0;right:0;text-align:center;font-size:8pt;color:#8a909a;border-top:1px solid #c9cfd8;padding-top:2mm}
</style></head><body><header><div>${logo?`<img src="${logo}" alt="">`:''}</div><div class="ident"><strong>${h(company.name||'')}</strong>${[company.address,company.city,company.phone?'Tél. : '+company.phone:'',company.email].filter(Boolean).map(h).join('<br>')}</div></header>
<h1>${h(spec.title.toUpperCase())}</h1>${spec.number?`<p class="num">N° ${h(spec.number)}</p>`:''}${blocks}${footer?`<footer>${footer}</footer>`:''}</body></html>`;
}

// ---------- template catalogue ----------
const signer=(company,index=0)=>company.signatories?.[index]||{};
const placeDate=(company,date)=>({type:'placeDate',text:'Fait à '+(company.city||BLANK)+', le '+(date?longDate(date):BLANK)});

function voucherForm(company,d){
 const amount=num(d.amount);
 return {title:'Bon de décaissement',number:d.number,blocks:[{type:'fields',rows:[['Date',d.date?frDate(d.date):''],['Bénéficiaire',d.beneficiary],['Motif de la dépense',d.purpose],['Imputation (compte / service)',d.account],['Mode de paiement',d.mode],['Montant en chiffres',amount!==null?money(amount):''],['Montant en lettres',amount!==null?amountInWords(amount):'']]},...(d.notes?[{type:'para',text:'Observations : '+d.notes}]:[]),placeDate(company,d.date),{type:'signatures',items:[{label:'Le bénéficiaire',name:d.beneficiary||''},{label:'Le caissier',name:d.cashier||''},{label:'Le responsable',name:signer(company).name||''}]}],
  howTo:['Insérez votre logo une fois pour toutes : double-cliquez dans l’en-tête (haut de page) › Insertion › Images.','Le tableau des champs se crée avec Insertion › Tableau › 2 colonnes. Pour griser la colonne de gauche : sélectionnez-la › Création de tableau › Trame de fond.','Écrivez toujours le montant en chiffres ET en lettres : c’est ce qui protège la caisse contre les modifications.','Pour réutiliser ce bon : Fichier › Enregistrer sous › type « Modèle Word (*.dotx) ». Ensuite Fichier › Nouveau › Personnel ouvre une copie vierge.','Numérotez les bons à la suite (BD-2026-001, 002…) et reportez chaque bon dans le journal de trésorerie avec le même numéro.']};
}
function missionForm(company,d){
 const s=signer(company);
 return {title:'Ordre de mission',number:d.number,blocks:[{type:'para',text:`${s.role||'Le Directeur'}${company.name?' de '+company.name:''} donne ordre à :`},{type:'fields',rows:[['Nom et prénom',d.name],['Fonction',d.role],['Matricule',d.matricule],['Destination',d.destination],['Objet de la mission',d.purpose],['Date de départ',d.start?frDate(d.start):''],['Date de retour',d.end?frDate(d.end):''],['Moyen de transport',d.transport],['Frais pris en charge',d.expenses]]},{type:'para',text:'Les autorités civiles et militaires sont priées de faciliter l’accomplissement de cette mission.'},placeDate(company,d.date),{type:'signatures',items:[{label:'Visa à l’arrivée',name:''},{label:'Visa au départ',name:''},{label:s.role||'Le Directeur',name:s.name||''}]}],
  howTo:['Commencez par l’en-tête de l’entreprise (Insertion › En-tête) : il s’affichera sur toutes les pages.','Titre centré : écrivez ORDRE DE MISSION, sélectionnez-le, Ctrl+E pour centrer, Ctrl+G pour le gras.','Les informations du missionnaire sont dans un tableau à 2 colonnes : c’est plus propre que des tabulations.','La date en toutes lettres (« le 4 novembre 2026 ») fait plus officiel sur un ordre de mission.','Laissez de la place pour les visas : le missionnaire fait viser l’ordre à l’arrivée et au départ.']};
}
const ATTESTATIONS={
 travail:(d,s,company)=>`Je soussigné(e), ${s.name||BLANK}, ${s.role||'Directeur'} de ${company.name||BLANK}, atteste que ${d.civility||'M./Mme'} ${d.name||BLANK}${d.birth?', né(e) le '+longDate(d.birth):''}, est employé(e) au sein de notre structure en qualité de ${d.role||BLANK} depuis le ${d.start?longDate(d.start):BLANK}${d.end?' jusqu’au '+longDate(d.end):''}.`,
 stage:(d,s,company)=>`Je soussigné(e), ${s.name||BLANK}, ${s.role||'Directeur'} de ${company.name||BLANK}, atteste que ${d.civility||'M./Mme'} ${d.name||BLANK}${d.school?', étudiant(e) à '+d.school:''}, a effectué un stage au sein de notre structure du ${d.start?longDate(d.start):BLANK} au ${d.end?longDate(d.end):BLANK}${d.role?', au poste de '+d.role:''}.${d.appreciation?' '+d.appreciation:''}`,
 presence:(d,s,company)=>`Je soussigné(e), ${s.name||BLANK}, ${s.role||'Directeur'} de ${company.name||BLANK}, atteste que ${d.civility||'M./Mme'} ${d.name||BLANK} était présent(e) ${d.event?'à '+d.event+' ':''}le ${d.start?longDate(d.start):BLANK}${d.end?' au '+longDate(d.end):''}.`,
 bonne_fin:(d,s,company)=>`Je soussigné(e), ${s.name||BLANK}, ${s.role||'Directeur'} de ${company.name||BLANK}, atteste que ${d.name||BLANK} a exécuté ${d.event||'la prestation'} à notre entière satisfaction${d.start?', du '+longDate(d.start):''}${d.end?' au '+longDate(d.end):''}.`,
};
function attestationForm(company,d){
 const kind=ATTESTATIONS[d.kind]?d.kind:'travail',s=signer(company);
 const titles={travail:'Attestation de travail',stage:'Attestation de stage',presence:'Attestation de présence',bonne_fin:'Attestation de bonne fin d’exécution'};
 return {title:titles[kind],number:d.number,blocks:[{type:'spacer'},{type:'para',text:ATTESTATIONS[kind](d,s,company)},{type:'para',text:'En foi de quoi, la présente attestation lui est délivrée pour servir et valoir ce que de droit.'},{type:'spacer'},placeDate(company,d.date),{type:'signatures',items:[{label:'',name:''},{label:s.role||'Le Directeur',name:s.name||''}]}],
  howTo:['Une attestation tient sur une page : en-tête, titre centré, un paragraphe, la formule finale, le lieu et la date, la signature.','Justifiez le texte (Ctrl+J) pour des bords droits comme dans un document officiel.','« Pour servir et valoir ce que de droit » est la formule de clôture habituelle : gardez-la.','Pour faire la même attestation pour plusieurs personnes : Publipostage (Publipostage › Démarrer › Lettres, puis Sélection des destinataires depuis une liste Excel).','Évitez Canva pour ce type de document : Word garde le texte modifiable et s’imprime au bon format A4.']};
}
function noticeForm(company,d){
 const s=signer(company);
 return {title:'Note de service',number:d.number,blocks:[{type:'fields',rows:[['Date',d.date?frDate(d.date):''],['Destinataires',d.recipients||'Tout le personnel'],['Objet',d.subject]]},...String(d.body||BLANK).split(/\n{2,}/).map(text=>({type:'para',text})),{type:'para',text:'Le respect de la présente note est obligatoire.'},placeDate(company,d.date),{type:'signatures',items:[{label:'',name:''},{label:s.role||'La Direction',name:s.name||''}]}],
  howTo:['Une note de service indique toujours : la date, les destinataires, l’objet, le message et la signature.','Écrivez des phrases courtes, une idée par paragraphe (touche Entrée entre deux idées).','Affichez-la et/ou faites signer une liste d’émargement pour prouver que chacun l’a lue.']};
}
function leaveForm(company,d){
 const s=signer(company);
 return {title:'Demande de congé',number:d.number,blocks:[{type:'fields',rows:[['Nom et prénom',d.name],['Fonction / service',d.role],['Type de congé',d.kind||'Congé annuel'],['Du',d.start?frDate(d.start):''],['Au',d.end?frDate(d.end):''],['Nombre de jours',d.days],['Intérim assuré par',d.replacement],['Motif',d.purpose]]},placeDate(company,d.date),{type:'signatures',items:[{label:'Le demandeur',name:d.name||''},{label:'Le supérieur hiérarchique',name:''},{label:s.role||'La Direction',name:s.name||''}]}],
  howTo:['Le formulaire est un tableau à 2 colonnes : à gauche les questions, à droite les réponses.','Pour compter les jours dans Excel : =NB.JOURS.OUVRES(date_début;date_fin) ne compte que les jours ouvrables.']};
}
function letterForm(company,d){
 const s=signer(company);
 return {title:d.subject?'Objet : '+d.subject:'Courrier',blocks:[{type:'para',text:[d.recipient,d.recipientAddress].filter(Boolean).join(' – ')||'',align:'right'},...(d.reference?[{type:'para',text:'Réf. : '+d.reference}]:[]),{type:'para',text:(d.salutation||'Madame, Monsieur')+','},...String(d.body||BLANK).split(/\n{2,}/).map(text=>({type:'para',text})),{type:'para',text:d.closing||'Veuillez agréer, Madame, Monsieur, l’expression de nos salutations distinguées.'},placeDate(company,d.date),{type:'signatures',items:[{label:'',name:''},{label:s.role||'La Direction',name:s.name||''}]}],
  howTo:['Un courrier administratif : expéditeur (en-tête), destinataire à droite, référence, objet, formule d’appel, corps, formule de politesse, signature.','La formule de politesse reprend la formule d’appel (« Madame, Monsieur, … »).']};
}
const FORMS={bon_decaissement:voucherForm,ordre_mission:missionForm,attestation:attestationForm,note_service:noticeForm,demande_conge:leaveForm,courrier:letterForm};
export const OFFICE_TEMPLATES={
 journal_tresorerie:{label:'Journal de trésorerie',formats:['xlsx'],prefix:'JT'},
 fiche_presence:{label:'Fiche de présence mensuelle',formats:['xlsx'],prefix:'FP'},
 bon_decaissement:{label:'Bon de décaissement',formats:['docx','pdf','xlsx'],prefix:'BD'},
 ordre_mission:{label:'Ordre de mission',formats:['docx','pdf'],prefix:'OM'},
 attestation:{label:'Attestation',formats:['docx','pdf'],prefix:'AT'},
 note_service:{label:'Note de service',formats:['docx','pdf'],prefix:'NS'},
 demande_conge:{label:'Demande de congé',formats:['docx','pdf'],prefix:'DC'},
 courrier:{label:'Courrier administratif',formats:['docx','pdf'],prefix:'CR'},
 lecon_excel:{label:'Leçon Excel avec correction automatique',formats:['xlsx'],prefix:'LX'},
};

/**
 * Render a template. company: {name,address,city,phone,email,rccm,niu,signatories,logo:{bytes},logoDataUri}
 * @param {string} template
 * @param {string} format
 * @param {Record<string,any>} [company]
 * @param {Record<string,any>} [data]
 * @param {{learn?:boolean,accent?:string}} [options]
 * @returns {{kind:'xlsx'|'docx',bytes:Uint8Array,html?:undefined}|{kind:'html',html:string,bytes?:undefined}}
 */
export function renderOfficeTemplate(template,format,company={},data={},{learn=true,accent}={}){
 const def=OFFICE_TEMPLATES[template];if(!def)throw new RangeError('Modèle inconnu.');
 if(!def.formats.includes(format))throw new RangeError('Format non disponible pour ce modèle : '+def.formats.join(', ')+'.');
 if(format==='xlsx'){
  const sheets=template==='journal_tresorerie'?journalWorkbook(company,data,learn):template==='fiche_presence'?attendanceWorkbook(company,data,learn):template==='bon_decaissement'?voucherWorkbook(company,data,learn):lessonWorkbook(data.lesson||'somme');
  return {kind:'xlsx',bytes:buildXlsx(sheets,{accent,title:def.label,author:company.name||'Braand'})};
 }
 const spec={...FORMS[template](company,data),company,accent};
 if(format==='pdf')return {kind:'html',html:buildFormHtml({...spec,howTo:[]})};
 return {kind:'docx',bytes:buildFormDocx(learn?spec:{...spec,howTo:[]})};
}
