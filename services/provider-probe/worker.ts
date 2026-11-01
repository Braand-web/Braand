import {createBrowserbaseDriver} from '../../lib/browserbase';
const fixture='<!doctype html><html><head><title>Braand provider fixture</title></head><body><h1>Browser fixture</h1><form><label>Nom fictif<input name="demo"></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password"></label><button type="button" onclick="document.getElementById(\'state\').textContent=\'Clicked successfully\'">Vérifier</button></form><p id="state">Ready</p></body></html>';
const providerProbe={async fetch(request:Request,env:Cloudflare.Env){
 const url=new URL(request.url);if(url.pathname==='/fixture')return new Response(fixture,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
 const token=(env as Cloudflare.Env&{PROBE_TOKEN?:string}).PROBE_TOKEN;
 if(request.method!=='POST'||url.pathname!=='/run'||!token||request.headers.get('authorization')!=='Bearer '+token)return new Response(null,{status:403});
 const driver=createBrowserbaseDriver(env);let id:string|undefined;const checks:string[]=[];
 try{
  id=(await driver.open({allowedDomains:[url.hostname],timeoutSeconds:60})).sessionId;checks.push('Bounded remote browser created');
  let observation=(await driver.command(id,{kind:'navigate',url:url.origin+'/fixture'})).observation;
  if(observation.title!=='Braand provider fixture')throw Error('navigation');checks.push('Real page observed');
  const button=observation.elements.find(x=>x.name==='Vérifier');if(!button)throw Error('button');
  observation=(await driver.command(id,{kind:'click',targetRef:button.ref,observationId:observation.id})).observation;
  if(!observation.text.includes('Clicked successfully'))throw Error('click');checks.push('Real click verified by page state');
  if(!driver.live)throw Error('live');
  let count=0;let ready!:()=>void;const frame=new Promise<void>(resolve=>ready=resolve);
  const stream=await driver.live(id,value=>{if(value.image.length>100&&value.width>0){count++;ready();}});
  try{await Promise.race([frame,new Promise((_,reject)=>setTimeout(()=>reject(Error('screencast timeout')),8000))]);}finally{await stream.close();}
  if(!count)throw Error('screencast');checks.push('Actual CDP screencast frame received');
  if(!driver.loginTarget||!driver.fillLogin)throw Error('login target');
  const target=await driver.loginTarget(id,'password');await driver.fillLogin(id,target,{username:'fixture@example.com',password:'fixture-only-never-real'});checks.push('Exact-origin credential fill without submission');
  const masked=await driver.capture(id);if(masked.length<100)throw Error('capture');checks.push('Masked agent screenshot returned');
  await driver.close(id);let receipt=await driver.receipt(id);
  for(let attempt=0;attempt<4&&receipt.status!=='complete';attempt++){await new Promise(resolve=>setTimeout(resolve,500));receipt=await driver.receipt(id);}
  if(receipt.status!=='complete')throw Error('provider receipt');checks.push('Actual provider termination and timestamp receipt');
  return Response.json({ok:true,checks,milliseconds:receipt.milliseconds,paidModelCalls:0,recordings:false});
 }catch(error){const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^browser_[a-z_]+$/.test(error.code)?error.code:'provider_probe_failed';return Response.json({ok:false,checks,code},{status:502});}
 finally{if(id)await driver.close(id).catch(()=>{});}
}};

export default providerProbe;
