// Administrator-approved fal.ai models: discovery, approval priced from fal's
// pricing API and the BEAC rate, runtime catalog merge, and fail-closed prices.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'.local-build/fal-models-test.mjs');mkdirSync(path.dirname(out),{recursive:true});
await build({entryPoints:[path.join(root,'lib/fal-models.ts')],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'error'});
const models=await import(pathToFileURL(out).href);

const today=new Date(),date=[today.getUTCDate(),today.getUTCMonth()+1,today.getUTCFullYear()].map((n,i)=>i<2?String(n).padStart(2,'0'):String(n)).join('/');
const beac=`USD/XAF</span></div></div><div id="middle"> 582.5503 </div><div id="right"> 600 </div><p>Date de valeur : ${date}</p>`;
let price=0.05;const calls=[];
globalThis.fetch=async url=>{const href=String(url);calls.push(href);
 if(href.startsWith('https://api.fal.ai/v1/models/pricing'))return Response.json({prices:[{endpoint_id:'fal-ai/clarity-upscaler',unit_price:price,unit:'images',currency:'USD'}]});
 if(href.startsWith('https://api.fal.ai/v1/models'))return Response.json({models:[{endpoint_id:'fal-ai/clarity-upscaler',metadata:{display_name:'Clarity Upscaler',category:'image-to-image',description:'Upscale images'}}]});
 if(href==='https://www.beac.int/')return new Response(beac);
 throw Error('Unexpected '+href);};
const store=new Map(),env={FAL_KEY:'fal-test',BUCKET:{async get(key){const v=store.get(key);return v?{size:v.length,async text(){return v;}}:null;},async put(key,value){store.set(key,value);}}};

const found=await models.searchFalModels('fal-test','upscale');
assert.deepEqual(found.map(m=>[m.id,m.priceUsd,m.approved]),[['fal-ai/clarity-upscaler',0.05,false]]);
await assert.rejects(models.searchFalModels(undefined,'upscale'),/pas configuré/);

const schema={type:'object',additionalProperties:false,required:['image_url'],properties:{image_url:{type:'string',format:'uri'}}};
await assert.rejects(models.approveFalModel(env,'admin',{id:'fal-ai/clarity-upscaler',name:'Clarity',kind:'image',tasks:['not_a_task'],unit:'images',maxUnits:1,inputSchema:schema}),/Tâche inconnue/);
const approved=await models.approveFalModel(env,'admin',{id:'fal-ai/clarity-upscaler',name:'Clarity',kind:'image',tasks:['image_upscale'],unit:'images',maxUnits:1,inputSchema:schema});
// 0.05 USD x 1 image x 600 XAF = 30 XAF -> 8 credits (4 XAF per credit, rounded up).
assert.equal(approved.quote.credits,8);assert.equal(approved.quote.costCeilingXaf,30);
const items=models.approvedCatalogItems();
assert.equal(items.length,1);assert.deepEqual(items[0].tasks,['image_upscale']);assert.ok(items[0].costCeilingXaf<=items[0].credits*4,'Passes the existing price policy');
assert.equal(models.approvedCatalogItems(Date.now()+2*86400000).length,0,'A price older than a day fails closed');

// A later price change is picked up by the periodic repricing.
price=0.1;calls.length=0;
await models.ensureApprovedFalModels(env,Date.now()+7*3600000);
assert.ok(calls.some(url=>url.includes('/pricing')),'Stale quotes are repriced');
const clarity=()=>models.approvedModels().find(model=>model.id==='fal-ai/clarity-upscaler');
assert.equal(clarity().quote.credits,15);
const before=models.approvedModels().length;await models.removeFalModel(env,'fal-ai/clarity-upscaler');assert.equal(clarity(),undefined,'Removal also hides a model shipped with the code');assert.equal(models.approvedModels().length,before-1);
await models.ensureApprovedFalModels(env,Date.now()+20*3600000);assert.equal(clarity(),undefined,'Removal survives a reload');
console.log('PASS fal models: discovery with prices, admin approval priced from fal and BEAC, catalog merge, fail-closed and repriced quotes');
