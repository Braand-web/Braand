import assert from 'node:assert/strict';
import test from 'node:test';
import {markdownToPrintHtml,buildPrintHtml,LAYOUTS} from '../lib/print-document.mjs';

test('markdown is escaped first: no raw HTML, script, handler or unsafe URL reaches the page',()=>{
 const {body}=markdownToPrintHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![x](javascript:alert(1))\n\n[lien](javascript:alert(1))\n\n![ok](https://fal.media/a.png)');
 assert.ok(!body.includes('<script')&&!body.includes('<img src=x')&&!/(href|src)="javascript:/.test(body),body);
 assert.match(body,/&lt;script&gt;/);
 assert.match(body,/<figure><img src="https:\/\/fal\.media\/a\.png"/);
});

test('headings, lists, tables, callouts and quotes become print structure with a table of contents',()=>{
 const {body,headings}=markdownToPrintHtml('# Chapitre 1\nIntro **forte** et *douce*.\n\n## Section A\n- un\n- deux\n\n1. premier\n2. second\n\n| Nom | Prix |\n|---|---|\n| Sérum | 25 € |\n\n> **Astuce :** testez deux accroches.\n\n> Une citation.\n\n# Chapitre 1');
 assert.deepEqual(headings.map(h=>[h.level,h.id]),[[1,'chapitre-1'],[2,'section-a'],[1,'chapitre-1-2']],'Unique anchors');
 assert.match(body,/<strong>forte<\/strong>/);assert.match(body,/<em>douce<\/em>/);
 assert.match(body,/<ul><li>un<\/li><li>deux<\/li><\/ul>/);assert.match(body,/<ol><li>premier<\/li>/);
 assert.match(body,/<table><thead><tr><th>Nom<\/th><th>Prix<\/th>/);assert.match(body,/<td>Sérum<\/td>/);
 assert.match(body,/<aside class="callout">/);assert.match(body,/<aside class="quote">/);
});

test('layouts add cover, contents and chapter breaks; ebooks use a 6x9 page',()=>{
 const content='# Introduction\nTexte.\n\n# Méthode\nTexte.\n\n## Étape 1\nTexte.';
 const ebook=buildPrintHtml({title:'Guide <LUMA>',subtitle:'Lancer un produit',author:'Braand',content,layout:'ebook',accent:'#4b93ff',coverImage:'https://fal.media/cover.jpg',sources:['https://example.com/source']});
 assert.match(ebook,/size:6in 9in/);assert.match(ebook,/class="cover has-image"/);assert.match(ebook,/<nav class="toc">/);assert.match(ebook,/href="#methode"/);
 assert.match(ebook,/main h1\{break-before:page/);assert.match(ebook,/Guide &lt;LUMA&gt;/);assert.match(ebook,/--accent:#4b93ff/);assert.match(ebook,/class="sources"/);
 const plain=buildPrintHtml({title:'Note',content:'Un paragraphe.',layout:'document',accent:'red;}body{display:none',coverImage:'http://insecure/x.png'});
 assert.match(plain,/size:A4/);assert.ok(!plain.includes('class="cover')&&!plain.includes('<nav class="toc">'));assert.match(plain,/--accent:#2563eb/,'Invalid colours are ignored');assert.ok(!plain.includes('insecure'));
 assert.deepEqual(Object.keys(LAYOUTS),['document','report','guide','ebook','slides']);
});

test('slides layout makes one 16:9 slide per # heading',()=>{
 const deck=buildPrintHtml({title:'Pitch',content:'# Problème\nTexte.\n\n# Solution\n- A\n- B\n\n# Prix\n| Offre | Prix |\n|---|---|\n| Pro | 10 € |',layout:'slides'});
 assert.match(deck,/size:13\.333in 7\.5in/);assert.equal((deck.match(/<section class="slide">/g)||[]).length,3);assert.ok(!deck.includes('<nav class="toc">'));
});
