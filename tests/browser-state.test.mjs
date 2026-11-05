import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionState,currentStep,tabLabels} from '../lib/browser-state.mjs';
const session=(extra)=>({status:'running',control:'agent',executionSource:'interactive',title:'',url:'',pendingAction:null,observation:null,lastError:null,...extra});
test('a finished session offers no live view and no control, whatever its last connection state',()=>{
 for(const status of ['completed','uncertain','failed','cancelled','expired']){const s=sessionState(session({status,control:'human'}));assert.equal(s.terminal,true);assert.equal(s.live,false);assert.equal(s.canStop,false);assert.equal(s.canTakeControl,false);assert.equal(s.canGiveBack,false,status);}
 assert.equal(sessionState(session({status:'completed'})).label,'Terminée');
});
test('take control only where the server allows it; give back only while the user has it',()=>{
 assert.equal(sessionState(session({status:'running'})).canTakeControl,false);
 assert.equal(sessionState(session({status:'awaiting_login'})).canTakeControl,true);
 assert.equal(sessionState(session({status:'paused'})).canTakeControl,true);
 assert.equal(sessionState(session({status:'paused',executionSource:'background'})).canTakeControl,false);
 const human=sessionState(session({status:'awaiting_login',control:'human'}));assert.equal(human.label,'Vous avez la main');assert.equal(human.canGiveBack,true);assert.equal(human.canTakeControl,false);
 assert.equal(sessionState(session({status:'queued'})).live,false);assert.equal(sessionState(session({status:'queued'})).canStop,true);
 assert.equal(sessionState(session({status:'draft'})).active,false);
});
test('the current step speaks the user’s language',()=>{
 assert.equal(currentStep(session({pendingAction:{description:'Cliquer sur « Publier »'}})),'À valider : Cliquer sur « Publier »');
 assert.equal(currentStep(session({observation:{title:'ANASA - YouTube',url:'https://www.youtube.com/@anasa'}})),'Sur « ANASA - YouTube »');
 assert.equal(currentStep(session({status:'completed',url:'https://www.youtube.com/watch?v=1'})),'Dernière page : « youtube.com »');
 assert.equal(currentStep(session({status:'queued'})),'Ouverture du navigateur…');
});
test('tabs are named by page title and never look identical',()=>{
 const labels=tabLabels([{id:'1',title:'ANASA - YouTube',url:'https://www.youtube.com/@anasa'},{id:'2',title:'Abdul Samad Rabiu : le rival de Dangote, d’où vient sa fortune ?',url:'https://www.youtube.com/watch?v=x'},{id:'3',title:'',url:'https://www.youtube.com/'},{id:'4',title:'',url:'https://www.youtube.com/feed'}]);
 assert.deepEqual(labels.map(t=>t.label),['ANASA - YouTube','Abdul Samad Rabiu : le rival de…','youtube.com','youtube.com (2)']);
 assert.equal(new Set(labels.map(t=>t.label)).size,labels.length);
});
