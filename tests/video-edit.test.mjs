import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyInput,videoEditInput} from '../lib/video-edit-contracts.ts';
import {discoveredPlatformTools} from '../lib/platform-tools.ts';
import {agentToolAllowedForMode} from '../lib/agent-mode.mjs';

const edit=()=>({title:'Présentation produit',clips:[{fileId:'file-1',version:1,sha256:'a'.repeat(64),trimStart:0,duration:3}],width:1080,height:1920,captions:[{text:'Bonjour',start:0,end:2}],maxCredits:10,
 style:{fit:'cover',motion:'zoom_in',grade:'warm',audioVolume:0.4,fadeSeconds:0.2}});

test('video edits reject free commands, foreign paths and invalid timing before a proposal can exist',()=>{
 assert.equal(videoEditInput.parse(edit()).style.motion,'zoom_in');
 const bad=[{...edit(),command:'ffmpeg'},{...edit(),style:{...edit().style,filter:'movie=/secret'}},{...edit(),style:{...edit().style,audioVolume:NaN}},{...edit(),style:{...edit().style,fadeSeconds:2}},{...edit(),captions:[{text:'A',start:0,end:4}]},{...edit(),clips:[{...edit().clips[0],fileId:'../secret'}]}];
 for(const input of bad)assert.equal(videoEditInput.safeParse(input).success,false);
 const {style,...legacy}=edit();assert.equal(assemblyInput.safeParse(legacy).success,true);assert.equal(assemblyInput.safeParse(edit()).success,false);assert.equal(style.fit,'cover');
});

test('autonomy can prepare editing only when the verified renderer is discovered',()=>{
 const closed=discoveredPlatformTools('media',{assembly:{ready:false},videoEditing:{ready:false}}).map(tool=>tool.name);
 assert.ok(closed.includes('get_video_edit_result'));assert.ok(!closed.includes('prepare_video_edit'));assert.ok(!closed.includes('assemble_media'));
 const ready=discoveredPlatformTools('media',{videoEditing:{ready:true}}).map(tool=>tool.name);assert.ok(ready.includes('prepare_video_edit'));
 assert.equal(agentToolAllowedForMode('autonomous','prepare_video_edit'),true);
 assert.equal(agentToolAllowedForMode('autonomous','get_video_edit_result'),true);
 assert.equal(agentToolAllowedForMode('approved_mission','prepare_video_edit'),true);
});
