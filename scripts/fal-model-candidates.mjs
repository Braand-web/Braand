// Premium fal.ai models Braand activates, each limited to reviewed fields.
// Inputs are rebuilt from fal's own OpenAPI schema on the release runner; a
// model whose schema is missing, unbounded or differs is skipped, never guessed.
export const CANDIDATES=[
 {id:'fal-ai/nano-banana',name:'Nano Banana',kind:'image',tasks:['image']},
 {id:'fal-ai/nano-banana/edit',name:'Nano Banana Retouche',kind:'image',tasks:['image_edit']},
 {id:'fal-ai/bytedance/seedream/v4/text-to-image',name:'Seedream 4',kind:'image',tasks:['image']},
 {id:'fal-ai/bytedance/seedream/v4/edit',name:'Seedream 4 Retouche',kind:'image',tasks:['image_edit']},
 {id:'fal-ai/flux-pro/v1.1-ultra',name:'FLUX 1.1 Pro Ultra',kind:'image',tasks:['image_precision','image']},
 {id:'fal-ai/flux-pro/kontext',name:'FLUX Kontext Pro',kind:'image',tasks:['image_edit_precision','image_edit']},
 {id:'fal-ai/imagen4/preview',name:'Imagen 4',kind:'image',tasks:['image_precision']},
 {id:'fal-ai/ideogram/v3',name:'Ideogram 3 (texte dans l’image)',kind:'image',tasks:['image_precision']},
 {id:'fal-ai/kling-video/v2.1/master/text-to-video',name:'Kling 2.1 Master',kind:'video',tasks:['video_narrative','video_short']},
 {id:'fal-ai/kling-video/v2.1/master/image-to-video',name:'Kling 2.1 Master (image)',kind:'video',tasks:['video_from_image','video_reference']},
 {id:'fal-ai/veo3/fast',name:'Veo 3 Fast',kind:'video',tasks:['video_short','video_narrative']},
 {id:'fal-ai/bytedance/seedance/v1/pro/image-to-video',name:'Seedance Pro (image)',kind:'video',tasks:['video_from_image']},
 {id:'fal-ai/minimax/hailuo-02/standard/image-to-video',name:'Hailuo 02 (image)',kind:'video',tasks:['video_from_image']},
 {id:'veed/fabric-1.0',name:'VEED Fabric (UGC)',kind:'video',tasks:['video_ugc']},
 {id:'fal-ai/bytedance/omnihuman',name:'OmniHuman (UGC)',kind:'video',tasks:['video_ugc']},
 {id:'fal-ai/clarity-upscaler',name:'Clarity Upscaler',kind:'image',tasks:['image_upscale']},
 {id:'fal-ai/birefnet/v2',name:'BiRefNet (détourage)',kind:'image',tasks:['image_background_removal']},
];

const TEXT={prompt:4000,negative_prompt:1000,text:2000};
const URLS=['image_url','audio_url','video_url','end_image_url','mask_url'];
const ENUMS=['aspect_ratio','resolution','image_size','duration','output_format','style','safety_tolerance','acceleration','rendering_speed'];
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
 const durations=(properties.duration?.enum||[]).map(Number).filter(Number.isFinite);
 const seconds=durations.length?Math.max(...durations)+1:candidate.kind==='video'?(candidate.tasks.includes('video_ugc')?30:10):undefined;
 if(candidate.kind==='video'&&!durations.length&&!candidate.tasks.includes('video_ugc')&&properties.duration)return {skip:'durée non bornée'};
 // Ambiguous units ("units", "requests") are left out on purpose: such a model stays closed.
 const limits=candidate.kind==='video'?{seconds,videos:1}:{images:1,megapixels:candidate.tasks.includes('image_upscale')?16:6};
 const unit=candidate.kind==='video'?'seconds':'images',maxUnits=candidate.kind==='video'?seconds:1;
 return {model:{id:candidate.id,name:candidate.name,kind:candidate.kind,tasks:candidate.tasks,description:candidate.name,unit,maxUnits,limits,inputSchema:{type:'object',additionalProperties:false,required,properties},approvedAt:new Date().toISOString(),approvedBy:'release-workflow'}};
}
