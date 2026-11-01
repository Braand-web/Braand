import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function vaultDeploymentConfig(environment,input,root){
 if(!['staging','production'].includes(environment))throw Error('Choose staging or production.');
 const prefix='BRAAND_'+environment.toUpperCase()+'_',database=input[prefix+'VAULT_D1_ID'],mainDatabase=input[prefix+'D1_ID'],other=input['BRAAND_'+(environment==='production'?'STAGING':'PRODUCTION')+'_VAULT_D1_ID'],browser=input[prefix+'BROWSER_WORKER'];
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 if(!uuid.test(database||'')||!uuid.test(mainDatabase||'')||database===mainDatabase||database===other)throw Error('A separate environment-specific vault D1 database is required.');
 if(!/^[a-z][a-z0-9-]{2,62}$/.test(browser||''))throw Error('Specify the exact browser Worker for this environment.');
 if(environment==='staging'&&/production/.test(browser)||environment==='production'&&/staging/.test(browser))throw Error('The browser Worker must use the same environment.');
 return {name:'braand-vault-'+environment,main:path.join(root,'services/credential-vault/worker.ts'),compatibility_date:'2026-10-01',workers_dev:false,preview_urls:false,observability:{enabled:false},vars:{VAULT_ENABLED:'false'},d1_databases:[{binding:'VAULT_DB',database_name:'braand-vault-'+environment,database_id:database,migrations_dir:path.join(root,'services/credential-vault/migrations')}],durable_objects:{bindings:[{name:'BROWSER_SESSIONS',class_name:'BrowserSession',script_name:browser}]}};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const root=fileURLToPath(new URL('../../',import.meta.url)),environment=process.argv[2],output=path.join(root,'.wrangler/deploy/vault-'+environment+'.json');const value=vaultDeploymentConfig(environment,process.env,root);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(value,null,2));console.log('Prepared isolated, disabled vault manifest: '+output);}
