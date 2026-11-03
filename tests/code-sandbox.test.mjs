import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSandboxRequest,workspacePath,SANDBOX_LIMITS} from '../services/code-sandbox/handler.ts';
import {codeSandboxReady,codeSandboxSession,runCodeSandboxTool,CODE_SANDBOX_RUN_LIMITS} from '../lib/code-sandbox.ts';
import {sandboxDeploymentConfig} from '../services/code-sandbox/prepare-config.mjs';

const token='t'.repeat(40),name='a'.repeat(40);
const env={CODE_SANDBOX_ENABLED:'true',CODE_SANDBOX_CALL_TOKEN:token};
function fakeBackend(){
 const calls=[],files=new Map();
 return {calls,files,backend:{
  async exec(argv,timeout){calls.push({argv,timeout});const command=argv.at(-1);if(command==='slow')return {exitCode:124,stdout:'',stderr:''};if(command==='big')return {exitCode:0,stdout:'x'.repeat(SANDBOX_LIMITS.outputChars*2),stderr:''};return {exitCode:command==='false'?1:0,stdout:'ran '+command,stderr:''};},
  async writeFile(path,content){files.set(path,content);},
  async readFile(path){if(!files.has(path))throw Object.assign(Error('missing'),{code:'ENOENT'});return files.get(path);},
  async list(){return [...files.keys()].map(key=>({name:key.split('/').pop(),type:'file'}));},
  async reset(){files.clear();},
 }};
}
const call=(operation,body,{headers={},environment=env,backend=fakeBackend().backend}={})=>handleSandboxRequest(new Request('https://sandbox.internal/'+operation,{method:'POST',headers:{authorization:'Bearer '+token,'x-sandbox-name':name,'content-type':'application/json',...headers},body:JSON.stringify(body)}),environment,()=>backend);

test('sandbox Worker fails closed without configuration, token or a valid sandbox name',async()=>{
 assert.equal((await call('exec',{command:'ls'},{environment:{}})).status,503);
 assert.equal((await call('exec',{command:'ls'},{environment:{...env,CODE_SANDBOX_CALL_TOKEN:'short'}})).status,503);
 assert.equal((await call('exec',{command:'ls'},{headers:{authorization:'Bearer wrong'}})).status,403);
 assert.equal((await call('exec',{command:'ls'},{headers:{'x-sandbox-name':'tenant-1'}})).status,403);
 assert.equal((await handleSandboxRequest(new Request('https://evil.example/exec',{method:'POST',headers:{authorization:'Bearer '+token,'x-sandbox-name':name},body:'{}'}),env,()=>fakeBackend().backend)).status,403);
 assert.equal((await call('shell',{})).status,404);
});

test('paths stay inside /workspace and traversal is refused',()=>{
 assert.equal(workspacePath('src/index.ts'),'/workspace/src/index.ts');
 assert.equal(workspacePath('/workspace/a/../b.txt'),'/workspace/b.txt');
 for(const bad of ['../etc/passwd','/etc/passwd','/workspace/../root','/workspacex/file','a\0b',''])assert.equal(workspacePath(bad),undefined,bad);
});

test('commands are wrapped in a process-tree timeout, bounded and clipped',async()=>{
 const fake=fakeBackend();
 const ok=await (await call('exec',{command:'npm test',timeoutSeconds:30},{backend:fake.backend})).json();
 assert.deepEqual(fake.calls[0].argv,['timeout','-k','5','30','sh','-lc','npm test']);assert.equal(fake.calls[0].timeout,40);
 assert.equal(ok.exitCode,0);assert.equal(ok.stdout,'ran npm test');assert.equal(ok.timedOut,false);
 assert.equal((await (await call('exec',{command:'slow'},{backend:fake.backend})).json()).timedOut,true);
 const big=await (await call('exec',{command:'big'},{backend:fake.backend})).json();assert.equal(big.truncated,true);assert.ok(big.stdout.length<SANDBOX_LIMITS.outputChars+100);
 assert.equal((await call('exec',{command:'ls',timeoutSeconds:SANDBOX_LIMITS.maxTimeoutSeconds+1})).status,400);
 assert.equal((await call('exec',{command:'ls',extra:true})).status,400);
});

