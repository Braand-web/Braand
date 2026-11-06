// After the sandbox Worker is deployed: bind it to the production Worker and
// turn on GitHub projects with live previews. Shares two fresh random secrets
// (call token, preview signing key) between both Workers, records the preview
// address, keeps every other binding and never prints a secret.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,main='aira-production',sandbox='braand-code-sandbox-production';
const callToken=process.env.CODE_SANDBOX_CALL_TOKEN,previewSecret=process.env.CODE_PREVIEW_SECRET;
if(!account||!token)throw Error('Cloudflare credentials missing');
if(!/^[a-f0-9]{64}$/.test(callToken||'')||!/^[a-f0-9]{64}$/.test(previewSecret||''))throw Error('Generated secrets missing; nothing changed');
const api=async(path,method='GET',body)=>{const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData||body===undefined?{}:{'content-type':'application/json'})},body:body instanceof FormData||body===undefined?body:JSON.stringify(body)});const data=await response.json();if(!response.ok||!data.success)throw Error('Cloudflare refused '+method+' '+path+': '+JSON.stringify((data.errors||[]).map(e=>e.code)));return data.result;};
const patch=async(script,update)=>{
 const settings=await api('/workers/scripts/'+script+'/settings'),names=settings.bindings.map(b=>b.name),managed=update.map(b=>b.name);
 const bindings=[...settings.bindings.filter(b=>!managed.includes(b.name)),...update];
 const textCount=bindings.filter(b=>['plain_text','secret_text'].includes(b.type)).length;
 if(textCount>64)throw Error(script+': variable limit reached ('+textCount+'); nothing changed');
 const form=new FormData();form.set('settings',JSON.stringify({bindings}));
 await api('/workers/scripts/'+script+'/settings','PATCH',form);
 const after=(await api('/workers/scripts/'+script+'/settings')).bindings.map(b=>b.name);
 const lost=names.filter(n=>!after.includes(n));if(lost.length)throw Error(script+': bindings lost: '+lost.join(', '));
 return textCount;
};
const subdomain=(await api('/workers/subdomain')).subdomain;
if(!/^[a-z0-9-]+$/.test(subdomain||''))throw Error('No workers.dev subdomain on this account; enable it in Workers & Pages first');
const origin='https://'+sandbox+'.'+subdomain+'.workers.dev';
await patch(sandbox,[{type:'plain_text',name:'CODE_SANDBOX_ENABLED',text:'true'},{type:'plain_text',name:'CODE_SANDBOX_INTERNET',text:'true'},{type:'secret_text',name:'CODE_SANDBOX_CALL_TOKEN',text:callToken},{type:'secret_text',name:'CODE_PREVIEW_SECRET',text:previewSecret}]);
const count=await patch(main,[{type:'service',name:'CODE_SANDBOX',service:sandbox},{type:'plain_text',name:'CODE_SANDBOX_ENABLED',text:'true'},{type:'secret_text',name:'CODE_SANDBOX_CALL_TOKEN',text:callToken},{type:'secret_text',name:'CODE_PREVIEW_SECRET',text:previewSecret},{type:'plain_text',name:'CODE_PREVIEW_ORIGIN',text:origin}]);
console.log('Code sandbox bound and enabled; previews on '+origin+' ('+count+'/64 variables on the main Worker). All other bindings preserved.');
