import {z} from 'zod';
import {authorize,getResource} from './server';
import {saveGeneratedFile} from './generated-files';
import {AppError,safeFilename} from './core.mjs';
import {renderDocument,exportFormats} from './document-export.mjs';
import type {BillingIdentity} from './billing';
const input=z.object({id:z.string().min(1).max(160),version:z.number().int().positive(),format:z.enum(['md','html','csv','docx','xlsx','pdf','pptx'])}).strict();
export {exportFormats};
export async function buildDocument(tenant:string,raw:unknown){
 const p=input.parse(raw),source=await getResource(tenant,p.id);
 if(source.kind!=='deliverable'||source.status==='deleted')throw new AppError('Livrable introuvable.',404);
 if(source.version!==p.version)throw new AppError('Le livrable a changé. Actualisez avant de l’exporter.',409,'stale_version');
 const data=z.object({content:z.string().min(1).max(18000),sources:z.array(z.string().max(500)).max(12).default([])}).parse(source.data);
 try{return {...renderDocument(p.format,source.title,data.content,data.sources),name:safeFilename(source.title)+'.'+p.format,source,p};}
 catch(error){throw new AppError(error instanceof RangeError?error.message:'Le document n’a pas pu être exporté.',422,'document_export_unsupported');}
}
export async function exportDeliverable(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const output=await buildDocument(who.tenant,raw);
 const file=await saveGeneratedFile(who,{source:output.source,name:output.name,mime:['md','html','csv'].includes(output.p.format)?'text/plain':output.mime,format:output.p.format,bytes:output.bytes,audit:'deliverable.exported'});
 return {...file,downloadUrl:'/api/files?id='+encodeURIComponent(file.id)};
}
