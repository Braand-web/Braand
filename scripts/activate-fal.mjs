// Mark the funded fal.ai account as ready in production. Only the activation
// switch and account state of the packed FAL_CONFIG_JSON change; the reviewed
// catalogue, pricing policy, FAL_KEY secret and every other binding are kept.
// Premium models are added as FAL_APPROVED_MODELS_JSON, rebuilt from fal's
// public OpenAPI schemas; the Worker prices them from fal with its own key.
import {CANDIDATES,boundedModel} from './fal-model-candidates.mjs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,script='aira-production';
if(!account||!token)throw Error('Cloudflare credentials missing');
const api=async(path,method='GET',body)=>{const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok||!data.success)throw Error('Cloudflare API '+method+' '+path+' failed: '+JSON.stringify(data.errors||[]));return data.result;};
const settings=await api('/workers/scripts/'+script+'/settings');
const names=settings.bindings.map(binding=>binding.name);
if(!names.includes('FAL_KEY'))throw Error('FAL_KEY secret is missing; nothing activated');
const packed=settings.bindings.find(binding=>binding.name==='FAL_CONFIG_JSON'&&binding.type==='plain_text');
let bindings;
if(packed){
 const value=JSON.parse(packed.text);
 console.log('Current fal state:',JSON.stringify({enabled:value.enabled,accountStatus:value.accountStatus,catalog:value.catalog.map(item=>({id:item.id,kind:item.kind,tasks:item.tasks})),policy:value.pricingPolicy?.items}));
 value.enabled=true;value.accountStatus='ready';
 bindings=settings.bindings.filter(binding=>binding.name!=='FAL_CONFIG_JSON');bindings.push({type:'plain_text',name:'FAL_CONFIG_JSON',text:JSON.stringify(value)});
}else{
 console.log('Legacy fal variables:',JSON.stringify(settings.bindings.filter(binding=>/^FAL_(GENERATION_ENABLED|ACCOUNT_STATUS)$/.test(binding.name)).map(binding=>({name:binding.name,text:binding.text}))));
 bindings=settings.bindings.filter(binding=>!['FAL_GENERATION_ENABLED','FAL_ACCOUNT_STATUS'].includes(binding.name));
 bindings.push({type:'plain_text',name:'FAL_GENERATION_ENABLED',text:'true'},{type:'plain_text',name:'FAL_ACCOUNT_STATUS',text:'ready'});
}
const approved=[];
for(const candidate of CANDIDATES){
 try{const response=await fetch('https://fal.ai/api/openapi/queue/openapi.json?endpoint_id='+encodeURIComponent(candidate.id),{signal:AbortSignal.timeout(20000)});if(!response.ok){console.log('skip',candidate.id,'schéma HTTP',response.status);continue;}
  const result=boundedModel(candidate,await response.json());if(result.skip){console.log('skip',candidate.id,result.skip);continue;}approved.push(result.model);console.log('ok',candidate.id,Object.keys(result.model.inputSchema.properties).join(','));}
 catch(error){console.log('skip',candidate.id,String(error).slice(0,120));}
}
// Store premium models in the production R2 bucket the Worker already reads
// (internal/fal-approved-models.json); Worker variables are at their limit.
const bucket=settings.bindings.find(binding=>binding.name==='BUCKET'&&binding.type==='r2_bucket')?.bucket_name;
if(!bucket)throw Error('Production BUCKET binding not found');
const objectPath='/r2/buckets/'+encodeURIComponent(bucket)+'/objects/'+encodeURIComponent('internal/fal-approved-models.json');
let existing=[];
{const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+objectPath,{headers:{authorization:'Bearer '+token}});if(response.ok){try{existing=JSON.parse(await response.text()).items||[];}catch{existing=[];}}else if(response.status!==404)throw Error('R2 read failed '+response.status+': '+(await response.text()).slice(0,200));}
const merged=new Map(existing.map(item=>[item.id,item]));for(const model of approved)merged.set(model.id,{...model,quote:merged.get(model.id)?.quote});
if(approved.length){const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+objectPath,{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({version:1,items:[...merged.values()].slice(0,40)})});if(!response.ok)throw Error('R2 write failed '+response.status+': '+(await response.text()).slice(0,200));console.log('Stored',merged.size,'approved models in R2');}
bindings=bindings.filter(binding=>binding.name!=='FAL_APPROVED_MODELS_JSON');
const form=new FormData();form.set('settings',JSON.stringify({bindings}));
await api('/workers/scripts/'+script+'/settings','PATCH',form);
const after=await api('/workers/scripts/'+script+'/settings');
const missing=names.filter(name=>!after.bindings.some(binding=>binding.name===name));
if(missing.length)throw Error('Bindings lost during activation: '+missing.join(', '));
console.log('fal.ai marked ready with '+approved.length+' premium models; all '+names.length+' bindings preserved. Each generation still requires an approved proposal and is repriced from fal.');
