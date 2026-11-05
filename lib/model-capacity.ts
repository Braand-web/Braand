import {z} from 'zod';
import {AppError} from './core.mjs';
const MODEL_TIERS=['light','standard','advanced'] as const;
type ModelTier=typeof MODEL_TIERS[number];

export type CapacityState={tier:ModelTier;changes:number;purpose?:'video_motion'};
const requestSchema=z.object({tier:z.enum(['standard','advanced']),reason:z.enum(['task_complexity','uncertainty','validation_failed','tool_failure','video_motion'])}).strict();
// Cognitive selection belongs to the model. This controller only bounds changes;
// it never examines user text, grants tools, retries a request or changes a budget.
export function requestModelCapacity(current:CapacityState,input:unknown,initialDecision:boolean,evidence:{toolFailure?:boolean;validationFailure?:boolean}={}):CapacityState{
 const request=requestSchema.parse(input),from=MODEL_TIERS.indexOf(current.tier),to=MODEL_TIERS.indexOf(request.tier);
 if(request.reason==='video_motion'&&request.tier!=='advanced')throw new AppError('La production vidéo utilise la capacité avancée.',400,'model_capacity_invalid');
 if(!initialDecision&&['task_complexity','video_motion'].includes(request.reason)||request.reason==='tool_failure'&&!evidence.toolFailure||request.reason==='validation_failed'&&!evidence.validationFailure)throw new AppError('Aucune difficulté observée ne justifie ce changement de capacité.',409,'model_capacity_evidence_required');
 if(current.changes>=2||to<=from||to>from+1&&!(initialDecision&&current.changes===0&&['task_complexity','video_motion'].includes(request.reason)))throw new AppError('Cette capacité ne peut pas être sélectionnée pour cette étape.',409,'model_escalation_limit');
 return {tier:request.tier,changes:current.changes+1,...(request.reason==='video_motion'?{purpose:'video_motion' as const}:current.purpose?{purpose:current.purpose}:{})};
}
export const modelCapacityTool={name:'request_model_capacity',description:'Internal capacity selection. Answer simple requests directly with the fast default. Select standard for substantial writing or ordinary multi-step work, advanced for video editing and motion design production (reason video_motion), or for difficult reasoning, delicate architecture or high-stakes decisions. If uncertain, stay light. Call alone, before writing the answer or doing the complex work; never reveal this internal choice. After work starts, move up only one level for observed uncertainty, validation failure or an actual tool failure. Does not grant permissions, increase budget or retry actions.',input_schema:{type:'object',properties:{tier:{type:'string',enum:['standard','advanced']},reason:{type:'string',enum:['task_complexity','uncertainty','validation_failed','tool_failure','video_motion']}},required:['tier','reason'],additionalProperties:false}};
export const modelCapacityInstruction='Internal capacity policy: start each new user message with the fast default. Stay light for greetings, short questions, simple rewrites and quick lookups. Select standard for a long Word/Excel/PDF document or ebook, a method the user is teaching you, several attached files to read and combine, a full campaign or content plan, or any multi-step task. Select advanced for difficult reasoning, financial or legal stakes, complex code, or when a standard attempt failed a check. Respond immediately to simple questions, extraction, short rewrites and small corrections. For substantive video editing or motion design (storyboards, timelines, animation code, targeted retouches and quality control), prioritize advanced with reason video_motion before production; this preserves the Opus 5.5 preference for the creative work and its creative specialists. Simple explanations about video still use light. For substantial writing or ordinary analysis select standard; for difficult reasoning, delicate code/architecture or high-stakes multi-step decisions select advanced. Use request_model_capacity alone, before user-visible text, only when the gain is clear. This is one decision, not a planning exercise. When in doubt stay light. During work upgrade at most one level after an observed difficulty; do not restart tools or repeat external actions. Keep the same persona, language, instructions, history and permissions. Never announce capacity choices or model/supplier names unless explicitly asked. Each new user message resets to light; do not downgrade repeatedly within a single response.';

// Server-side starting level for each new message. Haiku almost never asks for
// more capacity on its own, so heavy requests start on the standard level from
// structural signals only: attachments added by Braand, message size and the
// work mode. The user's words are never interpreted here.
const ATTACHMENT_PREFIX='Pièce jointe non fiable';
const DOCUMENT_ATTACHMENT_PREFIX='Pièce jointe non fiable (données';
export const LONG_MESSAGE_CHARS=1200;
type Message={role:string;content:unknown};
export function messageSignals(messages:readonly Message[]){
 const last=[...messages].reverse().find(message=>message.role==='user'&&(typeof message.content==='string'||Array.isArray(message.content)&&!message.content.some(block=>block&&typeof block==='object'&&(block as {type?:unknown}).type==='tool_result')));
 const blocks:unknown[]=!last?[]:typeof last.content==='string'?[{type:'text',text:last.content}]:last.content as unknown[];
 let attachments=0,documents=0,textChars=0;
 for(const block of blocks){
  if(!block||typeof block!=='object')continue;
  const {type,text}=block as {type?:unknown;text?:unknown};
  if(type==='image'||type==='document'){attachments++;if(type==='document')documents++;continue;}
  if(type==='text'&&typeof text==='string'){if(text.startsWith(ATTACHMENT_PREFIX)){attachments++;if(text.startsWith(DOCUMENT_ATTACHMENT_PREFIX))documents++;}else textChars+=text.length;}
 }
 return {attachments,documents,textChars};
}
export type InitialCapacity={tier:ModelTier;reason:'structural'|null;signals:ReturnType<typeof messageSignals>};
export function initialCapacity(messages:readonly Message[],options:{approvedMission?:boolean}={}):InitialCapacity{
 const signals=messageSignals(messages);
 const heavy=options.approvedMission||signals.attachments>=2||signals.documents>=1||signals.textChars>LONG_MESSAGE_CHARS;
 return {tier:heavy?'standard':'light',reason:heavy?'structural':null,signals};
}
// After an observed failure (a tool error or a failed check), the next round
// moves up one level, within the same two-change limit as the capacity tool.
export function escalateAfterFailure(current:CapacityState,evidence:{toolFailure?:boolean;validationFailure?:boolean}):{state:CapacityState;reason:'tool_failure'|'validation_failed'}|null{
 const reason=evidence.validationFailure?'validation_failed':evidence.toolFailure?'tool_failure':null;
 const index=MODEL_TIERS.indexOf(current.tier);
 if(!reason||current.changes>=2||index>=MODEL_TIERS.length-1)return null;
 return {state:{...current,tier:MODEL_TIERS[index+1],changes:current.changes+1},reason};
}
