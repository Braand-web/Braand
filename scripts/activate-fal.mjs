// Mark the funded fal.ai account as ready in production. Only the activation
// switch and account state of the packed FAL_CONFIG_JSON change; the reviewed
// catalogue, pricing policy, FAL_KEY secret and every other binding are kept.
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
const form=new FormData();form.set('settings',JSON.stringify({bindings}));
await api('/workers/scripts/'+script+'/settings','PATCH',form);
const after=await api('/workers/scripts/'+script+'/settings');
const missing=names.filter(name=>!after.bindings.some(binding=>binding.name===name));
if(missing.length)throw Error('Bindings lost during activation: '+missing.join(', '));
console.log('fal.ai marked ready; all '+names.length+' bindings preserved. Generation still requires an approved proposal.');
