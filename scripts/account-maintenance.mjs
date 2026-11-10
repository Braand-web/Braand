// Temporary, bounded maintenance job using the production DB binding. No secrets,
// personal data or customer content may be printed in GitHub's public logs.
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('Cloudflare credentials missing');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,...(body instanceof FormData?{}:body?{'content-type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error(`Cloudflare request failed (${r.status}, ${(j.errors||[]).map(e=>e.code).join(',')})`);return j.result;}
const settings=await api('/workers/scripts/aira-production/settings'),database=settings.bindings.find(b=>b.name==='DB'&&b.type==='d1')?.id;
if(!database)throw Error('Production DB binding missing');
const keep=JSON.parse(process.env.ACCOUNT_KEEP_EMAILS||'[]').map(value=>String(value).trim().toLowerCase());
if(keep.length!==3||new Set(keep).size!==3||keep.some(email=>!/^[-\w.+]+@[-\w.]+\.[a-z]{2,}$/.test(email)))throw Error('Exactly three distinct retained addresses required');
const ownerSource=readFileSync(new URL('../lib/platform-owners.ts',import.meta.url),'utf8');
const adminIds=[...(ownerSource.match(/PLATFORM_OWNER_IDS=\[([^\]]*)\]/)?.[1].matchAll(/'([^']+)'/g)||[])].map(match=>match[1]);
for(const b of settings.bindings)if(['OPS_ADMIN_IDS','BILLING_ADMIN_IDS'].includes(b.name)&&b.type==='plain_text')adminIds.push(...b.text.split(',').map(id=>id.trim()).filter(Boolean));
const name='braand-account-maintenance-'+randomBytes(6).toString('hex'),access=randomBytes(32).toString('base64url');
const metadata={main_module:'worker.mjs',compatibility_date:'2026-04-30',observability:{enabled:false},bindings:[{name:'DB',type:'d1',id:database},{name:'ACCESS',type:'secret_text',text:access},{name:'KEEP',type:'secret_text',text:JSON.stringify(keep)},{name:'ADMINS',type:'secret_text',text:JSON.stringify(adminIds)},{name:'EXPIRES_AT',type:'plain_text',text:String(Date.now()+10*60_000)}]};
const form=new FormData();form.set('metadata',JSON.stringify(metadata));form.set('worker.mjs',new Blob([readFileSync(new URL('../services/account-maintenance/worker.mjs',import.meta.url))],{type:'application/javascript+module'}),'worker.mjs');
let deployed=false;
try{
 await api('/workers/scripts/'+name,'PUT',form);deployed=true;
 await api('/workers/scripts/'+name+'/subdomain','POST',{enabled:true,previews_enabled:false});
 const subdomain=await api('/workers/subdomain');let result;
 for(let attempt=0;attempt<5;attempt++){
  const response=await fetch(`https://${name}.${subdomain.subdomain}.workers.dev/inspect`,{method:'POST',headers:{authorization:'Bearer '+access},signal:AbortSignal.timeout(90000)});
  if(response.status===403){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  if(!response.ok)throw Error('Maintenance inspection failed: '+response.status+' '+(await response.text()).slice(0,500));result=await response.json();break;
 }
 if(!result)throw Error('Maintenance endpoint unavailable');
 for(const [key,value]of Object.entries(result))console.log(key.toUpperCase()+' '+JSON.stringify(value));
}finally{if(deployed){await api('/workers/scripts/'+name,'DELETE');console.log('Temporary maintenance worker removed');}}
