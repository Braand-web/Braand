// create_office_document: administrative documents (Excel with formulas, Word
// with letterhead, PDF) and Excel lessons, filled from the company profile and
// saved privately to the library. Code-generated: no model or media cost.
import {z} from 'zod';
import {authorize} from './server';
import {AppError,safeFilename} from './core.mjs';
import {saveGeneratedFile} from './generated-files';
import {saveDeliverable} from './agent-deliverables';
import {libraryImageDataUri} from './document-delivery';
import {findCompanyProfile,nextDocumentNumber} from './company-profile';
import {OFFICE_TEMPLATES,EXCEL_LESSONS,renderOfficeTemplate} from './office-templates.mjs';
import {printEngineReady,renderPrintPdf} from './print-pdf';
import type {BillingIdentity} from './billing';

const scalar=z.union([z.string().max(4000),z.number().finite(),z.boolean()]);
const row=z.record(z.string().max(40),scalar);
export const officeDocumentInput=z.object({
 template:z.enum(Object.keys(OFFICE_TEMPLATES) as [string,...string[]]),
 format:z.enum(['xlsx','docx','pdf']),
 title:z.string().trim().min(1).max(160).optional(),
 blank:z.boolean().default(false),
 learn:z.boolean().optional(),
 data:z.record(z.string().max(40),z.union([scalar,z.array(z.union([row,z.string().max(200)])).max(500)])).default({}),
}).strict().superRefine((value,ctx)=>{
 if(JSON.stringify(value.data).length>200000)ctx.addIssue({code:'custom',path:['data'],message:'Données trop volumineuses (200 Ko maximum).'});
 if(value.template==='lecon_excel'&&value.data.lesson!==undefined&&!(String(value.data.lesson) in EXCEL_LESSONS))ctx.addIssue({code:'custom',path:['data','lesson'],message:'Leçons disponibles : '+Object.keys(EXCEL_LESSONS).join(', ')});
});

const MIME={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf'} as const;
const NUMBERED=new Set(['bon_decaissement','ordre_mission','attestation','note_service','demande_conge']);

function dataUriBytes(uri:string){const base64=uri.slice(uri.indexOf(',')+1),binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}

export async function createOfficeDocument(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const p=officeDocumentInput.parse(raw),def=OFFICE_TEMPLATES[p.template as keyof typeof OFFICE_TEMPLATES];
 if(!(def.formats as readonly string[]).includes(p.format))throw new AppError(`${def.label} existe en : ${def.formats.join(', ')}.`,400,'format_unavailable');
 const profile=await findCompanyProfile(who.tenant),company:Record<string,unknown>={...(profile?.data||{})};
 if(profile?.data.logoFileId){try{const uri=await libraryImageDataUri(who.tenant,profile.data.logoFileId);company.logoDataUri=uri;company.logo={bytes:dataUriBytes(uri)};}catch{/* A missing logo never blocks a document. */}}
 const data:Record<string,unknown>=p.blank?{...(p.template==='lecon_excel'?{lesson:p.data.lesson}:{}),...(p.template==='fiche_presence'?{month:p.data.month,year:p.data.year,staff:p.data.staff??profile?.data.staff}:{})}:{...p.data};
 if(p.template==='fiche_presence'&&!data.staff&&profile?.data.staff?.length)data.staff=profile.data.staff;
 if(!p.blank&&NUMBERED.has(p.template)&&!data.number){const number=await nextDocumentNumber(who.tenant,def.prefix);if(number)data.number=number;}
 const learn=p.learn??profile?.data.learnMode??true;
 const rendered=renderOfficeTemplate(p.template,p.format,company,data,{learn,accent:profile?.data.accentColor});
 let bytes:Uint8Array;
 if(rendered.kind==='html'){
  if(!printEngineReady())throw new AppError('Le PDF n’est pas disponible pour le moment : choisissez docx, puis Fichier › Exporter › PDF dans Word.',503,'print_engine_unavailable');
  bytes=await renderPrintPdf(rendered.html);
 }else bytes=rendered.bytes;
 const label=p.title||(def.label+(data.number?' '+data.number:'')+(p.blank?' (modèle vierge)':''));
 const fields=Object.entries(data).filter(([,v])=>typeof v!=='object').map(([k,v])=>`- ${k} : ${v}`);
 const source=await saveDeliverable(who.tenant,{title:label,content:`# ${label}\n\nModèle : ${def.label} · format ${p.format}${p.blank?' · vierge':''}\n\n${fields.join('\n')||'- (aucune donnée)'}`,summary:`${def.label} généré au format ${p.format}.`,category:'operations',sources:[]});
 const file=await saveGeneratedFile(who,{source,name:safeFilename(label)+'.'+p.format,mime:MIME[p.format],format:p.format,bytes,audit:'office_document.created'});
 return {...file,template:p.template,format:p.format,number:data.number??null,companyProfile:!!profile,learnAnnex:learn&&p.format!=='pdf',downloadUrl:'/api/files?id='+encodeURIComponent(file.id),opensIn:p.format==='xlsx'?'Excel':p.format==='docx'?'Word':'PDF',
  ...(profile?{}:{notice:'Aucune fiche entreprise : le document n’a pas d’en-tête. Propose de la créer avec save_company_profile.'})};
}
