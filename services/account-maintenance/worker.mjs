// No generic SQL endpoint. Expiring, single-purpose inspection, authenticated by
// an ephemeral secret; deployed and removed within the same maintenance job.
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
export default {async fetch(request,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/inspect'||Date.now()>Number(env.EXPIRES_AT)||request.headers.get('authorization')!=='Bearer '+env.ACCESS)return new Response(null,{status:404});
 try{return Response.json(await inspect(env),{headers:{'cache-control':'no-store'}});}catch(error){return Response.json({error:String(error.message).slice(0,300)},{status:500});}
}};
async function inspect(env){
 const query=async(sql,params=[])=>{const result=await env.DB.prepare(sql).bind(...params).all();return result.results;};
 const keep=JSON.parse(env.KEEP),admins=new Set(JSON.parse(env.ADMINS));
 const users=await query('SELECT id,email,created_at FROM auth_users ORDER BY id'),retained=keep.map(email=>users.find(user=>user.email.toLowerCase()===email));
 if(retained.some(user=>!user))throw Error('Retained account missing');
 const removed=users.filter(user=>!keep.includes(user.email.toLowerCase()));
 const schema=await query("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%' ORDER BY name");
 const organizations=await query('SELECT id,owner_id FROM organizations'),orgsToRemove=organizations.filter(org=>removed.some(user=>user.id===org.owner_id)),workspaces=await query('SELECT id,organization_id FROM workspaces'),members=await query('SELECT organization_id,user_id,role,active FROM organization_members');
 const conflicts=members.filter(member=>retained.some(user=>user.id===member.user_id)&&orgsToRemove.some(org=>org.id===member.organization_id));
 const plan={keep:retained.map(user=>user.id).sort(),remove:removed.map(user=>user.id).sort(),organizations:orgsToRemove.map(org=>org.id).sort(),workspaces:workspaces.filter(w=>orgsToRemove.some(org=>org.id===w.organization_id)).map(w=>w.id).sort()};
 return {summary:{observedAt:new Date().toISOString(),mode:'audit',accounts:users.length,retained:retained.map((user,index)=>({slot:index+1,admin:admins.has(user.id),createdAt:new Date(user.created_at).toISOString()})),remove:removed.length,organizations:organizations.length,organizationsToRemove:orgsToRemove.length,workspacesToRemove:plan.workspaces.length,orphanOwners:organizations.filter(org=>!users.some(user=>user.id===org.owner_id)).length,retainedMembershipConflicts:conflicts.length,planDigest:await digest(plan)},schema,traffic:await query("SELECT day,scope,dim,value,sum(n) n FROM traffic_daily WHERE day>='2026-11-01' AND (scope='app' OR (scope='api' AND dim='status')) GROUP BY day,scope,dim,value ORDER BY day,scope,dim,value"),signups:await query("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) n FROM auth_users GROUP BY day ORDER BY day")};
}
