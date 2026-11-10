import {db,authorize} from './server';

/** Indexed retrieval only. Live row checks prevent deleted or foreign hits,
 * including while an old index is being maintained. No global result cache. */
export async function indexedContextIds(tenant:string,query:string,projectId:string|null,userId:string,personal=false):Promise<string[]|null>{
 if(!query.trim())return null;
 if(userId)await authorize(tenant,userId,'read');
 const terms=[...new Set(query.toLocaleLowerCase('fr').match(/[\p{L}\p{N}]{2,}/gu)||[])].slice(0,8);
 if(!terms.length)return [];
 const match='workspace_id:"'+tenant.replace(/"/g,'""')+'" AND ('+terms.map(term=>'"'+term+'"*').join(' OR ')+')';
 const json="CASE WHEN json_valid(r.data) THEN r.data ELSE '{}' END";
 const scope=personal?`((json_extract(${json},'$.projectId') IS ? AND (json_extract(${json},'$.userId') IS NULL OR json_extract(${json},'$.userId')=?)) OR (json_extract(${json},'$.scope')='user' AND json_extract(${json},'$.userId')=?))`:`(json_extract(${json},'$.projectId') IS ? AND (json_extract(${json},'$.userId') IS NULL OR json_extract(${json},'$.userId')=?))`;
 try{
  const rows=await db().prepare(`SELECT r.id FROM agent_context_fts JOIN resources r ON r.rowid=agent_context_fts.rowid AND r.id=agent_context_fts.resource_id AND r.workspace_id=agent_context_fts.workspace_id WHERE agent_context_fts MATCH ? AND r.workspace_id=? AND r.kind IN ('knowledge','deliverable') AND r.status!='deleted' AND ${scope} ORDER BY rank LIMIT 12`).bind(match,tenant,projectId,userId,...(personal?[userId]:[])).all<{id:string}>();
  return rows.results.map(row=>row.id);
 }catch(error){
  // Only a missing additive migration enables compatibility fallback. A quota
  // or storage outage must not trigger another expensive scan.
  if(error instanceof Error&&/no such table.*agent_context_fts/i.test(error.message))return null;
  throw error;
 }
}
