// Generate a standalone deployment manifest. Never copy local preview resource IDs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function deploymentConfig(environment, input, built, root=process.cwd(), options={}) {
  if (!['staging','production'].includes(environment)) throw new Error('Choose staging or production.');
  const databaseOnly=options.databaseOnly===true;
  if (databaseOnly && environment!=='staging') throw new Error('Database-only deployment is limited to private staging.');
  const prefix=environment==='staging'?'BRAAND_STAGING_':'BRAAND_PRODUCTION_';
  const account=input.CLOUDFLARE_ACCOUNT_ID, database=input[prefix+'D1_ID'], files=input[prefix+'FILES_BUCKET'], backups=input[prefix+'BACKUPS_BUCKET'];
  if (!/^[a-f0-9]{32}$/.test(account||'')) throw new Error('CLOUDFLARE_ACCOUNT_ID is required.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(database||'') || database==='00000000-0000-4000-8000-000000000000') throw new Error('A real environment-specific D1 ID is required.');
  if (!databaseOnly) {
    for (const value of [files,backups]) if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value||'')) throw new Error('Separate private R2 bucket names are required.');
    if (files===backups) throw new Error('Backups must use a separate bucket.');
  }
  for (const suffix of ['D1_ID','FILES_BUCKET','BACKUPS_BUCKET']) {
    const other=environment==='staging'?'BRAAND_PRODUCTION_':'BRAAND_STAGING_';
    if (input[other+suffix] && input[prefix+suffix]===input[other+suffix]) throw new Error('Staging and production must not share resources.');
  }
  if (built.main!=='index.js' || !built.durable_objects?.bindings?.some(b=>b.class_name==='BrowserSession')) throw new Error('Build the current Braand Worker before deploying.');
  const queue=input[prefix+'WORK_QUEUE'],deadLetter=input[prefix+'WORK_DEAD_LETTER_QUEUE'];
  if(!!queue!==!!deadLetter || [queue,deadLetter].some(name=>name&&!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name)))throw new Error('Choose both environment-specific work queues.');
  const publicZone=input.BRAAND_PRODUCTION_PUBLIC_ZONE_ID;
  const vaultService=input[prefix+'VAULT_SERVICE'];
  if(vaultService&&!/^[a-z][a-z0-9-]{2,62}$/.test(vaultService))throw new Error('Choose the environment-specific credential vault Worker.');
  const sandboxService=input[prefix+'CODE_SANDBOX_SERVICE'];
  if(sandboxService&&(!/^[a-z][a-z0-9-]{2,62}$/.test(sandboxService)||!sandboxService.endsWith('-'+environment)))throw new Error('Choose the environment-specific code sandbox Worker.');
  const services=[...(vaultService?[{binding:'CREDENTIAL_VAULT',service:vaultService}]:[]),...(sandboxService?[{binding:'CODE_SANDBOX',service:sandboxService}]:[])];
  if(publicZone&&!/^[a-f0-9]{32}$/.test(publicZone))throw new Error('A verified production public zone is required.');
  return {
    name:'braand-'+environment,account_id:account,main:path.join(root,'dist/server/index.js'),
    compatibility_date:built.compatibility_date,compatibility_flags:built.compatibility_flags,
    no_bundle:true,rules:built.rules,assets:{directory:path.join(root,'dist/client')},
    workers_dev:false,preview_urls:false,routes:environment==='production'&&publicZone?[{pattern:'braand.fun/*',zone_id:publicZone}]:[],
    d1_databases:[{binding:'DB',database_name:'braand-'+environment,database_id:database,migrations_dir:path.join(root,'drizzle')}],
    r2_buckets:databaseOnly?[]:[{binding:'BUCKET',bucket_name:files},{binding:'BACKUP_BUCKET',bucket_name:backups}],
    durable_objects:built.durable_objects,migrations:built.migrations,browser:built.browser,
    ...(services.length?{services}:{}),
    triggers:{crons:['*/5 * * * *','* * * * *']},observability:{enabled:false},placement:{mode:'smart'},
    ...(queue?{queues:{producers:[{binding:'WORK_QUEUE',queue}],consumers:[{queue,max_batch_size:1,max_retries:3,dead_letter_queue:deadLetter}]}}:{}),
    // Never claim an unperformed acceptance test by enabling a readiness flag.
    vars:{APP_ENV:environment,AUTH_ENABLED:'false',BILLING_ENABLED:'false',SASPAY_ENV:'sandbox',
      RESEND_MODE:'disabled',RESEND_LIVE_APPROVED:'false',MODEL_ROUTING_ENABLED:'false',
      COMPOSIO_INSTANT_ENABLED:'false',BROWSER_ENABLED:'false',AUTONOMY_ENABLED:'false',
      VAULT_ENABLED:'false',BROWSER_LIVE_ENABLED:'false',CODE_SANDBOX_ENABLED:'false',
      BACKUP_ENABLED:'false',FREE_DAILY_CREDITS:'0',FILE_PREVIEW_V1:'false',
      WORK_ENABLED:'false',WORK_STAGING_VERIFIED:'false',WORK_SCHEDULER_VERIFIED:'false',
      ROUTINES_ENABLED:'false',ROUTINES_STAGING_VERIFIED:'false',
      RESEARCH_ENABLED:'false',RESEARCH_STAGING_VERIFIED:'false',SOCIAL_ENABLED:'false',SOCIAL_PUBLISHING_ENABLED:'false',SOCIAL_SCHEDULING_ENABLED:'false',SOCIAL_COMMENTS_ENABLED:'false',SOCIAL_INSIGHTS_ENABLED:'false',SOCIAL_STAGING_VERIFIED:'false',
      SOCIAL_INSTAGRAM_ENABLED:'false',SOCIAL_FACEBOOK_ENABLED:'false',SOCIAL_LINKEDIN_ENABLED:'false',SOCIAL_TIKTOK_ENABLED:'false',
      MEDIA_PERSIST_ENABLED:'false',MEDIA_RENDER_ENABLED:'false',MEDIA_RENDER_STAGING_VERIFIED:'false',MEDIA_RENDER_VIDEO_EDIT_VERIFIED:'false'},
  };
}
async function main() {
  const environment=process.argv[2];
  const flags=process.argv.slice(3);
  if (flags.some(flag=>flag!=='--database-only') || flags.length>1) throw new Error('Only --database-only is supported.');
  const databaseOnly=flags.includes('--database-only');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const built=JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
  const config=deploymentConfig(environment,process.env,built,root,{databaseOnly});
  const output=path.join(root,'.wrangler','deploy',environment+(databaseOnly?'-db-only':'')+'.json');
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(config,null,2)+'\n');
  console.log(`Prepared ${environment}: private Worker, ${databaseOnly?'D1 only; files and backups unavailable':'isolated D1/R2'}, no billable features enabled. Manifest: ${output}`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) await main();
