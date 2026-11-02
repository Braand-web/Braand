import {privateJSON} from '@/lib/private-json';
import {identity,failure} from '@/lib/server';
import {AppError} from '@/lib/core.mjs';
import {missionState,activateMission,controlMission,reviewMissionStep,durableReadiness} from '@/lib/durable-missions';
import {z} from 'zod';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{return Response.json({mission:await missionState(await identity(request),(await context.params).id),readiness:durableReadiness()});}catch(error){return failure(error);}}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const who=await identity(request,'read'),{id}=await context.params,body=z.object({action:z.enum(['activate','suspend','cancel','resume','confirm-step','reconcile-step'])}).passthrough().parse(await privateJSON(request,1048576));if(body.action==='activate')return Response.json(await activateMission(who,id,body));if(body.action==='confirm-step'||body.action==='reconcile-step'){const {action,...decision}=body;return Response.json(await reviewMissionStep(who,id,action,decision));}if(body.action==='suspend'||body.action==='cancel'||body.action==='resume')return Response.json(await controlMission(who,id,body.action));throw new AppError('Action inconnue.');}catch(error){return failure(error);}}
