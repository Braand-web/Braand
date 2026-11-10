// Bounded, read-only inspection before an explicitly requested account cleanup.
// Never print account identifiers, addresses, credentials, or conversation data.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('Cloudflare credentials missing');
const api=async(path,body)=>{
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok||!result.success)throw Error(`Cloudflare request failed (${response.status}): ${JSON.stringify(result.errors)}`);return result.result;
};
const settings=await api('/workers/scripts/aira-production/settings');
const database=settings.bindings.find(binding=>binding.name==='DB'&&binding.type==='d1')?.id;
if(!database)throw Error('Production DB binding not found');
const query=async(sql,params=[])=>{const results=await api(`/d1/database/${database}/query`,{sql,params});if(results.some(result=>!result.success))throw Error('D1 query failed');return results[0].results;};
const hash=value=>createHash('sha256').update(value).digest('hex');
const keep=JSON.parse(process.env.ACCOUNT_KEEP_EMAILS||'[]').map(value=>String(value).trim().toLowerCase());
if(keep.length!==3||new Set(keep).size!==3||keep.some(email=>!/^[-\w.+]+@[-\w.]+\.[a-z]{2,}$/.test(email)))throw Error('Exactly three distinct retained addresses required');
const users=await query('SELECT id,email,created_at FROM auth_users ORDER BY id');
const retained=keep.map(email=>users.find(user=>user.email.toLowerCase()===email));
if(retained.some(user=>!user))throw Error('A retained account is missing; no mutation permitted');
const removed=users.filter(user=>!keep.includes(user.email.toLowerCase()));
const sqlTables=await query("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%' ORDER BY name");
const platformOwnerSource=readFileSync(new URL('../lib/platform-owners.ts',import.meta.url),'utf8');
const admins=new Set([...(platformOwnerSource.match(/PLATFORM_OWNER_IDS=\[([^\]]*)\]/)?.[1].matchAll(/'([^']+)'/g)||[])].map(match=>match[1]));
for(const binding of settings.bindings)if(['OPS_ADMIN_IDS','BILLING_ADMIN_IDS'].includes(binding.name)&&binding.type==='plain_text')for(const id of binding.text.split(','))if(id.trim())admins.add(id.trim());
const organizations=await query('SELECT id,owner_id FROM organizations');
const orgsToRemove=organizations.filter(org=>removed.some(user=>user.id===org.owner_id));
const workspaces=await query('SELECT id,organization_id FROM workspaces');
const orphanOwners=organizations.filter(org=>!users.some(user=>user.id===org.owner_id)).length;
const shared=await query('SELECT organization_id,user_id,role,active FROM organization_members');
const conflicts=shared.filter(member=>retained.some(user=>user.id===member.user_id)&&orgsToRemove.some(org=>org.id===member.organization_id));
const plan={database,keep:retained.map(user=>user.id).sort(),remove:removed.map(user=>user.id).sort(),organizations:orgsToRemove.map(org=>org.id).sort(),workspaces:workspaces.filter(w=>orgsToRemove.some(org=>org.id===w.organization_id)).map(w=>w.id).sort()};
console.log(JSON.stringify({observedAt:new Date().toISOString(),mode:'audit',accounts:users.length,retained:retained.map((user,index)=>({slot:index+1,admin:admins.has(user.id),createdAt:new Date(user.created_at).toISOString()})),remove:removed.length,organizations:organizations.length,organizationsToRemove:orgsToRemove.length,workspacesToRemove:plan.workspaces.length,orphanOwners,retainedMembershipConflicts:conflicts.length,planDigest:hash(JSON.stringify(plan))}));
console.log('SCHEMA '+JSON.stringify(sqlTables));
console.log('TRAFFIC '+JSON.stringify(await query("SELECT day,scope,dim,value,sum(n) n FROM traffic_daily WHERE day>='2026-11-01' AND (scope='app' OR (scope='api' AND dim='status')) GROUP BY day,scope,dim,value ORDER BY day,scope,dim,value")));
console.log('SIGNUPS '+JSON.stringify(await query("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) n FROM auth_users GROUP BY day ORDER BY day")));
