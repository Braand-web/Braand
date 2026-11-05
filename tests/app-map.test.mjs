import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_VIEWS,SETTINGS_TABS,NAV_TARGETS,appMapGuide,targetLabel} from '../lib/app-map.mjs';
import {readAgentGuide} from '../lib/agent-guides.mjs';
const studio=readFileSync(new URL('../app/studio.tsx',import.meta.url),'utf8'),settings=readFileSync(new URL('../components/settings-panel.tsx',import.meta.url),'utf8');
test('every screen of the app is described in the interface map',()=>{
 const routeViews=JSON.parse(studio.match(/const ROUTE_VIEWS:View\[\]=(\[[^\]]+\])/)[1]);
 for(const view of routeViews)assert.ok(APP_VIEWS[view],`Écran « ${view} » absent de lib/app-map.mjs : décrivez-le pour que l’agent le connaisse.`);
 const names=Object.fromEntries([...studio.match(/const viewNames:Record<View,string>=\{([^}]+)\}/)[1].matchAll(/(\w+):['"]([^'"]+)['"]/g)].map(m=>[m[1],m[2]]));
 for(const [view,name] of Object.entries(names))assert.ok(APP_VIEWS[view],view+' '+name);
});
test('every settings tab is described with its real label',()=>{
 const tabs=[...settings.matchAll(/\{id: "(\w+)", label: "([^"]+)"/g)].map(m=>[m[1],m[2]]);
 assert.ok(tabs.length>=10);
 for(const [id,label] of tabs){assert.ok(SETTINGS_TABS[id],`Onglet « ${id} » absent de la carte`);assert.equal(SETTINGS_TABS[id].label,label);}
});
test('navigation targets come from the map and the guide lists them for the agent',()=>{
 const guide=appMapGuide();
 for(const target of NAV_TARGETS.filter(t=>t.includes(':')))assert.match(guide,new RegExp('« '+target.replace(':','\\:')+' »'),target);
 assert.equal(targetLabel('settings:billing'),'Paramètres → Facturation');assert.equal(targetLabel('view:routines'),'Automatisations');
 assert.match(guide,/Entreprise : 79\s900 FCFA/);assert.doesNotMatch(guide,/Haiku|Sonnet|Opus/);
 assert.equal(readAgentGuide({topic:'interface'}).content.slice(0,30),guide.slice(0,30));
});
