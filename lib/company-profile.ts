// Company profile ("fiche entreprise") and staff registry, saved once per
// workspace and reused by every administrative document: letterhead, logo,
// legal identifiers, signatories, staff list and per-type numbering.
import {z} from 'zod';
import {AppError} from './core.mjs';
import {authorize,createResource,db,getResource,updateResource} from './server';
import type {BillingIdentity} from './billing';

const text=(max:number)=>z.string().trim().max(max);
const person=z.object({name:text(120).min(1),role:text(120).optional(),matricule:text(40).optional(),service:text(120).optional()}).strict();
export const companyFields=z.object({
 name:text(160).min(1),address:text(240).optional(),city:text(80).optional(),country:text(80).optional(),
 phone:text(60).optional(),email:text(160).optional(),rccm:text(80).optional(),niu:text(80).optional(),
 logoFileId:text(160).optional(),accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
 signatories:z.array(person).max(4).optional(),staff:z.array(person).max(200).optional(),
 learnMode:z.boolean().optional(),
}).strict();
export type CompanyProfile=z.infer<typeof companyFields>&{counters?:Record<string,number>};
type ProfileResource={id:string;version:number;data:CompanyProfile};

/** The current profile of this workspace, or null. */
export async function findCompanyProfile(tenant:string):Promise<ProfileResource|null>{
 const row=await db().prepare("SELECT id FROM resources WHERE workspace_id=? AND kind='company_profile' AND status!='deleted' ORDER BY updated_at DESC LIMIT 1").bind(tenant).first<{id:string}>();
 if(!row)return null;const resource=await getResource(tenant,row.id);
 return {id:resource.id,version:resource.version,data:resource.data as CompanyProfile};
}

export async function getCompanyProfile(who:BillingIdentity){
 await authorize(who.tenant,who.user.userId,'read');
 const found=await findCompanyProfile(who.tenant);
 return found?{exists:true,id:found.id,version:found.version,profile:found.data}:{exists:false,notice:'Aucune fiche entreprise. Propose de la créer : raison sociale, adresse, ville, téléphone, RCCM, NIU, logo, signataire, personnel.'};
}

/** Create or update (fields omitted keep their saved value; lists are replaced when sent). */
export async function saveCompanyProfile(who:BillingIdentity,raw:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const input=z.object({version:z.number().int().nonnegative().optional()}).passthrough().parse(raw);
 const {version,...fields}=input,current=await findCompanyProfile(who.tenant);
 if(!current){const data=companyFields.parse(fields);const created=await createResource(who.tenant,'company_profile',data.name,{...data,counters:{}},'ready');return {id:created.id,version:created.version,profile:created.data};}
 const merged=companyFields.parse({...Object.fromEntries(Object.entries(current.data).filter(([key])=>key!=='counters')),...fields});
 const updated=await updateResource(who.tenant,current.id,version??current.version,{title:merged.name,data:{...merged,counters:current.data.counters||{}},status:'ready'});
 return {id:updated.id,version:updated.version,profile:updated.data};
}

/** Next document number for a prefix, e.g. BD-2026-014 (retries on concurrent updates). */
export async function nextDocumentNumber(tenant:string,prefix:string,year=new Date().getUTCFullYear()){
 for(let attempt=0;attempt<4;attempt++){
  const current=await findCompanyProfile(tenant);if(!current)return null;
  const key=prefix+'-'+year,counters={...(current.data.counters||{})},next=(counters[key]||0)+1;counters[key]=next;
  try{await updateResource(tenant,current.id,current.version,{data:{...current.data,counters}});return `${prefix}-${year}-${String(next).padStart(3,'0')}`;}
  catch(error){if(!(error instanceof AppError)||error.code!=='stale_version')throw error;}
 }
 return null;
}
