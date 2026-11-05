import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const out=path.resolve('.local-build/markdown-table-unit.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({stdin:{contents:"export {StreamingMarkdown,parseMarkdownBlocks,stableCut,joinBlocks} from './components/agents/streaming-markdown';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';",resolveDir:process.cwd(),loader:'tsx'},outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server'],loader:{'.css':'empty'}});
const {StreamingMarkdown,parseMarkdownBlocks,stableCut,joinBlocks,renderToStaticMarkup,createElement}=await import(pathToFileURL(out));const render=text=>renderToStaticMarkup(createElement(StreamingMarkdown,{text}));
test('screenshot ranking table renders real columns and blank cells',()=>{const html=render('Voici la base :\n\n| Pos. | Équipe | J | G | N | P | BP | BC | Diff. | Pts |\n|-|-|-|-|-|-|-|-|-|-|\n| 1 | | | | | | | | | |\n| 2 | | | | | | | | | |\n\nSuite.');assert.match(html,/<table>/);assert.equal((html.match(/<th /g)||[]).length,10);assert.equal((html.match(/<td /g)||[]).length,20);assert.match(html,/Non renseigné/);assert.match(html,/<p[^>]*>Suite\./);});
test('table cells preserve escapes, code, alignment, zero and malicious content as text',()=>{const html=render('| Nom | Valeur |\n| :--- | ---: |\n| A\\|B | `x|y` |\n| <script>evil()</script> | 0 |');assert.match(html,/A\|B/);assert.match(html,/<code>x\|y<\/code>/);assert.match(html,/text-align:right/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/>0<\/td>/);});
test('partial streaming separator and code fences keep plain content readable',()=>{assert.doesNotMatch(render('| A | B |\n| -- |'),/<table>/);assert.doesNotMatch(render('```\n| A | B |\n|-|-|\n```'),/<table>/);assert.match(render('| A | B |\n|---|---|'),/<table>/);});

test('streaming parse reuses finished paragraphs and always equals a full parse',()=>{
 const sample='# Titre\n\nUn paragraphe **gras**.\n\n1. Un\n2. Deux\n\n3. Trois après une ligne vide\n\n```js\nconst a=1;\n\nconst b=2;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- puce\n\nFin du texte, avec [un lien](https://braand.fun).';
 for(let end=0;end<=sample.length;end++){
  const text=sample.slice(0,end),cut=stableCut(text);
  assert.deepEqual(joinBlocks(parseMarkdownBlocks(text.slice(0,cut)),parseMarkdownBlocks(text.slice(cut))),parseMarkdownBlocks(text),'at '+end+' chars');
 }
 assert.equal(stableCut('```\na\n\nb'),0,'never cuts inside an open code block');
});