test('file operations write, read with offsets, list and map Linux errors',async()=>{
 const fake=fakeBackend();
 assert.equal((await call('write',{path:'../escape',content:'x'},{backend:fake.backend})).status,400);
 const written=await (await call('write',{path:'app/main.py',content:'print(1)'},{backend:fake.backend})).json();assert.equal(written.path,'/workspace/app/main.py');assert.equal(written.bytes,8);
 const read=await (await call('read',{path:'/workspace/app/main.py',offset:2},{backend:fake.backend})).json();assert.equal(read.content,'int(1)');assert.equal(read.nextOffset,null);
 const missing=await call('read',{path:'nope'},{backend:fake.backend});assert.equal(missing.status,422);assert.equal((await missing.json()).errno,'ENOENT');
 assert.equal((await (await call('list',{},{backend:fake.backend})).json()).entries[0].name,'main.py');
 assert.equal((await call('write',{path:'big',content:'x'.repeat(SANDBOX_LIMITS.fileBytes+1)})).status,400);
});

test('client is ready only with binding, flag and strong token; names are opaque and stable',async()=>{
 const fetcher={fetch:async()=>Response.json({})};
 assert.equal(codeSandboxReady({}),false);assert.equal(codeSandboxReady({CODE_SANDBOX:fetcher,CODE_SANDBOX_ENABLED:'true',CODE_SANDBOX_CALL_TOKEN:'x'}),false);
 assert.equal(codeSandboxReady({CODE_SANDBOX:fetcher,...env}),true);
 const a=await codeSandboxSession('tenant','conv'),b=await codeSandboxSession('tenant','conv'),c=await codeSandboxSession('tenant','other');
 assert.match(a.sandboxName,/^[a-f0-9]{40}$/);assert.equal(a.sandboxName,b.sandboxName);assert.notEqual(a.sandboxName,c.sandboxName);assert.ok(!a.sandboxName.includes('tenant'));
});

test('client forwards to the service binding, enforces run limits and maps refusals',async()=>{
 const requests=[];const fetcher={fetch:async(url,init)=>{requests.push({url,init,body:JSON.parse(init.body)});if(url.endsWith('/read'))return Response.json({code:'sandbox_file_error',errno:'ENOENT'},{status:422});return Response.json({exitCode:0,stdout:'ok',durationMs:2500});}};
 const config={CODE_SANDBOX:fetcher,...env},session=await codeSandboxSession('t','c');
 const result=await runCodeSandboxTool(config,session,'code_run',{command:'node -v'});
 assert.equal(result.stdout,'ok');assert.equal(requests[0].url,'https://sandbox.internal/exec');assert.equal(requests[0].init.headers['x-sandbox-name'],session.sandboxName);assert.equal(requests[0].init.headers.authorization,'Bearer '+token);assert.deepEqual(requests[0].body,{command:'node -v',timeoutSeconds:60});
 assert.equal(session.calls,1);assert.equal(session.commandSeconds,3);
 await assert.rejects(()=>runCodeSandboxTool(config,session,'code_read_file',{path:'x'}),error=>error.code==='sandbox_file_error'&&/ENOENT/.test(error.message));
 await assert.rejects(()=>runCodeSandboxTool(config,session,'code_run',{command:'x',secret:true}));
 await assert.rejects(()=>runCodeSandboxTool({},session,'code_run',{command:'x'}),error=>error.code==='sandbox_unavailable');
 await assert.rejects(()=>runCodeSandboxTool(config,session,'shell',{}),error=>error.code==='sandbox_tool_unknown');
 session.calls=CODE_SANDBOX_RUN_LIMITS.calls;await assert.rejects(()=>runCodeSandboxTool(config,session,'code_list_files',{}),error=>error.code==='sandbox_run_limit');
 session.calls=0;session.commandSeconds=CODE_SANDBOX_RUN_LIMITS.commandSeconds-10;await assert.rejects(()=>runCodeSandboxTool(config,session,'code_run',{command:'x',timeoutSeconds:60}),error=>error.code==='sandbox_time_limit');
});

test('sandbox deployment manifest is isolated, disabled and offline by default',()=>{
 const c=sandboxDeploymentConfig('staging',{},'/braand');
 assert.equal(c.name,'braand-code-sandbox-staging');assert.equal(c.vars.CODE_SANDBOX_ENABLED,'false');assert.equal(c.vars.CODE_SANDBOX_INTERNET,'false');assert.equal(c.workers_dev,false);
 assert.equal(c.containers[0].class_name,'CodeSandbox');assert.equal(c.durable_objects.bindings[0].class_name,'CodeSandbox');assert.ok(!('d1_databases' in c)&&!('r2_buckets' in c));
 assert.equal(sandboxDeploymentConfig('production',{BRAAND_PRODUCTION_CODE_SANDBOX_INTERNET:'true'},'/braand').vars.CODE_SANDBOX_INTERNET,'true');
 assert.throws(()=>sandboxDeploymentConfig('dev',{},'/braand'));assert.throws(()=>sandboxDeploymentConfig('staging',{BRAAND_STAGING_CODE_SANDBOX_INSTANCE:'huge'},'/braand'));
});
