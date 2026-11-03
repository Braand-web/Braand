import {z} from 'zod';

const id=z.string().min(1).max(160),label=z.string().max(240),text=z.string().max(12000);
const cell=z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()]);
export const richReferenceSchema=z.object({id,version:z.number().int().positive(),kind:id}).strict();
const base={id,title:label.optional(),note:z.string().max(1000).optional()};
const field=z.object({id,label,type:z.enum(['text','number','select']),options:z.array(label).max(12).optional(),required:z.boolean().optional()}).strict();
export const richBlockSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('markdown'),text}).strict(),
 z.object({...base,type:z.literal('code'),code:text,language:label}).strict(),
 z.object({...base,type:z.literal('table'),columns:z.array(label).min(1).max(12),rows:z.array(z.array(cell).max(12)).max(100),source:label,period:label.optional(),unit:label.optional()}).strict(),
 z.object({...base,type:z.literal('chart'),chart:z.enum(['bar','line']),unit:label,period:label,source:label,dataKind:z.enum(['observed','estimated','example']),points:z.array(z.object({label,value:z.number().finite().nullable()}).strict()).min(1).max(100)}).strict(),
 z.object({...base,type:z.literal('metrics'),source:label,period:label,items:z.array(z.object({label,value:cell,unit:label}).strict()).max(8)}).strict(),
 z.object({...base,type:z.literal('objects'),refs:z.array(richReferenceSchema).min(1).max(12)}).strict(),
 z.object({...base,type:z.literal('files'),refs:z.array(richReferenceSchema).min(1).max(8)}).strict(),
 z.object({...base,type:z.literal('choices'),question:label,options:z.array(z.object({id,label}).strict()).min(2).max(8)}).strict(),
 z.object({...base,type:z.literal('form'),fields:z.array(field).min(1).max(8)}).strict(),
 z.object({...base,type:z.literal('progress'),items:z.array(z.object({label,state:z.enum(['pending','running','complete','failed','unknown'])}).strict()).max(20)}).strict(),
]);
export const richInputSchema=z.object({version:z.literal(1),blocks:z.array(richBlockSchema).min(1).max(12)}).strict().superRefine((value,ctx)=>{
 if(new Set(value.blocks.map(b=>b.id)).size!==value.blocks.length)ctx.addIssue({code:'custom',message:'Duplicate block ID'});
 if(JSON.stringify(value).length>60000)ctx.addIssue({code:'custom',message:'Response too large'});
 for(const block of value.blocks){if(block.type==='table'&&block.rows.some(row=>row.length!==block.columns.length))ctx.addIssue({code:'custom',message:'Table dimensions differ'});if(block.type==='form'&&new Set(block.fields.map(f=>f.id)).size!==block.fields.length)ctx.addIssue({code:'custom',message:'Duplicate field ID'});}
});
export type RichBlock=z.infer<typeof richBlockSchema>;
export type RichObject={id:string;kind:string;title:string;version:number;status:string;details:Record<string,string|number|null>;file?:{id:string;workspaceId:string;name:string;mime:string;size:number;status:string;createdAt:number;updatedAt:number;deletedAt:number|null}};
export type RichResponse={version:1;id:string;messageId:string;conversationId:string;workspaceId:string;projectId:string|null;retrievedAt:number;blocks:RichBlock[];objects:RichObject[]};
/** One invalid component never suppresses its siblings. Unknown versions remain readable. */
export function readableRichBlocks(value:unknown):RichBlock[]{
 if(!value||typeof value!=='object')return [];
 const data=value as Record<string,unknown>;
 if(data.version!==1)return [{id:'unsupported',type:'markdown',text:'Cette présentation nécessite une version plus récente. Le texte de la réponse reste disponible.'}];
 if(!Array.isArray(data.blocks))return [];
 return data.blocks.slice(0,12).map((block,index)=>{const parsed=richBlockSchema.safeParse(block);return parsed.success?parsed.data:{id:'invalid-'+index,type:'markdown',text:'Cet élément ne peut pas être affiché. Demandez à Braand de le reformuler.'};});
}
export const richPresentationInstruction=`Présente une réponse courte en texte ordinaire, sans outil de présentation. Pour une comparaison, une tendance chiffrée, des objets à consulter ou plusieurs questions liées, utilise present_response une seule fois après les lectures utiles. Types autorisés: markdown {text}, code {code,language}, table {columns,rows,source,period?,unit?}, chart {chart:bar|line,unit,period,source,dataKind:observed|estimated|example,points:[{label,value:number|null}]}, metrics {source,period,items:[{label,value,unit}]}, objects/files {refs:[{id,kind,version}]}, choices {question,options:[{id,label}]}, form {fields:[{id,label,type:text|number|select,options?,required?}]}, progress {items:[{label,state:pending|running|complete|failed|unknown}]}. Chaque bloc a un id stable et peut avoir title,note. Maximum 12 blocs et 100 lignes. Les objets et fichiers sont hydratés par le serveur: utilise leurs identifiants et versions réellement lus. Les données numériques doivent provenir des résultats ou de l'utilisateur, jamais d'une invention; indique source, unités, période, limites, exemple ou estimation. null signifie indisponible, jamais zéro. Ne mélange pas devises ou périodes. Ne répète pas toutes les données du composant dans le texte. Un bouton ne donne aucune autorisation. Les retouches ciblées utilisent l'identifiant et la version et conservent les autres éléments; indique les limites de fidélité du moteur avant de promettre une conservation exacte.`;
export const richPresentationTool={name:'present_response',description:'Present useful validated interactive blocks in the conversation, after reading actual data. No external mutation or approval. Ordinary short answers use text. Schema details are in the system presentation instructions.',input_schema:{type:'object',properties:{version:{type:'integer',enum:[1]},blocks:{type:'array',minItems:1,maxItems:12,items:{type:'object'}}},required:['version','blocks'],additionalProperties:false}};
