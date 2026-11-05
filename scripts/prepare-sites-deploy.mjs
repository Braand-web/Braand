// Build the public sites Worker manifest from the live main Worker's bindings,
// so it reads the same D1 database and R2 bucket. It never receives a secret.
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw new Error('Cloudflare deployment credentials are missing.');
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/aira-production/settings`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
const body=await response.json();if(!response.ok||!body.success)throw new Error('Unable to read the production bindings.');
const find=name=>{const item=body.result.bindings.find(binding=>binding.name===name);if(!item)throw new Error(`Production binding ${name} is missing.`);return item;};
const database=find('DB'),files=find('BUCKET');
if(database.type!=='d1'||files.type!=='r2_bucket')throw new Error('Unexpected production binding types.');
const root=process.cwd();
const config={name:'braand-sites',account_id:account,main:path.join(root,'services/sites/handler.mjs'),compatibility_date:'2026-09-02',
 workers_dev:true,preview_urls:false,observability:{enabled:false},
 d1_databases:[{binding:'DB',database_id:database.id,database_name:'aira-production'}],
 r2_buckets:[{binding:'BUCKET',bucket_name:files.bucket_name}]};
await mkdir(path.join(root,'.wrangler/deploy'),{recursive:true});
await writeFile(path.join(root,'.wrangler/deploy/sites.json'),JSON.stringify(config,null,2)+'\n');
console.log('Prepared the braand-sites Worker on the production database and file bucket.');
