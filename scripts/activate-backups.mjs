// Turn on the daily encrypted backup. Frees a slot by removing the unused
// WORK_SCHEDULER_VERIFIED switch (the work queue binding already schedules
// work). Every other binding is preserved; the 64-variable limit is checked.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,script='aira-production';
if(!account||!token)throw Error('Cloudflare credentials missing');
const api=async(path,method='GET',body)=>{const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok||!data.success)throw Error('Cloudflare API '+method+' '+path+' failed: '+JSON.stringify(data.errors||[]));return data.result;};
const settings=await api('/workers/scripts/'+script+'/settings'),names=settings.bindings.map(binding=>binding.name);
for(const required of ['BACKUP_BUCKET','BUCKET','BACKUP_ENCRYPTION_KEY','WORK_QUEUE'])if(!names.includes(required))throw Error(required+' is missing; nothing changed');
const removed=['WORK_SCHEDULER_VERIFIED','BACKUP_ENABLED','BACKUP_MAINTENANCE_CONFIRMED'];
const bindings=settings.bindings.filter(binding=>!removed.includes(binding.name));
bindings.push({type:'plain_text',name:'BACKUP_ENABLED',text:'true'},{type:'plain_text',name:'BACKUP_MAINTENANCE_CONFIRMED',text:'true'});
const textCount=bindings.filter(binding=>['plain_text','secret_text'].includes(binding.type)).length;
if(textCount>64)throw Error('Cloudflare variable limit reached ('+textCount+'); nothing changed');
const form=new FormData();form.set('settings',JSON.stringify({bindings}));
await api('/workers/scripts/'+script+'/settings','PATCH',form);
const after=(await api('/workers/scripts/'+script+'/settings')).bindings.map(binding=>binding.name);
const lost=names.filter(name=>name!=='WORK_SCHEDULER_VERIFIED'&&!after.includes(name));
if(lost.length)throw Error('Bindings lost: '+lost.join(', '));
console.log('Daily encrypted backup enabled ('+textCount+'/64 variables). All other bindings preserved.');
