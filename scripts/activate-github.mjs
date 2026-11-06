// Turn on the GitHub connection for Braand's users: copies the GitHub OAuth App
// credentials (and an optional read-only token for public repositories) from
// the repository secrets to the production Worker. Every other binding is kept;
// the values are never printed.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,script='aira-production';
const clientId=process.env.GITHUB_CLIENT_ID,clientSecret=process.env.GITHUB_CLIENT_SECRET,readToken=process.env.GITHUB_READ_TOKEN;
if(!account||!token)throw Error('Cloudflare credentials missing');
if(!clientId||!clientSecret)throw Error('Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to the repository secrets first; nothing changed');
const api=async(path,method='GET',body)=>{const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData?{}:{'content-type':'application/json'})},body});const data=await response.json();if(!response.ok||!data.success)throw Error('Cloudflare refused '+method+' '+path+': '+JSON.stringify(data.errors||[]));return data.result;};
const settings=await api('/workers/scripts/'+script+'/settings'),names=settings.bindings.map(b=>b.name);
const managed=['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','GITHUB_READ_TOKEN'];
const bindings=settings.bindings.filter(b=>!managed.includes(b.name));
bindings.push({type:'plain_text',name:'GITHUB_CLIENT_ID',text:clientId},{type:'secret_text',name:'GITHUB_CLIENT_SECRET',text:clientSecret});
if(readToken)bindings.push({type:'secret_text',name:'GITHUB_READ_TOKEN',text:readToken});
const textCount=bindings.filter(b=>['plain_text','secret_text'].includes(b.type)).length;
if(textCount>64)throw Error('Cloudflare variable limit reached ('+textCount+'); nothing changed');
const form=new FormData();form.set('settings',JSON.stringify({bindings}));
await api('/workers/scripts/'+script+'/settings','PATCH',form);
const after=(await api('/workers/scripts/'+script+'/settings')).bindings.map(b=>b.name);
const lost=names.filter(n=>!managed.includes(n)&&!after.includes(n));
if(lost.length)throw Error('Bindings lost: '+lost.join(', '));
console.log('GitHub connection enabled'+(readToken?' with a read token for public repositories':'')+' ('+textCount+'/64 variables). All other bindings preserved.');
