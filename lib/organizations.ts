import {db,uid,auditLog} from './server';
import {AppError} from './core.mjs';
import {activeRights,type BillingIdentity} from './billing';
import {roleAllows,teamPlan} from './billing-core.mjs';
const q=(sql:string,...args:unknown[])=>db().prepare(sql).bind(...args);
type OrganizationChange={action:'space';name:string}|{action:'invite';email:string;role:string;spaces:string[]}|{action:'revoke';userId:string}|{action:'limit';scope:'organization'|'workspace'|'member';scopeId:string;credits:number};
export async function organizationSummary(who:BillingIdentity){
 const spaces=await q("SELECT w.id,w.name,w.organization_id,o.name organization_name,om.role FROM workspaces w JOIN organizations o ON o.id=w.organization_id JOIN organization_members om ON om.organization_id=o.id AND om.user_id=? AND om.active=1 WHERE om.role='owner' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=?) ORDER BY o.created_at,w.created_at",who.user.userId,who.user.userId).all();
 const members=roleAllows(who.role,'manage')?await q('SELECT user_id,role,active FROM organization_members WHERE organization_id=?',who.organization).all():{results:[]};
 const memberCount=await q('SELECT COUNT(*) count FROM organization_members WHERE organization_id=? AND active=1',who.organization).first<{count:number}>();
 const limits=await q('SELECT scope,scope_id,units FROM billing_limits WHERE organization_id=?',who.organization).all();
 const pendingInvites=roleAllows(who.role,'manage')?await q("SELECT COUNT(*) count FROM billing_invites WHERE organization_id=? AND status='pending' AND expires_at>?",who.organization,Date.now()).first<{count:number}>():{count:0};
 return {spaces:spaces.results,members:members.results,activeMemberCount:memberCount?.count||0,limits:limits.results,pendingInvites:pendingInvites?.count||0,viewer:{userId:who.user.userId,email:who.user.email,displayName:who.user.displayName},rights:await activeRights(who.organization),current:who.tenant,organization:who.organization,role:who.role};
}
export async function changeOrganization(who:BillingIdentity,input:OrganizationChange){
 if(!roleAllows(who.role,'manage'))throw new AppError('Gestion réservée au propriétaire ou à un administrateur.',403);
 const {plan,limits}=await activeRights(who.organization);
 if(!teamPlan(plan))throw new AppError('Un abonnement Business ou Entreprise actif est nécessaire.',403);
 if(input.action==='space'){
  const id=uid();const result=await q("INSERT INTO workspaces(id,name,created_at,organization_id) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM workspaces WHERE organization_id=?)<?",id,input.name,Date.now(),who.organization,who.organization,limits.spaces).run();
  if(!result.meta.changes)throw new AppError('Le nombre maximal d’espaces est atteint.',409);
  if(who.role!=='owner')await q('INSERT INTO members(id,workspace_id,user_id,role) VALUES (?,?,?,?)',uid(),id,who.user.userId,who.role).run();
  await auditLog(who.tenant,who.user.userId,'space.created',id,{organization:who.organization});return {id};
 }
 if(input.action==='invite'){
  const spaces=await q('SELECT id FROM workspaces WHERE organization_id=?',who.organization).all<{id:string}>();
  if(!input.spaces.length||input.spaces.some((id:string)=>!spaces.results.some(r=>r.id===id)))throw new AppError('Espaces invalides.');
  const token=uid()+uid(),hash=await digest(token),id=uid(),now=Date.now();
  const result=await q("INSERT INTO billing_invites(id,organization_id,email,role,spaces,token_hash,expires_at,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM organization_members WHERE organization_id=? AND active=1)+(SELECT COUNT(*) FROM billing_invites WHERE organization_id=? AND status='pending' AND expires_at>?)<?",id,who.organization,input.email.toLowerCase(),input.role,JSON.stringify(input.spaces),hash,now+7*86400000,now,who.organization,who.organization,now,limits.members).run();
  if(!result.meta.changes)throw new AppError('Le nombre maximal de membres et invitations est atteint.',409);
  return {id,token}; // Shown once to the inviter; email delivery is deliberately not fabricated.
 }
 if(input.action==='revoke'){
  const target=await q('SELECT role FROM organization_members WHERE organization_id=? AND user_id=?',who.organization,input.userId).first<{role:string}>();
  if(!target||target.role==='owner'||(who.role==='admin'&&target.role==='admin'))throw new AppError('Ce membre ne peut pas être révoqué par votre rôle.',403);
  await q('UPDATE organization_members SET active=0 WHERE organization_id=? AND user_id=?',who.organization,input.userId).run();await auditLog(who.tenant,who.user.userId,'member.revoked',input.userId,{organization:who.organization});return {revoked:true};
 }
 if(input.action==='limit'){
  if(who.role!=='owner')throw new AppError('Seul le propriétaire définit les budgets.',403);
  if(input.scope==='member'&&!await q('SELECT user_id FROM organization_members WHERE organization_id=? AND user_id=?',who.organization,input.scopeId).first())throw new AppError('Membre inconnu.');
  if(input.scope==='workspace'&&!await q('SELECT id FROM workspaces WHERE organization_id=? AND id=?',who.organization,input.scopeId).first())throw new AppError('Espace inconnu.');
  await q('INSERT INTO billing_limits VALUES (?,?,?,?) ON CONFLICT(organization_id,scope,scope_id) DO UPDATE SET units=excluded.units',who.organization,input.scope,input.scope==='organization'?who.organization:input.scopeId,Math.round(input.credits*100)).run();return {saved:true};
 }
 throw new AppError('Action inconnue.');
}
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function acceptInvite(who:BillingIdentity,token:string){
 const invite=await q("SELECT * FROM billing_invites WHERE token_hash=? AND status='pending' AND expires_at>?",await digest(token),Date.now()).first<{id:string;organization_id:string;email:string;role:string;spaces:string}>();
 if(!invite||invite.email!==who.user.email.toLowerCase())throw new AppError('Invitation invalide ou destinée à un autre compte.',403);
 if(!teamPlan((await activeRights(invite.organization_id)).plan))throw new AppError('L’organisation n’a pas de forfait Business ou Entreprise actif.',409);
 const existing=await q('SELECT role FROM organization_members WHERE organization_id=? AND user_id=?',invite.organization_id,who.user.userId).first<{role:string}>();
 if(existing?.role==='owner')throw new AppError('Le propriétaire possède déjà cet espace.',409);
 await db().batch([
 q("UPDATE billing_invites SET status='accepted' WHERE id=? AND status='pending'",invite.id),
 q('INSERT INTO organization_members(organization_id,user_id,role) VALUES (?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,active=1',invite.organization_id,who.user.userId,invite.role),
 q('DELETE FROM members WHERE user_id=? AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id=?)',who.user.userId,invite.organization_id),
 ...JSON.parse(invite.spaces).map((space:string)=>q('INSERT INTO members(id,workspace_id,user_id,role) VALUES (?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role',uid(),space,who.user.userId,invite.role))
 ]);return {accepted:true};
}
