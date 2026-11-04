// Print layout for PDF documents and ebooks, rendered by Chromium.
// Markdown is converted with everything escaped first: no raw HTML, script,
// style, event handler or non-https resource can reach the page.

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeImage=url=>/^https:\/\/[^\s"'<>()]+$/.test(url)||/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
const slug=(text,used)=>{let base=text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'section',id=base,n=2;while(used.has(id))id=base+'-'+n++;used.add(id);return id;};

function inline(text){
 let out=escape(text);
 out=out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,(match,alt,url)=>{const raw=url.replace(/&amp;/g,'&');return safeImage(raw)?`<img class="inline" src="${escape(raw)}" alt="${alt}">`:alt;});
 out=out.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g,(match,label,url)=>`<a href="${url}">${label}</a>`);
 out=out.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g,'$1<em>$2</em>').replace(/`([^`]+)`/g,'<code>$1</code>');
 return out;
}

/** Markdown subset to safe HTML; returns the body and the headings for the table of contents. */
export function markdownToPrintHtml(markdown){
 const lines=String(markdown).replace(/\r\n?/g,'\n').split('\n'),html=[],headings=[],used=new Set();
 let i=0;
 const para=[];const flush=()=>{if(para.length){html.push('<p>'+inline(para.join(' '))+'</p>');para.length=0;}};
 while(i<lines.length){
  const line=lines[i];
  const h=/^(#{1,4})\s+(.+)$/.exec(line);
  if(h){flush();const level=h[1].length,text=h[2].trim(),id=slug(text,used);if(level<=2)headings.push({level,text,id});html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);i++;continue;}
  if(/^\s*(---|\*\*\*)\s*$/.test(line)){flush();html.push('<hr>');i++;continue;}
  const img=/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
  if(img){flush();if(safeImage(img[2]))html.push(`<figure><img src="${escape(img[2])}" alt="${escape(img[1])}">${img[1]?`<figcaption>${inline(img[1])}</figcaption>`:''}</figure>`);i++;continue;}
  if(/^>\s?/.test(line)){flush();const quote=[];while(i<lines.length&&/^>\s?/.test(lines[i]))quote.push(lines[i++].replace(/^>\s?/,''));const tip=/^\*\*(Astuce|Conseil|À retenir|Attention|Important|Exemple)\s*:?\*\*\s*/i.exec(quote[0]||'');html.push(`<aside class="${tip?'callout':'quote'}">${quote.map(q=>'<p>'+inline(q)+'</p>').join('')}</aside>`);continue;}
  if(/^\s*\|.*\|\s*$/.test(line)){flush();const rows=[];while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(lines[i++]);const cells=rows.filter(r=>!/^\s*\|[\s:|-]+\|\s*$/.test(r)).map(r=>r.trim().slice(1,-1).split('|').map(c=>inline(c.trim())));if(cells.length){html.push('<table><thead><tr>'+cells[0].map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>'+cells.slice(1).map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>');}continue;}
  if(/^\s*([-*•]|\d+[.)])\s+/.test(line)){flush();const ordered=/^\s*\d+[.)]/.test(line),items=[];while(i<lines.length&&/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]))items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/,''));const tag=ordered?'ol':'ul';html.push(`<${tag}>${items.map(it=>'<li>'+inline(it)+'</li>').join('')}</${tag}>`);continue;}
  if(!line.trim()){flush();i++;continue;}
  para.push(line.trim());i++;
 }
 flush();
 return {body:html.join('\n'),headings};
}

export const LAYOUTS={
 document:{label:'Document',size:'A4',cover:false,toc:false,chapterBreak:false},
 report:{label:'Rapport',size:'A4',cover:true,toc:true,chapterBreak:true},
 guide:{label:'Guide',size:'A4',cover:true,toc:true,chapterBreak:true},
 ebook:{label:'Ebook',size:'6in 9in',cover:true,toc:true,chapterBreak:true},
 slides:{label:'Présentation',size:'13.333in 7.5in',cover:true,toc:false,chapterBreak:true},
};

/**
 * Full printable HTML. Fonts come from Google Fonts with solid fallbacks.
 * @param {{title:string,subtitle?:string,author?:string,content:string,layout?:string,accent?:string,coverImage?:string,sources?:string[]}} options
 */
export function buildPrintHtml({title,subtitle='',author='',content,layout='document',accent='#2563eb',coverImage='',sources=[]}){
 const spec=LAYOUTS[layout]||LAYOUTS.document,parsed=markdownToPrintHtml(content),headings=parsed.headings;
 // Slides: each # heading becomes one 16:9 slide.
 const body=layout==='slides'?parsed.body.split(/(?=<h1 )/).filter(part=>part.trim()).map(part=>`<section class="slide">${part}</section>`).join('\n'):parsed.body;
 const color=/^#[0-9a-f]{6}$/i.test(accent)?accent:'#2563eb',cover=coverImage&&safeImage(coverImage)?coverImage:'';
 const year=new Date().getFullYear();
 const toc=spec.toc&&headings.filter(h=>h.level===1).length>=2?`<nav class="toc"><h2 class="toc-title">Sommaire</h2><ol>${headings.filter(h=>h.level<=2).map(h=>`<li class="lvl${h.level}"><a href="#${h.id}">${escape(h.text)}</a></li>`).join('')}</ol></nav>`:'';
 const coverPage=spec.cover?`<section class="cover${cover?' has-image':''}">${cover?`<img class="cover-image" src="${escape(cover)}" alt="">`:''}<div class="cover-text"><div class="cover-kicker">${escape(spec.label)}</div><h1 class="cover-title">${escape(title)}</h1>${subtitle?`<p class="cover-subtitle">${escape(subtitle)}</p>`:''}${author?`<p class="cover-author">${escape(author)}</p>`:''}</div></section>`:`<header class="doc-head"><h1 class="doc-title">${escape(title)}</h1>${subtitle?`<p class="doc-subtitle">${escape(subtitle)}</p>`:''}</header>`;
 const sourceList=sources.length?`<section class="sources"><h2>Sources</h2><ol>${sources.map(s=>`<li>${inline(s)}</li>`).join('')}</ol></section>`:'';
 const small=layout==='ebook',slides=layout==='slides';
 return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escape(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">
<style>
@page{size:${spec.size};margin:${slides?'0':small?'16mm 15mm 18mm 15mm':'22mm 20mm 24mm 20mm'}}
@page:first{margin:0}
:root{--accent:${color};--ink:#16181d;--muted:#5b616b;--line:#e3e6eb;--soft:#f4f6f9}
*{box-sizing:border-box}
html{font-size:${small?'10.5pt':'11pt'}}
body{margin:0;font-family:'Source Serif 4',Georgia,'Times New Roman',serif;color:var(--ink);line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4,.cover-kicker,.toc-title,th,figcaption,.doc-title{font-family:Manrope,'Helvetica Neue',Arial,sans-serif;letter-spacing:-.01em;line-height:1.2;break-after:avoid}
h1{font-size:2.1rem;font-weight:800;margin:0 0 1.2rem;color:var(--ink)}
${spec.chapterBreak?'main h1{break-before:page;display:block;padding-top:14mm}main h1::before{content:"";display:block;width:22mm;height:5px;border-radius:3px;background:var(--accent);margin-bottom:6mm}':'main h1{margin-top:2rem}'}
main h1:first-child{break-before:auto}
h2{font-size:1.35rem;font-weight:700;margin:1.8rem 0 .6rem;color:var(--accent)}
h3{font-size:1.1rem;font-weight:700;margin:1.3rem 0 .4rem}
h4{font-size:1rem;font-weight:700;margin:1rem 0 .3rem;color:var(--muted)}
p{margin:0 0 .75rem;orphans:3;widows:3;text-align:${small?'left':'justify'};hyphens:auto}
ul,ol{margin:0 0 .9rem;padding-left:1.3rem}li{margin:.2rem 0}
strong{font-weight:600}a{color:var(--accent);text-decoration:none}
code{font-family:ui-monospace,Menlo,monospace;font-size:.88em;background:var(--soft);padding:.05em .3em;border-radius:3px}
hr{border:0;border-top:1px solid var(--line);margin:1.5rem 0}
figure{margin:1.2rem 0;break-inside:avoid;text-align:center}figure img{max-width:100%;max-height:${small?'85mm':'140mm'};border-radius:6px}
figcaption{font-size:.8rem;color:var(--muted);margin-top:.4rem}
img.inline{max-height:1.2em;vertical-align:middle}
aside{break-inside:avoid;margin:1.1rem 0;padding:.8rem 1rem;border-radius:8px}
aside.callout{background:color-mix(in srgb,var(--accent) 9%,white);border-left:4px solid var(--accent)}
aside.quote{border-left:3px solid var(--line);color:var(--muted);font-style:italic}
aside p:last-child{margin-bottom:0}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.88rem;break-inside:auto}
th{background:var(--accent);color:#fff;font-weight:700;text-align:left;padding:.45rem .6rem;font-size:.82rem}
td{padding:.45rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}tr{break-inside:avoid}
tbody tr:nth-child(even) td{background:var(--soft)}
.cover{height:${small?'9in':'297mm'};width:100%;position:relative;break-after:page;display:flex;align-items:flex-end;background:linear-gradient(160deg,var(--accent),#0b1020);color:#fff;overflow:hidden}
.cover-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cover.has-image::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.78))}
.cover-text{position:relative;z-index:1;padding:${small?'18mm 15mm':'28mm 24mm'}}
.cover-kicker{font-size:.8rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;opacity:.85;margin-bottom:.8rem}
.cover-title{font-family:Manrope,Arial,sans-serif;font-size:${small?'2.4rem':'3rem'};font-weight:800;line-height:1.05;margin:0 0 1rem;color:#fff;border:0;padding:0}
.cover-subtitle{font-size:1.15rem;opacity:.92;margin:0 0 1.2rem;text-align:left}
.cover-author{font-family:Manrope,Arial,sans-serif;font-weight:600;font-size:.95rem;opacity:.85;margin:0;text-align:left}
.doc-head{margin-bottom:1.6rem;padding-bottom:1rem;border-bottom:3px solid var(--accent)}
.doc-title{font-size:1.9rem;font-weight:800;margin:0}.doc-subtitle{color:var(--muted);margin:.4rem 0 0}
.toc{break-after:page}.toc-title{font-size:1.6rem;color:var(--ink);margin:0 0 1rem}
.toc ol{list-style:none;padding:0;margin:0}.toc li{display:flex;border-bottom:1px dotted var(--line);padding:.35rem 0}
.toc li.lvl1{font-family:Manrope,Arial,sans-serif;font-weight:700;margin-top:.5rem}.toc li.lvl2{padding-left:1.2rem;font-size:.92rem}
.toc a{color:var(--ink)}
.sources{margin-top:2rem;font-size:.8rem;color:var(--muted)}.sources h2{font-size:1rem;color:var(--muted)}
.colophon{margin-top:2.5rem;font-size:.75rem;color:var(--muted);text-align:center}
${slides?`html{font-size:19pt}body{font-family:Manrope,Arial,sans-serif}.cover{height:7.5in}
.slide{height:7.5in;padding:.7in .9in;break-after:page;display:flex;flex-direction:column;justify-content:center;overflow:hidden;position:relative}
.slide::after{content:"";position:absolute;left:0;top:0;bottom:0;width:.18in;background:var(--accent)}
.slide h1{break-before:auto!important;padding-top:0!important;font-size:2.2rem;line-height:1.1;margin-bottom:1rem}.slide h2{font-size:1.2rem}.slide h1::before{display:none}
.slide p{text-align:left;font-size:1rem;line-height:1.4}.slide li{font-size:1rem;margin:.3rem 0}.slide table{font-size:.8rem}.slide th{font-size:.75rem}
.slide figure img{max-height:4.2in}main{display:block}.sources,.colophon{display:none}`:''}
</style></head><body>
${coverPage}
${toc}
<main>
${body}
${sourceList}
</main>
<p class="colophon">© ${year} ${escape(author||title)}</p>
</body></html>`;
}

export const PRINT_FOOTER=`<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#8a909a;text-align:center;padding:0 12mm"><span class="pageNumber"></span></div>`;
