export const privateOperationKinds=new Set(['agent_profile','workflow','workflow_run','event_subscription','advisor_report']);
export function operationHiddenFrom(resource:{kind:string;data:Record<string,unknown>},userId:string){return privateOperationKinds.has(resource.kind)&&resource.data.ownerId!==userId;}
/** Lists and streamed cards carry bounded previews. Exact authorized reads and
 * exports remain separate, so a 500-row result never bloats every workspace. */
export function operationSnapshot<T extends {kind:string;data:Record<string,unknown>}>(resource:T):T{
 if(resource.kind==='workflow_run'&&Array.isArray(resource.data.rows))return {...resource,data:{...resource.data,rows:resource.data.rows.slice(0,5),rowCount:resource.data.rows.length,truncated:resource.data.rows.length>5}};
 if(resource.kind==='workflow'&&resource.data.fixture){const data=Object.fromEntries(Object.entries(resource.data).filter(([key])=>key!=='fixture'));return {...resource,data:{...data,fixtureStored:true}};}
 return resource;
}
