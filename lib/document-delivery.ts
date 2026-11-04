import {z} from 'zod';
import {authorize,getResource} from './server';
import {saveGeneratedFile} from './generated-files';
import {AppError,safeFilename} from './core.mjs';
import {renderDocument,exportFormats} from './document-export.mjs';
import {buildPrintHtml} from './print-document.mjs';
import {printEngineReady,renderPrintPdf} from './print-pdf';
import {env} from 'cloudflare:workers';
import {db} from './server';

/** A library image as a data URI for the cover (owned, ready, image, at most 6 MB). */
async function coverDataUri(tenant:string,fileId:string){
 const file=await db().prepare("SELECT storage_key,detected_mime,size_bytes FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(fileId,tenant).first<{storage_key:string|null;detected_mime:string|null;size_bytes:number|null}>();
 if(!file?.storage_key||!/^image\/(png|jpeg|webp)$/.test(String(file.detected_mime))||Number(file.size_bytes||0)>6*1024*1024)throw new AppError('L’image de couverture doit être une image PNG, JPEG ou WebP de la bibliothèque (6 Mo maximum).',400,'cover_unavailable');
 const object=await (env as unknown as {BUCKET?:R2Bucket}).BUCKET?.get(file.storage_key);if(!object)throw new AppError('Image de couverture indisponible.',404,'cover_unavailable');
 const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return 'data:'+file.detected_mime+';base64,'+btoa(binary);
}
import type {BillingIdentity} from './billing';
const input=z.object({id:z.string().min(1).max(160),version:z.number().int().positive(),format:z.enum(['md','html','csv','docx','xlsx','pdf','pptx']),layout:z.enum(['document','report','guide','ebook']).default('document'),subtitle:z.string().trim().max(200).optional(),author:z.string().trim().max(120).optional(),accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),coverFileId:z.string().min(1).max(160).optional()}).strict();
export {exportFormats};
export async function buildDocument(tenant:string,raw:unknown){
 const p=input.parse(raw),source=await getResource(tenant,p.id);
 if(source.kind!=='deliverable'||source.status==='deleted')throw new AppError('Livrable introuvable.',404);
 if(source.version!==p.version)throw new AppError('Le livrable a changé. Actualisez avant de l’exporter.',409,'stale_version');
 const data=z.object({content:z.string().min(1).max(150000),sources:z.array(z.string().max(500)).max(12).default([])}).parse(source.data);
 if(p.format==='pdf'&&printEngineReady()){
  // Print-quality PDF: Chromium renders the layout (cover, contents, chapters, page numbers).
  try{
   const coverImage=p.coverFileId?await coverDataUri(tenant,p.coverFileId):'';
   const html=buildPrintHtml({title:source.title,subtitle:p.subtitle,author:p.author,content:data.content,layout:p.layout,accent:p.accentColor,coverImage,sources:data.sources});
   const bytes=await renderPrintPdf(html,{small:p.layout==='ebook'});
   return {bytes,mime:'application/pdf',name:safeFilename(source.title)+'.pdf',source,p};
  }catch(error){if(error instanceof AppError&&error.code==='cover_unavailable')throw error;/* Fall back to the simple PDF below. */}
 }
 try{return {...renderDocument(p.format,source.title,data.content,data.sources),name:safeFilename(source.title)+'.'+p.format,source,p};}
 catch(error){throw new AppError(error instanceof RangeError?error.message:'Le document n’a pas pu être exporté.',422,'document_export_unsupported');}
}
export async function exportDeliverable(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const output=await buildDocument(who.tenant,raw);
 const file=await saveGeneratedFile(who,{source:output.source,name:output.name,mime:['md','html','csv'].includes(output.p.format)?'text/plain':output.mime,format:output.p.format,bytes:output.bytes,audit:'deliverable.exported'});
 return {...file,downloadUrl:'/api/files?id='+encodeURIComponent(file.id)};
}
