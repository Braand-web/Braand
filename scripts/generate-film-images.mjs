// Generate the product visuals of the Braand launch film with fal.ai (Seedream 4).
// Runs on GitHub Actions with the FAL_KEY repository secret; writes film-assets/*.jpg.
import {mkdir,writeFile} from 'node:fs/promises';
const key=process.env.FAL_KEY;if(!key)throw Error('Add the FAL_KEY repository secret (Settings → Secrets and variables → Actions) to generate the film images.');
const MODEL='fal-ai/bytedance/seedream/v4/text-to-image';
const base='Premium skincare serum in a frosted glass dropper bottle with a minimal white label reading "LUMA", ';
const SHOTS=[
 ['hero',base+'hero product shot on a polished travertine block, soft warm studio light, gentle shadow, peach and coral backdrop, editorial cosmetic advertising, ultra sharp, 85mm'],
 ['lifestyle',base+'on a bright modern bathroom shelf with green plants and morning sunlight, a woman’s hand reaching for it, natural lifestyle photography, shallow depth of field'],
 ['instagram',base+'flat lay on soft sand with seashells and water droplets, top-down square composition, clean summer palette, social media ad'],
 ['story',base+'held in a hand in front of a sunset sky, vertical framing feeling, warm golden tones, authentic phone photo aesthetic, UGC style'],
 ['banner',base+'floating among violet and lavender silk fabric, dreamy soft light, luxury beauty campaign, wide clean negative space'],
 ['cutout',base+'isolated product packshot on a seamless cyan background, perfectly centered, crisp reflections, catalog photography'],
];
await mkdir('film-assets',{recursive:true});
for(const [name,prompt] of SHOTS){
 const submit=await fetch('https://queue.fal.run/'+MODEL,{method:'POST',headers:{Authorization:'Key '+key,'Content-Type':'application/json'},body:JSON.stringify({prompt,image_size:'square_hd',num_images:1,enable_safety_checker:true})});
 if(!submit.ok)throw Error(name+' submit '+submit.status+' '+(await submit.text()).slice(0,300));
 const {request_id,status_url,response_url}=await submit.json();
 let done=false;for(let i=0;i<90&&!done;i++){await new Promise(r=>setTimeout(r,2000));const s=await (await fetch(status_url,{headers:{Authorization:'Key '+key}})).json();done=s.status==='COMPLETED';if(['FAILED','ERROR'].includes(s.status))throw Error(name+' failed');}
 if(!done)throw Error(name+' timed out ('+request_id+')');
 const result=await (await fetch(response_url,{headers:{Authorization:'Key '+key}})).json();
 const url=result.images?.[0]?.url;if(!url)throw Error(name+' no image');
 const bytes=Buffer.from(await (await fetch(url)).arrayBuffer());await writeFile('film-assets/'+name+'.jpg',bytes);console.log('ok',name,bytes.length);
}
