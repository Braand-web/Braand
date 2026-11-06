// Generate an isolated, disabled code-sandbox manifest for one environment.
// Enabling it afterwards is explicit: set CODE_SANDBOX_ENABLED=true and the
// CODE_SANDBOX_CALL_TOKEN secret on this Worker and on the main Worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function sandboxDeploymentConfig(environment,input,root){
 if(!['staging','production'].includes(environment))throw Error('Choose staging or production.');
 const prefix='BRAAND_'+environment.toUpperCase()+'_';
 const instance=input[prefix+'CODE_SANDBOX_INSTANCE']||'basic';
 if(!['lite','basic','standard-1','standard-2','standard-3','standard-4'].includes(instance))throw Error('Choose a supported container instance type.');
 const internet=input[prefix+'CODE_SANDBOX_INTERNET']==='true';
 const enabled=input[prefix+'CODE_SANDBOX_ENABLED']==='true';
 return {
  name:'braand-code-sandbox-'+environment,main:path.join(root,'services/code-sandbox/worker.ts'),
  compatibility_date:'2026-09-02',compatibility_flags:['nodejs_compat'],
  // workers.dev serves live previews of the user's app, on a site separate from braand.fun.
  workers_dev:enabled,preview_urls:false,observability:{enabled:false},
  vars:{CODE_SANDBOX_ENABLED:enabled?'true':'false',CODE_SANDBOX_INTERNET:internet?'true':'false',CODE_SANDBOX_INSTANCE:instance},
  durable_objects:{bindings:[{name:'SANDBOX',class_name:'CodeSandbox'}]},
  containers:[{class_name:'CodeSandbox',scheduling_policy:'durable_object',images:{sandbox:{dockerfile:path.join(root,'services/code-sandbox/Dockerfile')}}}],
  migrations:[{tag:'code-sandbox-v1',new_sqlite_classes:['CodeSandbox']}],
 };
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const root=fileURLToPath(new URL('../../',import.meta.url)),environment=process.argv[2],output=path.join(root,'.wrangler/deploy/code-sandbox-'+environment+'.json');
 const value=sandboxDeploymentConfig(environment,process.env,root);
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(value,null,2));
 console.log('Prepared isolated, disabled code sandbox manifest: '+output);
}
