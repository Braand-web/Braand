// Read-only production configuration report: binding names and types, and the
// values of on/off switches only. Secrets and JSON contents are never printed.
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Cloudflare credentials missing');
const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/aira-production/settings',{headers:{authorization:'Bearer '+token}});
const data=await response.json();if(!response.ok||!data.success)throw Error('Cloudflare API failed: '+JSON.stringify(data.errors||[]));
const switchName=/(_ENABLED|_VERIFIED|_VALIDATED|_PASSED|_READY|_APPROVED|_TESTED|_MODE|_ENV|_STATUS|_POLICY|_MAX_[A-Z_]+|_SECONDS|_ACTIONS)$/;
for(const binding of data.result.bindings.sort((a,b)=>a.name.localeCompare(b.name))){
 const shown=binding.type==='plain_text'&&switchName.test(binding.name)&&String(binding.text).length<=40?' = '+binding.text:binding.type==='plain_text'&&/_JSON$/.test(binding.name)?' (json, '+String(binding.text).length+' chars)':'';
 console.log(binding.type.padEnd(14),binding.name+shown);
}
