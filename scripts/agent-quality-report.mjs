// Weekly agent quality report from production data (read-only SQL).
// Shows where agents fail so instructions, skills and tools can be improved.
// Aggregates only (counts by status, tool and kind): no message text, user
// content or identifiers ever leave the database.
import {appendFile} from 'node:fs/promises';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN,days=Number(process.env.REPORT_DAYS||7);
if(!account||!token)throw Error('Cloudflare credentials missing');
const api=async(path,body)=>{const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok||!d.success)throw Error(path+' failed: '+JSON.stringify(d.errors||[]));return d.result;};
const settings=await api('/workers/scripts/aira-production/settings'),database=settings.bindings.find(b=>b.name==='DB'&&b.type==='d1')?.id;
if(!database)throw Error('Production D1 binding not found');
const since=Date.now()-days*86400000;
const query=async sql=>{if(!/^\s*SELECT/i.test(sql))throw Error('Read-only queries only');return (await api('/d1/database/'+database+'/query',{sql,params:[String(since)]}))[0].results;};
const table=(rows,cols)=>rows.length?'| '+cols.join(' | ')+' |\n|'+cols.map(()=>'---').join('|')+'|\n'+rows.map(r=>'| '+cols.map(c=>String(r[c]??'').replaceAll('|','/').replaceAll('\n',' ')).join(' | ')+' |').join('\n'):'_Aucune donnée._';
const runs=await query("SELECT status,COUNT(*) n FROM runs WHERE created_at>?1 GROUP BY status ORDER BY n DESC");
const tools=await query("SELECT json_extract(data,'$.name') tool,COUNT(*) calls,SUM(CASE WHEN json_extract(data,'$.error') IS NOT NULL THEN 1 ELSE 0 END) errors FROM events WHERE type='tool_result' AND created_at>?1 GROUP BY tool HAVING errors>0 OR calls>=5 ORDER BY errors DESC,calls DESC LIMIT 15");
const feedback=await query("SELECT COALESCE(feedback,'aucun') feedback,COUNT(*) n FROM response_feedback WHERE updated_at>?1 GROUP BY feedback");
const proposals=await query("SELECT json_extract(data,'$.kind') kind,status,COUNT(*) n FROM resources WHERE kind='proposal' AND created_at>?1 GROUP BY kind,status ORDER BY n DESC");
const browser=await query("SELECT status,COUNT(*) n FROM browser_sessions WHERE created_at>?1 GROUP BY status");
const total=runs.reduce((n,r)=>n+r.n,0),bad=runs.filter(r=>['partial','failed'].includes(r.status)).reduce((n,r)=>n+r.n,0);
const report=`# Qualité des agents Braand — ${days} derniers jours

**${total} réponses**, dont **${bad} interrompues ou en échec** (${total?Math.round(bad/total*100):0} %).

## Réponses par statut
${table(runs,['status','n'])}

## Outils : appels et échecs
${table(tools,['tool','calls','errors'])}

## Avis des utilisateurs
${table(feedback,['feedback','n'])}

## Propositions de création
${table(proposals,['kind','status','n'])}

_Une proposition restée en \`awaiting_approval\` signale un parcours d'approbation à simplifier._

## Navigateur
${table(browser,['status','n'])}

## Comment s'en servir
Le détail d'une erreur se consulte dans la base, jamais dans ce rapport public. Chaque ligne en échec répétée est une piste d'amélioration : consigne d'agent plus précise, compétence à compléter, outil à corriger ou à masquer quand il ne peut pas marcher.
`;
console.log(report);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,report);
