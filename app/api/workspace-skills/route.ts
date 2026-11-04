// Buttons of the « Compétence apprise » card: deactivate, reactivate, share
// with the team, keep personal, or go back to the previous version.
import {privateJSON} from '@/lib/private-json';
import {z} from 'zod';
import {identity,failure,auditLog,authorize} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {restoreSkill,setSkillState} from '@/lib/workspace-skills';

export async function PATCH(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('Origine non autorisée.',403);
 const {tenant,user}=await identity(request);await authorize(tenant,user.userId,'write');
 const p=z.object({id:z.string().min(1).max(160),version:z.number().int().positive(),action:z.enum(['activate','deactivate','share','personal','restore'])}).strict().parse(await privateJSON(request,4096));
 const result=p.action==='restore'?await restoreSkill(tenant,user.userId,{id:p.id,version:p.version}):await setSkillState(tenant,user.userId,{id:p.id,version:p.version,...(p.action==='activate'||p.action==='deactivate'?{active:p.action==='activate'}:{visibility:p.action==='share'?'team':'personal'})});
 await auditLog(tenant,user.userId,'skill.'+p.action,p.id,{version:result.version});
 return Response.json(result);
}catch(error){return failure(error);}}
