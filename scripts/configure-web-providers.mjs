// No keys, provider URLs or project IDs are supplied by an agent or end user API.
import {readFile}from'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token||!process.env.BROWSERBASE_API_KEY||!process.env.FIRECRAWL_API_KEY)throw Error('Provider release credentials missing');
const proof=JSON.parse(await readFile('.tmp/web-provider-proof.json','utf8'));if(!proof.ok||proof.commit!==process.env.GITHUB_SHA||proof.browserbase?.checks?.length!==7||Date.now()-Date.parse(proof.at)>3600000)throw Error('A fresh proof for this exact revision is required');
const config={version:1,browserbase:{apiKey:process.env.BROWSERBASE_API_KEY,enabled:true,verified:true,verifiedAt:proof.at,liveVerified:true,mode:'free_only',maxSessionSeconds:300,maxBrowserMinutes:60},firecrawl:{apiKey:process.env.FIRECRAWL_API_KEY,enabled:true,verified:true,verifiedAt:proof.at,mode:'free_only',maxCredits:900}};
const api=async(p,method='GET',body)=>{const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+p,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error('Provider configuration failed '+r.status);return j.result;};
const settings=await api('/workers/scripts/aira-production/settings');
const count=settings.bindings.filter(x=>['plain_text','secret_text'].includes(x.type)&&x.name!=='WEB_PROVIDERS_JSON').length;if(count+1>64)throw Error('Cloudflare variable limit reached; preserve existing configuration');
await api('/workers/scripts/aira-production/secrets','PUT',{name:'WEB_PROVIDERS_JSON',type:'secret_text',text:JSON.stringify(config)});
const current=await api('/workers/scripts/aira-production/settings'),bindings=current.bindings.filter(x=>x.name!=='BROWSER_ENABLED');bindings.push({type:'plain_text',name:'BROWSER_ENABLED',text:'true'});const form=new FormData();form.set('settings',JSON.stringify({bindings}));await api('/workers/scripts/aira-production/settings','PATCH',form);
console.log('Browserbase and Firecrawl activated after bounded real tests; provider keys remain server-only. No paid plan, proxy or model gateway enabled.');
