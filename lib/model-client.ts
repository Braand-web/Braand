import {AppError,parseSSE} from './core.mjs';
import {modelRecordSchema,type ModelUsage} from './model-protocol';
import type {RoutedModel} from './model-router';

type RecordValue=Record<string,unknown>;
const record=(value:unknown)=>modelRecordSchema.parse(value);
const blocks=(value:unknown):RecordValue[]=>typeof value==='string'?[{type:'text',text:value}]:Array.isArray(value)?value.map(record):[];
function image(source:unknown){const data=record(source);if(data.type==='base64'&&typeof data.media_type==='string'&&/^image\/(png|jpeg|webp|gif)$/.test(data.media_type)&&typeof data.data==='string')return 'data:'+data.media_type+';base64,'+data.data;
 // Remote URLs are intentionally excluded: the provider would fetch a destination
 // outside Braand's private file authorization boundary.
 throw new AppError('Image privée non disponible dans le contexte du modèle.',400,'model_image_invalid');}
function inputContent(content:RecordValue[],role:string):RecordValue[]{return content.flatMap<RecordValue>(block=>{
 if(block.type==='text'&&typeof block.text==='string')return [{type:role==='assistant'?'output_text':'input_text',text:block.text}];
 if(block.type==='image'&&role!=='assistant')return [{type:'input_image',image_url:image(block.source),detail:'auto'}];
 return [];
});}
export function responsesBody(body:RecordValue,model:RoutedModel){
 const input:RecordValue[]=[];
 for(const value of Array.isArray(body.messages)?body.messages:[]){const message=record(value),role=message.role==='assistant'?'assistant':'user',content=blocks(message.content);let pending:RecordValue[]=[];
  const flush=()=>{if(pending.length){input.push({role,content:pending});pending=[];}};
  for(const block of content){
   if(block.type==='provider_state'){flush();if(block.provider==='openai'&&block.model===model.model){const item=record(block.item);if(item.type==='reasoning'&&typeof item.encrypted_content==='string')input.push(item);}continue;}
   if(block.type==='tool_use'){flush();if(typeof block.id!=='string'||typeof block.name!=='string')throw new AppError('Historique d’outil invalide.',409);input.push({type:'function_call',call_id:block.id,name:block.name,arguments:JSON.stringify(block.input??{})});continue;}
   if(block.type==='tool_result'){flush();if(typeof block.tool_use_id!=='string')throw new AppError('Résultat d’outil invalide.',409);const output=typeof block.content==='string'?block.content:inputContent(blocks(block.content),'user');input.push({type:'function_call_output',call_id:block.tool_use_id,output});continue;}
   pending.push(...inputContent([block],role));
  }flush();
 }
 const instructions=blocks(body.system).filter(block=>block.type==='text').map(block=>block.text).join('\n');
 const tools=(Array.isArray(body.tools)?body.tools:[]).map(value=>{const tool=record(value);if(typeof tool.name!=='string'||!tool.input_schema)throw new AppError('Définition d’outil invalide.',500);return {type:'function',name:tool.name,description:tool.description,parameters:tool.input_schema,strict:false};});
 return {model:model.model,instructions,input,tools,max_output_tokens:body.max_tokens,stream:true,store:false,include:['reasoning.encrypted_content'],service_tier:'default'};
}
export function anthropicBody(body:RecordValue,model:RoutedModel):RecordValue{
 const messages=(Array.isArray(body.messages)?body.messages:[]).map(value=>{const message=record(value);return {...message,content:blocks(message.content).filter(block=>block.type!=='provider_state')};});
 return {...body,messages,model:model.model,stream:true,...(model.provider==='openrouter'?{provider:{require_parameters:true,allow_fallbacks:true}}:{})};
}
export function routedRequest(model:RoutedModel,body:RecordValue,signal:AbortSignal){return {url:model.url,init:{method:'POST',headers:model.headers,body:JSON.stringify(model.provider==='openai'?responsesBody(body,model):anthropicBody(body,model)),signal} satisfies RequestInit};}

