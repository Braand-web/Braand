import {operationSnapshot} from './agent-operation-visibility';
import {z} from 'zod';
import {AppError} from './core.mjs';
import {getResource,updateResource} from './server';
import {saveAgentProfile,operationResource,proposeWorkflow,testWorkflow,executeWorkflow,actionInbox,listAgentOperations} from './agent-operations';
import {agentPlaybook} from './agent-playbooks';
import type {AgentScope} from './agent-state';
import type {RunBudget} from './metering';
export async function executeAgentOperation(name:string,input:unknown,scope:AgentScope,budget:RunBudget):Promise<unknown>{
 switch(name){
  case 'save_agent_profile':return saveAgentProfile(scope,input);
  case 'list_agent_operations':z.object({}).strict().parse(input);return listAgentOperations(scope);
  case 'get_action_inbox':return actionInbox(scope,input);
  case 'propose_workflow':return operationSnapshot(await proposeWorkflow(scope,input));
  case 'test_workflow':{const result=await testWorkflow(scope,input);return {...operationSnapshot(result),testOutput:result.testOutput.slice(0,5)};}
  case 'execute_workflow':return operationSnapshot(await executeWorkflow(scope,input));
  case 'subscribe_event':return (await import('./agent-events-webhook')).subscribeEvent(scope,input);
  case 'get_agent_playbook':return agentPlaybook(input);
  case 'handoff_task':{
   const p=z.object({profileId:z.string().min(1).max(160),profileVersion:z.number().int().positive(),task:z.string().min(4).max(2000),context:z.string().max(6000),maxCredits:z.number().int().min(1).max(1000),timezone:z.string().max(80)}).strict().parse(input),profile=await operationResource(scope,p.profileId,'agent_profile');
   if(profile.status!=='ready'||profile.version!==p.profileVersion)throw new AppError('Ce profil a changé ou est inactif.',409,'stale_version');
   try{new Intl.DateTimeFormat('fr',{timeZone:p.timezone}).format();}catch{throw new AppError('Fuseau horaire invalide.');}
   const work=await (await import('./work')).prepareWork(budget.who,scope.conversationId,{objective:p.task,constraints:['Profil '+profile.id+' version '+profile.version,'Aucun envoi, achat ou publication sans autorisation serveur exacte.'],language:'fr',timezone:p.timezone,maxCredits:p.maxCredits,expiresAt:Date.now()+86400000,researchDepth:'standard',steps:[{id:'specialist',title:profile.title,instruction:'Utilise delegate_specialist avec '+JSON.stringify({profileId:profile.id,profileVersion:profile.version,role:profile.data.role,task:p.task,context:p.context})+'. Vérifie et livre le résultat du spécialiste. Si le profil a changé, arrête et demande la version actuelle.',criteria:['Le résultat demandé est enregistré et ses vérifications sont explicites.'],dependsOn:[],maxCredits:p.maxCredits}]});
   const current=await getResource(scope.tenant,work.id),result=await updateResource(scope.tenant,current.id,current.version,{data:{...current.data,projectId:scope.projectId??null,ownerId:scope.userId,profileId:profile.id,profileVersion:profile.version}});
   return {...result,work:work.work,autoLaunched:false,notice:'Mandat préparé. Lancez-le depuis la carte de travail.'};
  }
  default:throw new AppError('Outil opérationnel inconnu.',404);
 }
}
