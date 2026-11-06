// Reuse the live Worker and its bindings. Secrets and variables remain remote.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertProductionSource,productionSourceAnnotation} from './production-source-policy.mjs';
const root=process.cwd();
const built=JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!/^[a-f0-9]{32}$/.test(account||'')||!process.env.CLOUDFLARE_API_TOKEN)throw new Error('Cloudflare deployment credentials are missing.');
const script='aira-production';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
if(process.env.GITHUB_SHA&&process.env.GITHUB_SHA!==candidate)throw Error('The checked-out source does not match the verified GitHub revision.');
const readWorker=async suffix=>{const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}${suffix}`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(30000)});const json=await r.json();if(!r.ok||!json.success)throw Error('Unable to verify the live production source (HTTP '+r.status+', codes '+(Array.isArray(json.errors)?json.errors.map(error=>Number(error.code)||0).join(','):'unknown')+').');return json.result;};
const deployments=(await readWorker('/deployments')).deployments;
const deployment=deployments[0];
if(deployment.versions.length!==1||deployment.versions[0].percentage!==100)throw Error('Resolve the current split deployment before publishing.');
const liveVersion=await readWorker('/versions/'+deployment.versions[0].version_id);
let sourceAnnotation;
try{sourceAnnotation=productionSourceAnnotation(liveVersion);}catch{
 const history=[];
 const ids=[...new Set(deployments.flatMap(item=>item.versions.map(version=>version.version_id)))].filter(id=>id!==liveVersion.id).slice(0,10);
 for(const id of ids){history.push(await readWorker('/versions/'+id));try{sourceAnnotation=productionSourceAnnotation(liveVersion,history);break;}catch{/* Continue the bounded fingerprint search. */}}
 if(!sourceAnnotation)throw Error('The current script has no verified source provenance.');
}
assertProductionSource(candidate,sourceAnnotation,(live,next)=>spawnSync('git',['merge-base','--is-ancestor',live,next],{cwd:sourceRoot,stdio:'ignore'}).status===0);
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}/settings`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`}});
const body=await response.json();if(!response.ok||!body.success)throw new Error('Unable to read the current production settings.');
const bindings=body.result.bindings;
const binding=name=>{const result=bindings.find(item=>item.name===name);if(!result)throw new Error(`Production binding ${name} is missing.`);return result;};
const database=binding('DB'),files=binding('BUCKET'),backups=binding('BACKUP_BUCKET'),browserSessions=binding('BROWSER_SESSIONS');
if(database.type!=='d1'||files.type!=='r2_bucket'||backups.type!=='r2_bucket'||browserSessions.type!=='durable_object_namespace')throw new Error('Unexpected production binding types.');
// Published sites are served on this Worker's own workers.dev address (separate
// domain). Enable it only when the account has a workers.dev subdomain, so a
// missing subdomain can never block the app deploy.
let sitesOrigin='';
try{
 const answer=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000)}),sub=await answer.json().catch(()=>null);
 if(sub?.success&&/^[a-z0-9-]{1,63}$/.test(sub.result?.subdomain||''))sitesOrigin=`https://${script}.${sub.result.subdomain}.workers.dev`;
 // Cloudflare's own reason (status and error codes only, never the token).
 else console.log(`No readable workers.dev subdomain (HTTP ${answer.status}; ${(sub?.errors||[]).map(e=>`${e.code}: ${e.message}`).join(' | ')||'no subdomain registered'}): published sites stay off.`);
}catch{console.log('workers.dev subdomain unavailable: published sites stay off.');}
if(sitesOrigin&&process.env.GITHUB_ENV)(await import('node:fs')).appendFileSync(process.env.GITHUB_ENV,`BRAAND_SITES_ORIGIN=${sitesOrigin}\n`);
const config={name:script,account_id:account,main:path.join(root,'dist/server/index.js'),no_bundle:true,
 compatibility_date:built.compatibility_date,compatibility_flags:built.compatibility_flags,rules:built.rules,
 assets:{directory:path.join(root,'dist/client')},workers_dev:!!sitesOrigin,preview_urls:false,keep_vars:true,
 routes:[{pattern:'braand.fun/*',zone_id:'736e266fe4cc31e9ae5848c47e39ef2c'}],
 d1_databases:[{binding:'DB',database_id:database.id,database_name:'aira-production',migrations_dir:path.join(root,'drizzle')}],
 r2_buckets:[{binding:'BUCKET',bucket_name:files.bucket_name},{binding:'BACKUP_BUCKET',bucket_name:backups.bucket_name}],
 durable_objects:{bindings:[{name:'BROWSER_SESSIONS',class_name:browserSessions.class_name||'BrowserSession'}]},
 migrations:built.migrations,browser:built.browser,triggers:{crons:['*/5 * * * *','* * * * *']},observability:{enabled:false},
 // Run the Worker next to its database: one trip for the user instead of one per query.
 placement:{mode:'smart'}};
// The isolated vault is optional. Preserve its private binding once configured;
// never bind its database or master encryption key to the main application.
const vault=bindings.find(item=>item.name==='CREDENTIAL_VAULT');
if(vault){
 if(vault.type!=='service'||vault.service!=='braand-vault-production')throw Error('Unexpected production vault service binding.');
 config.services=[{binding:'CREDENTIAL_VAULT',service:vault.service,...(vault.environment?{environment:vault.environment}:{}),...(vault.entrypoint?{entrypoint:vault.entrypoint}:{})}];
}
// The isolated code sandbox is optional too: keep its private service binding once activated.
const sandbox=bindings.find(item=>item.name==='CODE_SANDBOX');
if(sandbox){
 if(sandbox.type!=='service'||sandbox.service!=='braand-code-sandbox-production')throw Error('Unexpected production code sandbox service binding.');
 config.services=[...(config.services||[]),{binding:'CODE_SANDBOX',service:sandbox.service,...(sandbox.environment?{environment:sandbox.environment}:{}),...(sandbox.entrypoint?{entrypoint:sandbox.entrypoint}:{})}];
}
const workQueue=bindings.find(item=>item.name==='WORK_QUEUE'&&item.type==='queue')?.queue_name||process.env.BRAAND_PRODUCTION_WORK_QUEUE;
if(workQueue){
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(workQueue))throw new Error('Invalid production work queue.');
 const deadLetter=process.env.BRAAND_PRODUCTION_WORK_DEAD_LETTER_QUEUE||workQueue+'-failed';
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(deadLetter))throw new Error('Invalid production dead-letter queue.');
 config.queues={producers:[{binding:'WORK_QUEUE',queue:workQueue}],consumers:[{queue:workQueue,max_batch_size:1,max_retries:3,dead_letter_queue:deadLetter}]};
}
// In particular, never replace live vars with the closed defaults from the base generator.
await mkdir(path.join(root,'.wrangler/deploy'),{recursive:true});
await writeFile(path.join(root,'.wrangler/deploy/production-live.json'),JSON.stringify(config,null,2)+'\n');
console.log('Prepared existing aira-production Worker; live variables and secrets preserved.');
