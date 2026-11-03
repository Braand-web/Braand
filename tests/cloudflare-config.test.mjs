import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentConfig} from '../scripts/cloudflare-config.mjs';
const input={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),BRAAND_STAGING_D1_ID:'12345678-1234-4234-8234-123456789abc',BRAAND_STAGING_FILES_BUCKET:'braand-staging-files',BRAAND_STAGING_BACKUPS_BUCKET:'braand-staging-backups'};
const built={main:'index.js',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],durable_objects:{bindings:[{name:'BROWSER_SESSIONS',class_name:'BrowserSession'}]},browser:{binding:'BROWSER'},migrations:[{tag:'browser-sessions-v1',new_sqlite_classes:['BrowserSession']}]};
test('Cloudflare deployments keep resource isolation and start closed',()=>{const c=deploymentConfig('staging',input,built,'/braand');assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.deepEqual(c.routes,[]);assert.equal(c.vars.AUTH_ENABLED,'false');assert.equal(c.vars.BILLING_ENABLED,'false');assert.equal(c.vars.SASPAY_ENV,'sandbox');assert.equal(c.vars.COMPOSIO_INSTANT_ENABLED,'false');assert.equal(c.d1_databases[0].database_id,input.BRAAND_STAGING_D1_ID);assert.equal(c.r2_buckets[1].binding,'BACKUP_BUCKET');assert.deepEqual(c.triggers.crons,['*/5 * * * *','* * * * *']);assert.equal(c.browser.binding,'BROWSER');assert.equal(c.observability.enabled,false);});
test('missing or placeholder cloud resources are rejected',()=>{for(const patch of [{CLOUDFLARE_ACCOUNT_ID:''},{BRAAND_STAGING_D1_ID:'00000000-0000-4000-8000-000000000000'},{BRAAND_STAGING_FILES_BUCKET:''},{BRAAND_STAGING_BACKUPS_BUCKET:input.BRAAND_STAGING_FILES_BUCKET}])assert.throws(()=>deploymentConfig('staging',{...input,...patch},built));});
test('staging cannot reuse a production database or bucket',()=>{for(const suffix of ['D1_ID','FILES_BUCKET','BACKUPS_BUCKET'])assert.throws(()=>deploymentConfig('staging',{...input,['BRAAND_PRODUCTION_'+suffix]:input['BRAAND_STAGING_'+suffix]},built));});
test('deployment cannot target an arbitrary environment or obsolete build',()=>{assert.throws(()=>deploymentConfig('live',input,built));assert.throws(()=>deploymentConfig('staging',input,{...built,main:'untrusted.js'}));});

test('database-only staging remains private and cannot advertise files or backups',()=>{
  const partial={CLOUDFLARE_ACCOUNT_ID:input.CLOUDFLARE_ACCOUNT_ID,BRAAND_STAGING_D1_ID:input.BRAAND_STAGING_D1_ID};
  const c=deploymentConfig('staging',partial,built,'/braand',{databaseOnly:true});
  assert.deepEqual(c.r2_buckets,[]);assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.deepEqual(c.routes,[]);
  for(const flag of ['AUTH_ENABLED','BACKUP_ENABLED','BROWSER_ENABLED','AUTONOMY_ENABLED','BILLING_ENABLED','COMPOSIO_INSTANT_ENABLED','MODEL_ROUTING_ENABLED','FILE_PREVIEW_V1'])assert.equal(c.vars[flag],'false');
  assert.equal(c.d1_databases[0].database_id,input.BRAAND_STAGING_D1_ID);
});
test('database-only staging still requires a real isolated D1 database',()=>{
  for(const patch of [{CLOUDFLARE_ACCOUNT_ID:''},{BRAAND_STAGING_D1_ID:'00000000-0000-4000-8000-000000000000'},{BRAAND_PRODUCTION_D1_ID:input.BRAAND_STAGING_D1_ID}])assert.throws(()=>deploymentConfig('staging',{...input,...patch},built,'/braand',{databaseOnly:true}));
});
test('database-only mode cannot bypass the complete production storage configuration',()=>{
  assert.throws(()=>deploymentConfig('production',{},built,'/braand',{databaseOnly:true}),/limited to private staging/);
  assert.throws(()=>deploymentConfig('staging',{CLOUDFLARE_ACCOUNT_ID:input.CLOUDFLARE_ACCOUNT_ID,BRAAND_STAGING_D1_ID:input.BRAAND_STAGING_D1_ID},built));
});

test('public production routing and queues are explicit and isolated',()=>{const c=deploymentConfig('production',{...input,BRAAND_PRODUCTION_D1_ID:'22345678-1234-4234-8234-123456789abc',BRAAND_PRODUCTION_FILES_BUCKET:'aira-production-files',BRAAND_PRODUCTION_BACKUPS_BUCKET:'aira-production-backups',BRAAND_PRODUCTION_PUBLIC_ZONE_ID:'a'.repeat(32),BRAAND_PRODUCTION_WORK_QUEUE:'braand-work-production',BRAAND_PRODUCTION_WORK_DEAD_LETTER_QUEUE:'braand-work-production-failed'},built,'/braand');assert.deepEqual(c.routes,[{pattern:'braand.fun/*',zone_id:'a'.repeat(32)}]);assert.equal(c.queues.producers[0].binding,'WORK_QUEUE');assert.equal(c.queues.consumers[0].max_retries,3);assert.equal(c.vars.WORK_ENABLED,'false');});
test('the code sandbox is an optional, environment-matched service binding that starts disabled',()=>{
  const plain=deploymentConfig('staging',input,built,'/braand');assert.equal(plain.vars.CODE_SANDBOX_ENABLED,'false');assert.equal(plain.services,undefined);
  const bound=deploymentConfig('staging',{...input,BRAAND_STAGING_CODE_SANDBOX_SERVICE:'braand-code-sandbox-staging',BRAAND_STAGING_VAULT_SERVICE:'braand-vault-staging'},built,'/braand');
  assert.deepEqual(bound.services,[{binding:'CREDENTIAL_VAULT',service:'braand-vault-staging'},{binding:'CODE_SANDBOX',service:'braand-code-sandbox-staging'}]);assert.equal(bound.vars.CODE_SANDBOX_ENABLED,'false');
  assert.throws(()=>deploymentConfig('staging',{...input,BRAAND_STAGING_CODE_SANDBOX_SERVICE:'braand-code-sandbox-production'},built,'/braand'));
});
