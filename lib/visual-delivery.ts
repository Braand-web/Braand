// Designed visuals (social posts, stories, banners, quotes, stats, lists) rendered
// to PNG by Chromium. The spec is kept as a private deliverable so the visual
// can be revised later; the PNG lands in the library like any generated file.
import {z} from 'zod';
import {authorize} from './server';
import {saveGeneratedFile} from './generated-files';
import {saveDeliverable} from './agent-deliverables';
import {safeFilename} from './core.mjs';
import {buildVisualHtml,VISUAL_FORMATS,VISUAL_TEMPLATES} from './visual-card.mjs';
import {renderVisualPng} from './print-pdf';
import {libraryImageDataUri} from './document-delivery';
import type {BillingIdentity} from './billing';

export const visualInput=z.object({
 title:z.string().trim().min(1).max(160),
 template:z.enum(VISUAL_TEMPLATES as [string,...string[]]).default('announcement'),
 format:z.enum(Object.keys(VISUAL_FORMATS) as [string,...string[]]).default('square'),
 headline:z.string().trim().min(1).max(220),
 kicker:z.string().trim().max(40).optional(),
 body:z.string().trim().max(280).optional(),
 items:z.array(z.string().trim().min(1).max(90)).max(6).optional(),
 stat:z.string().trim().max(12).optional(),
 author:z.string().trim().max(80).optional(),
 cta:z.string().trim().max(40).optional(),
 brandName:z.string().trim().max(40).optional(),
 accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
 backgroundFileId:z.string().min(1).max(160).optional(),
}).strict().superRefine((v,ctx)=>{
 if(v.template==='stat'&&!v.stat)ctx.addIssue({code:'custom',path:['stat'],message:'Le modèle stat demande un chiffre (stat).'});
 if(v.template==='list'&&!v.items?.length)ctx.addIssue({code:'custom',path:['items'],message:'Le modèle list demande des éléments (items).'});
});

export async function renderVisual(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const p=visualInput.parse(raw),[width,height]=VISUAL_FORMATS[p.format as keyof typeof VISUAL_FORMATS];
 const background=p.backgroundFileId?await libraryImageDataUri(who.tenant,p.backgroundFileId):'';
 const html=buildVisualHtml({...p,accent:p.accentColor,background});
 const bytes=await renderVisualPng(html,width,height);
 const spec=['# '+p.title,'','- Modèle : '+p.template,'- Format : '+p.format+' ('+width+'×'+height+')','- Titre : '+p.headline,...(p.kicker?['- Accroche : '+p.kicker]:[]),...(p.body?['- Texte : '+p.body]:[]),...(p.stat?['- Chiffre : '+p.stat]:[]),...(p.items?.length?['- Éléments : '+p.items.join(' · ')]:[]),...(p.author?['- Auteur : '+p.author]:[]),...(p.cta?['- Appel à l’action : '+p.cta]:[]),...(p.accentColor?['- Couleur : '+p.accentColor]:[]),...(p.backgroundFileId?['- Image de fond : '+p.backgroundFileId]:[])].join('\n');
 const source=await saveDeliverable(who.tenant,{title:p.title,content:spec,summary:'Visuel '+p.template+' '+width+'×'+height+' rendu en PNG.',category:'marketing',sources:[]});
 const file=await saveGeneratedFile(who,{source,name:safeFilename(p.title)+'-'+width+'x'+height+'.png',mime:'image/png',format:'png',bytes,audit:'visual.rendered',media:true});
 return {...file,width,height,specId:source.id,downloadUrl:'/api/files?id='+encodeURIComponent(file.id)};
}
