import {z} from 'zod';
import {AppError} from './core.mjs';
import {createResource,getResource,updateResource} from './server';
import {linkResearchSources} from './research';

export const deliverableInput=z.object({title:z.string().trim().min(1).max(160),content:z.string().trim().min(1).max(150000),summary:z.string().trim().min(1).max(600),category:z.enum(['marketing','sales','commerce','content','management','analysis','research','software','operations','education','general']),sources:z.array(z.string().trim().min(1).max(500)).max(12)}).strict();

export async function saveDeliverable(tenant:string,input:unknown){
 const data=deliverableInput.parse(input);
 const resource=await createResource(tenant,'deliverable',data.title,{...data,format:'markdown',executionConfirmed:false},'draft');await linkResearchSources(tenant,resource.id,data.sources);return resource;
}

export async function reviseDeliverable(tenant:string,input:unknown){
 const {id,version,...data}=deliverableInput.extend({id:z.string().min(1).max(160),version:z.number().int().positive()}).parse(input),current=await getResource(tenant,id);
 if(current.kind!=='deliverable'||current.status==='deleted')throw new AppError('Livrable introuvable.',404);
 if(current.data.format==='source-project'||current.data.format==='data-analysis')throw new AppError('Ce livrable possède des sources structurées. Utilisez save_source_project ou analyze_data pour les préserver.',409,'structured_deliverable');
 const history=Array.isArray(current.data.history)?current.data.history:[];
 return updateResource(tenant,id,version,{title:data.title,status:'draft',data:{...data,format:'markdown',executionConfirmed:false,history:[...history,{version:current.version,content:current.data.content,at:Date.now()}].slice(-5)}});
}

/** Append one chapter or section to a saved deliverable, so long documents and
 * ebooks can be written step by step without resending the whole text. */
export async function appendDeliverableSection(tenant:string,input:unknown){
 const p=z.object({id:z.string().min(1).max(160),version:z.number().int().positive(),content:z.string().trim().min(1).max(18000)}).strict().parse(input),current=await getResource(tenant,p.id);
 if(current.kind!=='deliverable'||current.status==='deleted')throw new AppError('Livrable introuvable.',404);
 if(current.data.format!=='markdown')throw new AppError('Ce livrable possède des sources structurées et ne peut pas être complété ainsi.',409,'structured_deliverable');
 const content=String(current.data.content||'').trimEnd()+'\n\n'+p.content;
 if(content.length>150000)throw new AppError('Le document atteindrait la limite de 150 000 caractères. Créez un second volume.',400,'deliverable_too_long');
 return updateResource(tenant,p.id,p.version,{status:'draft',data:{...current.data,content}});
}