export function responsesUsage(value:unknown):ModelUsage{
 const usage=record(value),details=usage.input_tokens_details===undefined?{}:record(usage.input_tokens_details),input=usage.input_tokens,output=usage.output_tokens,cached=details.cached_tokens??0,written=details.cache_write_tokens??0;
 if(![input,output,cached,written].every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0)||Number(cached)+Number(written)>Number(input))throw new AppError('Consommation OpenAI incomplète.',409,'usage_unknown');
 // output_tokens already includes reasoning tokens; adding them would double bill.
 return {input_tokens:Number(input)-Number(cached)-Number(written),output_tokens:output,cache_read_input_tokens:cached,cache_creation_input_tokens:written,provider_usage:usage};
}
const chunk=(event:RecordValue)=>({event:String(event.type),data:event});
// Adapt only protocol; no tool is ever executed here. Existing server authorization
// still mediates every tool_use emitted to the orchestrator.
export async function* normalizedResponses(stream:ReadableStream<Uint8Array>,model:RoutedModel){
 let nextIndex=0,hasTools=false;const text=new Map<string,number>(),tools=new Map<string,number>();
 const startText=(key:string)=>{const index=nextIndex++;text.set(key,index);return index;};
 for await(const part of parseSSE(stream)){
  const event=record(part.data),type=event.type;
  if(type==='response.created')yield chunk({type:'message_start',message:{id:record(event.response).id,model:model.model,role:'assistant',content:[],usage:{input_tokens:0,output_tokens:0}}});
  else if(type==='response.output_item.added'){
   const item=record(event.item);if(item.type==='function_call'){if(typeof item.call_id!=='string'||typeof item.name!=='string')throw new AppError('Appel d’outil fournisseur invalide.',502);const index=nextIndex++;tools.set(String(event.output_index),index);hasTools=true;yield chunk({type:'content_block_start',index,content_block:{type:'tool_use',id:item.call_id,name:item.name,input:{}}});}
  }else if(type==='response.content_part.added'){
   const content=record(event.part);if(content.type==='output_text'||content.type==='refusal'){const key=String(event.output_index)+':'+String(event.content_index),index=startText(key);yield chunk({type:'content_block_start',index,content_block:{type:'text',text:''}});}
  }else if(type==='response.output_text.delta'||type==='response.refusal.delta'){
   const key=String(event.output_index)+':'+String(event.content_index);let index=text.get(key);if(index===undefined){index=startText(key);yield chunk({type:'content_block_start',index,content_block:{type:'text',text:''}});}if(typeof event.delta!=='string')throw new AppError('Flux fournisseur invalide.',502);yield chunk({type:'content_block_delta',index,delta:{type:'text_delta',text:event.delta}});
  }else if(type==='response.content_part.done'){
   const key=String(event.output_index)+':'+String(event.content_index),index=text.get(key);if(index!==undefined){yield chunk({type:'content_block_stop',index});text.delete(key);}
  }else if(type==='response.function_call_arguments.delta'){
   const index=tools.get(String(event.output_index));if(index===undefined||typeof event.delta!=='string')throw new AppError('Arguments d’outil fournisseur invalides.',502);yield chunk({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:event.delta}});
  }else if(type==='response.output_item.done'){
   const item=record(event.item);if(item.type==='function_call'){const index=tools.get(String(event.output_index));if(index===undefined)throw new AppError('Appel d’outil sans début.',502);yield chunk({type:'content_block_stop',index});tools.delete(String(event.output_index));}
   else if(item.type==='reasoning'&&typeof item.encrypted_content==='string'){const index=nextIndex++;yield chunk({type:'content_block_start',index,content_block:{type:'provider_state',provider:'openai',model:model.model,item}});yield chunk({type:'content_block_stop',index});}
  }else if(type==='response.completed'){
   const response=record(event.response);if(response.model!==model.model||response.status!=='completed'||text.size||tools.size||response.service_tier&&response.service_tier!=='default')throw new AppError('Résultat ou tarif fournisseur non confirmé.',409,'usage_unknown');
   const usage=responsesUsage(response.usage),raw=record(response.usage);if(Number(raw.input_tokens)>model.maxInputTokens)throw new AppError('Le contexte dépasse le tarif autorisé.',409,'usage_unknown');
   yield chunk({type:'message_delta',delta:{stop_reason:hasTools?'tool_use':'end_turn'},usage});yield chunk({type:'message_stop'});return;
  }else if(type==='error'||type==='response.failed'||type==='response.incomplete'){
   // Provider diagnostics may echo the request; expose only a stable safe error.
   yield chunk({type:'error',error:{type:'provider_interrupted',message:'La réponse du fournisseur est interrompue.'}});return;
  }
 }
 // No message_stop: metering must retain an unresolved reservation, never retry.
}
