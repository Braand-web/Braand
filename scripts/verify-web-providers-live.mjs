// Runs only in the explicitly requested GitHub release job. No customer identity.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,bb=process.env.BROWSERBASE_API_KEY,fc=process.env.FIRECRAWL_API_KEY;
if(!account||!token||!bb||!fc)throw Error('Provider release credentials missing');
const secrets=[token,bb,fc],safe=value=>secrets.reduce((out,s)=>out.replaceAll(s,'[REDACTED]'),String(value));
const api=async(pathname,method='GET',body)=>{const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+pathname,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error('Cloudflare provider check failed '+r.status);return j.result;};
async function json(url,init){const r=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Provider check failed '+r.status);return r.json();}
const fireHeaders={authorization:'Bearer '+fc,'content-type':'application/json'},quota=await json('https://api.firecrawl.dev/v2/team/credit-usage',{headers:fireHeaders});
assert.ok(quota.success&&quota.data.planCredits<=1000&&quota.data.remainingCredits>=3,'Free Firecrawl quota required');
const search=await json('https://api.firecrawl.dev/v2/search',{method:'POST',headers:fireHeaders,body:JSON.stringify({query:'Firecrawl web scraping API',includeDomains:['firecrawl.dev'],sources:['web'],limit:3})});assert.ok(search.success&&search.data.web?.some(item=>new URL(item.url).hostname==='firecrawl.dev'||new URL(item.url).hostname.endsWith('.firecrawl.dev')));
const scrape=await json('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:fireHeaders,body:JSON.stringify({url:'https://www.firecrawl.dev',formats:['markdown'],parsers:[],proxy:'auto',storeInCache:false})});assert.ok(scrape.success&&typeof scrape.data.markdown==='string'&&/firecrawl/i.test(scrape.data.markdown));
console.log('PASS Firecrawl real search and markdown scrape using the free quota');
const name='braand-provider-probe-'+randomBytes(5).toString('hex'),probeToken=randomBytes(32).toString('base64url'),root=process.cwd(),directory=path.join(root,'.tmp/provider-probe');
await mkdir(directory,{recursive:true});
const staging=await api('/workers/scripts/aira-staging/settings'),database=staging.bindings.find(x=>x.name==='DB'&&x.type==='d1');assert.ok(database);
const manifest={name,account_id:account,main:path.join(root,'services/provider-probe/worker.ts'),compatibility_date:'2026-04-30',compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,observability:{enabled:false},d1_databases:[{binding:'DB',database_id:database.id,database_name:'aira-staging'}]};
const manifestPath=path.join(directory,'wrangler.json');await writeFile(manifestPath,JSON.stringify(manifest));
let deployed=false;
try{
 let output='';const cli=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config',manifestPath,'--no-x-provision','--message','Temporary bounded provider integration check'],{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'}});
 for(const stream of [cli.stdout,cli.stderr])stream.on('data',part=>output+=part.toString());
 const code=await new Promise((resolve,reject)=>{cli.once('exit',resolve);cli.once('error',reject);});if(code!==0)throw Error(safe(output).slice(-3000));deployed=true;
 const settings={version:1,browserbase:{apiKey:bb,enabled:true,verified:true,verifiedAt:new Date().toISOString(),mode:'free_only',maxSessionSeconds:60,maxBrowserMinutes:60}};
 for(const [key,value]of Object.entries({WEB_PROVIDERS_JSON:JSON.stringify(settings),PROBE_TOKEN:probeToken})){secrets.push(value);await api('/workers/scripts/'+name+'/secrets','PUT',{name:key,text:value,type:'secret_text'});}
 const subdomain=await api('/workers/subdomain'),url='https://'+name+'.'+subdomain.subdomain+'.workers.dev/run';let result;
 for(let attempt=0;attempt<5;attempt++){const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+probeToken},signal:AbortSignal.timeout(90000)});if(r.status===403){await new Promise(resolve=>setTimeout(resolve,1000));continue;}result=await r.json();break;}
 assert.equal(result?.ok,true,JSON.stringify(result));assert.equal(result.checks.length,7);
 console.log(JSON.stringify({browserbase:result,firecrawl:{search:true,pageRead:true},at:new Date().toISOString()}));
 await writeFile(path.join(root,'.tmp/web-provider-proof.json'),JSON.stringify({ok:true,browserbase:result,firecrawl:{search:true,pageRead:true},commit:process.env.GITHUB_SHA,at:new Date().toISOString()}));
}finally{if(deployed)await api('/workers/scripts/'+name+'?force=true','DELETE');}
