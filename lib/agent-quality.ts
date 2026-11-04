// Agent quality report computed inside the Worker (it has the database).
// Aggregates only: counts by status, tool and kind. No message text, user
// content or identifiers. Drives the weekly improvement loop.
import {db} from './server';
import {lessonPatterns} from './agent-lessons';

type Row=Record<string,string|number|null>;
const all=async(sql:string,since:number)=>(await db().prepare(sql).bind(since).all<Row>()).results;

export async function agentQualityReport(days=7,now=Date.now()){
 const since=now-days*86400000;
 const [runs,tools,feedback,proposals,browser]=await Promise.all([
  all("SELECT status,COUNT(*) n FROM runs WHERE created_at>? GROUP BY status ORDER BY n DESC",since),
  all("SELECT json_extract(data,'$.name') tool,COUNT(*) calls,SUM(CASE WHEN json_extract(data,'$.error') IS NOT NULL THEN 1 ELSE 0 END) errors FROM events WHERE type='tool_result' AND created_at>? GROUP BY tool ORDER BY errors DESC,calls DESC LIMIT 20",since),
  all("SELECT COALESCE(feedback,'aucun') feedback,COUNT(*) n FROM response_feedback WHERE updated_at>? GROUP BY feedback",since),
  all("SELECT json_extract(data,'$.kind') kind,status,COUNT(*) n FROM resources WHERE kind='proposal' AND created_at>? GROUP BY kind,status ORDER BY n DESC",since),
  all("SELECT status,COUNT(*) n FROM browser_sessions WHERE created_at>? GROUP BY status",since),
 ]);
 const total=runs.reduce((n,r)=>n+Number(r.n),0),interrupted=runs.filter(r=>r.status==='partial'||r.status==='failed').reduce((n,r)=>n+Number(r.n),0);
 const lessons=(await lessonPatterns().catch(()=>[])).filter(p=>p.count>=3&&now-p.lastSeen<=14*86400000).map(p=>({tool:p.tool,code:p.code,count:p.count,recovered:p.recovered}));
 return {days,generatedAt:new Date(now).toISOString(),total,interrupted,interruptedRate:total?Math.round(interrupted/total*100):0,runs,tools,feedback,proposals,browser,lessons};
}

export function qualitySummaryText(report:Awaited<ReturnType<typeof agentQualityReport>>){
 const failing=report.tools.filter(t=>Number(t.errors)>0).slice(0,6).map(t=>`- ${t.tool} : ${t.errors} échec(s) sur ${t.calls} appel(s)`).join('\n')||'- aucun échec d’outil';
 const waiting=report.proposals.filter(p=>p.status==='awaiting_approval').reduce((n,p)=>n+Number(p.n),0);
 return `Rapport qualité des agents Braand (${report.days} derniers jours)\n\nRéponses : ${report.total}, dont ${report.interrupted} interrompues (${report.interruptedRate} %).\nPropositions de création non approuvées : ${waiting}.\nLeçons automatiques actives : ${report.lessons.length}.\n\nOutils en échec :\n${failing}\n\nLe détail complet est dans l’administration Braand : /api/admin/quality. Aucune donnée d’utilisateur n’est incluse dans ce message.`;
}
