import {z} from 'zod';
const column=z.string().trim().min(1).max(60).refine(v=>!['__proto__','constructor','prototype'].includes(v),'Reserved column');
const scalar=z.union([z.string().max(2000),z.number().finite(),z.boolean(),z.null()]);
export const workflowRows=z.array(z.record(column,scalar)).max(500).superRefine((rows,ctx)=>{if(rows.some(row=>Object.keys(row).length>40)||JSON.stringify(rows).length>200000)ctx.addIssue({code:'custom',message:'Table too large'});});
export const workflowStep=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('select'),columns:z.array(column).min(1).max(40)}).strict(),
 z.object({operation:z.literal('filter'),column,operator:z.enum(['equals','contains','gte','lte']),value:scalar}).strict(),
 z.object({operation:z.literal('sort'),column,direction:z.enum(['asc','desc'])}).strict(),
 z.object({operation:z.literal('rename'),from:column,to:column}).strict(),
 z.object({operation:z.literal('aggregate'),column,method:z.enum(['sum','count','min','max']),groupBy:column.optional()}).strict(),
 z.object({operation:z.literal('replace_text'),column,find:z.string().min(1).max(200),replacement:z.string().max(200)}).strict(),
]);
export const workflowDefinition=z.object({title:z.string().trim().min(1).max(160),steps:z.array(workflowStep).min(1).max(12),sourceSkillId:z.string().min(1).max(160).optional(),sourceSkillVersion:z.number().int().positive().optional(),fixture:z.object({input:workflowRows,expected:workflowRows}).strict()}).strict().refine(v=>JSON.stringify(v).length<=120000,'Workflow too large').refine(v=>Boolean(v.sourceSkillId)===Boolean(v.sourceSkillVersion),'Source skill and version must be paired');
export type WorkflowRow=z.infer<typeof workflowRows>[number];
export function canonical(value:unknown):string{return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
export async function fingerprint(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
export function workflowCSV(input:unknown){
 const rows=workflowRows.parse(input),columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 const cell=(value:unknown)=>'"'+(typeof value==='string'?value.replace(/^[\u0000-\u0020]*[=+@-]/,"'$&"):String(value??'')).replaceAll('"','""')+'"';
 return [columns,...rows.map(row=>columns.map(key=>row[key]))].map(row=>row.map(cell).join(',')).join('\n');
}
/** A closed interpreter, never eval, scripts, network or provider calls. */
export function evaluateWorkflow(steps:unknown,input:unknown){
 const parsed=z.array(workflowStep).min(1).max(12).parse(steps);let rows=workflowRows.parse(input).map(row=>({...row}));
 for(const step of parsed){
  const requireColumn=(name:string)=>{if(rows.some(row=>!Object.hasOwn(row,name)))throw new Error('Colonne absente : '+name);};
  if(step.operation==='select'){for(const name of step.columns)requireColumn(name);rows=rows.map(row=>Object.fromEntries(step.columns.map(name=>[name,row[name]])));}
  else if(step.operation==='rename'){requireColumn(step.from);if(step.to!==step.from&&rows.some(row=>Object.hasOwn(row,step.to)))throw new Error('La colonne cible existe déjà.');rows=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key===step.from?step.to:key,value])));}
  else if(step.operation==='filter'){requireColumn(step.column);rows=rows.filter(row=>{const value=row[step.column];if(step.operator==='equals')return value===step.value;if(step.operator==='contains')return typeof value==='string'&&typeof step.value==='string'&&value.includes(step.value);if(typeof value!=='number'||typeof step.value!=='number')throw new Error('Comparaison numérique avec une valeur non numérique.');return step.operator==='gte'?value>=step.value:value<=step.value;});}
  else if(step.operation==='sort'){requireColumn(step.column);rows.sort((a,b)=>{const x=a[step.column],y=b[step.column];if(x===null||y===null)return x===y?0:x===null?1:-1;const delta=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'fr');return step.direction==='asc'?delta:-delta;});}
  else if(step.operation==='replace_text'){requireColumn(step.column);rows=rows.map(row=>{const value=row[step.column];if(typeof value!=='string')throw new Error('La retouche exige une colonne texte.');return {...row,[step.column]:value.split(step.find).join(step.replacement)};});}
  else{
   requireColumn(step.column);if(step.groupBy==='result')throw new Error('Renommez la colonne de groupe result avant cette opération.');if(step.groupBy)requireColumn(step.groupBy);
   const groups=new Map<string,{group:WorkflowRow[string];values:WorkflowRow[string][]}>();
   for(const row of rows){const group=step.groupBy?row[step.groupBy]:null,key=canonical(group);if(!groups.has(key))groups.set(key,{group,values:[]});groups.get(key)!.values.push(row[step.column]);}
   rows=[...groups.values()].map(({group,values})=>{if(step.method!=='count'&&values.some(v=>typeof v!=='number'))throw new Error('Une donnée absente ou non numérique ne vaut pas zéro.');const numbers=values as number[],value=step.method==='count'?values.length:step.method==='sum'?numbers.reduce((sum,n)=>sum+n,0):step.method==='min'?Math.min(...numbers):Math.max(...numbers);if(!Number.isFinite(value))throw new Error('Résultat numérique hors limites.');return {...(step.groupBy?{[step.groupBy]:group}:{}),result:value};});
  }
  workflowRows.parse(rows);
 }
 return rows;
}
