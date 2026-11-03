// Rebuild a bounded Braand input schema from a fal.ai OpenAPI document.
// Shared by the release workflow and by agents enabling a model at runtime.
const TEXT={prompt:4000,negative_prompt:1000,text:2000};
const URLS=['image_url','audio_url','video_url','end_image_url','mask_url'];
const ENUMS=['aspect_ratio','resolution','image_size','duration','output_format','style','safety_tolerance','acceleration','rendering_speed','quality','background','size'];
const BOOLEANS=['camera_fixed','generate_audio','enhance_prompt','expand_prompt','raw','sync_mode'];
const NUMBERS={seed:{type:'integer',minimum:0,maximum:2147483647},guidance_scale:{type:'number',minimum:0,maximum:20},cfg_scale:{type:'number',minimum:0,maximum:1},upscale_factor:{type:'number',minimum:1,maximum:2},creativity:{type:'number',minimum:0,maximum:1},resemblance:{type:'number',minimum:0,maximum:1},num_inference_steps:{type:'integer',minimum:1,maximum:30}};

function resolve(spec,schema,depth=0){
 if(!schema||depth>6)return schema;
 if(schema.$ref){const name=schema.$ref.split('/').pop();return resolve(spec,spec.components?.schemas?.[name],depth+1);}
 if(schema.allOf?.length===1)return resolve(spec,schema.allOf[0],depth+1);
 return schema;
}
function enumOf(spec,raw){
 const prop=resolve(spec,raw);if(!prop)return null;
 if(Array.isArray(prop.enum))return prop.enum.filter(v=>typeof v==='string'||typeof v==='number');
 for(const key of ['anyOf','oneOf']){if(Array.isArray(prop[key])){const values=prop[key].flatMap(option=>{const o=resolve(spec,option);return Array.isArray(o?.enum)?o.enum:o?.const!==undefined?[o.const]:[];}).filter(v=>typeof v==='string'||typeof v==='number');if(values.length)return values;}}
 return null;
}

/** Build a bounded catalog entry from fal's OpenAPI document, or explain why not. */
export function boundedModel(candidate,spec){
 const path=Object.values(spec.paths||{}).find(p=>p.post?.requestBody);
 const input=resolve(spec,path?.post?.requestBody?.content?.['application/json']?.schema);
 if(!input?.properties)return {skip:'schéma introuvable'};
 const properties={},required=[];
 for(const [name,raw] of Object.entries(input.properties)){
  const prop=resolve(spec,raw)||{};
  if(TEXT[name]&&(prop.type==='string'||!prop.type))properties[name]={type:'string',maxLength:TEXT[name]};
  else if(URLS.includes(name))properties[name]={type:'string',format:'uri',maxLength:2048};
  else if(name==='image_urls')properties[name]={type:'array',minItems:1,maxItems:4,items:{type:'string',maxLength:2048}};
  else if(ENUMS.includes(name)){const values=enumOf(spec,raw);if(values?.length)properties[name]={type:typeof values[0]==='number'?'number':'string',enum:values,...(typeof values[0]==='number'?{minimum:Math.min(...values),maximum:Math.max(...values)}:{})};}
  else if(BOOLEANS.includes(name)&&prop.type==='boolean')properties[name]=name==='sync_mode'?{type:'boolean',enum:[false]}:{type:'boolean'};
  else if(name==='enable_safety_checker')properties[name]={type:'boolean',enum:[true]};
  else if(['num_images','num_outputs'].includes(name))properties[name]={type:'integer',minimum:1,maximum:1};
  else if(NUMBERS[name])properties[name]=NUMBERS[name];
 }
 for(const name of input.required||[]){if(!properties[name])return {skip:'paramètre obligatoire non borné : '+name};required.push(name);}
 if(!required.length&&!properties.prompt&&!properties.image_url)return {skip:'aucune entrée exploitable'};
 // Quantity limits per possible billing unit.
 const durations=(properties.duration?.enum||[]).map(value=>parseFloat(String(value))).filter(Number.isFinite);
 const seconds=durations.length?Math.max(...durations)+1:candidate.kind==='video'?(candidate.tasks.includes('video_ugc')?30:10):undefined;
 if(candidate.kind==='video'&&!durations.length&&!candidate.tasks.includes('video_ugc')&&properties.duration)return {skip:'durée non bornée'};
 // Ambiguous units ("units", "requests") are left out on purpose: such a model stays closed.
 const limits=candidate.kind==='video'?{seconds,videos:1}:{images:1,megapixels:candidate.tasks.includes('image_upscale')?16:6};
 const unit=candidate.kind==='video'?'seconds':'images',maxUnits=candidate.kind==='video'?seconds:1;
 return {model:{id:candidate.id,name:candidate.name,kind:candidate.kind,tasks:candidate.tasks,description:candidate.name,unit,maxUnits,limits,inputSchema:{type:'object',additionalProperties:false,required,properties},approvedAt:new Date().toISOString(),approvedBy:'release-workflow'}};
}
