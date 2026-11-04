import assert from 'node:assert/strict';
import test from 'node:test';
import {buildVisualHtml,VISUAL_FORMATS,VISUAL_TEMPLATES} from '../lib/visual-card.mjs';

test('visual text is escaped and unsafe backgrounds or colours are ignored',()=>{
 const html=buildVisualHtml({headline:'<script>alert(1)</script>',body:'"><img src=x onerror=1>',brandName:'<b>X</b>',accent:'red;}*{display:none',background:'javascript:alert(1)'});
 assert.ok(!html.includes('<script>alert')&&!html.includes('<img src=x')&&!html.includes('<b>X</b>')&&!html.includes('javascript:'));
 assert.match(html,/&lt;script&gt;/);assert.match(html,/#2563eb/);assert.ok(!html.includes('class="bg"'));
});

test('every template and format renders at its exact pixel size',()=>{
 for(const [format,[w,h]] of Object.entries(VISUAL_FORMATS))for(const template of VISUAL_TEMPLATES){
  const html=buildVisualHtml({format,template,headline:'Lancement',stat:'+42 %',items:['Un','Deux'],author:'Awa',cta:'Essayer',kicker:'Nouveau',body:'Texte',accent:'#ff5a1f',background:'https://fal.media/x.png'});
  assert.match(html,new RegExp(`width:${w}px;height:${h}px`));assert.match(html,/class="bg" src="https:\/\/fal\.media\/x\.png"/);
 }
 assert.match(buildVisualHtml({template:'list',headline:'Étapes',items:['a','b','c']}),/<ol class="items"><li><span>a<\/span><\/li>/);
 assert.match(buildVisualHtml({template:'stat',headline:'clients',stat:'3×'}),/class="stat">3×</);
});
