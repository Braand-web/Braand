// Services (yes/no), operations jobs/alerts/backups with their health, agent quality,
// why answers stop and automatic lessons. POST marks an alert resolved (audited).
import {failure} from '@/lib/server';
import {privateJSON} from '@/lib/private-json';
import {requirePlatformAdmin,adminServices,adminBackupHealth,adminResolveAlert,adminStopReasons} from '@/lib/platform-admin';
import {operationsSummary} from '@/lib/operations';
import {agentQualityReport} from '@/lib/agent-quality';
import {lessonPatterns} from '@/lib/agent-lessons';
const noStore={headers:{'Cache-Control':'private, no-store'}};
export async function GET(request:Request){try{await requirePlatformAdmin(request);
 const [operations,quality,lessons,backupHealth,stopReasons]=await Promise.all([operationsSummary().catch(()=>null),agentQualityReport(7).catch(()=>null),lessonPatterns().catch(()=>[]),adminBackupHealth().catch(()=>null),adminStopReasons(7).catch(()=>[])]);
 return Response.json({services:adminServices(),operations,backupHealth,stopReasons,quality,lessons:lessons.slice(0,30).map(p=>({tool:p.tool,code:p.code,count:p.count,recovered:p.recovered,lastSeen:p.lastSeen}))},noStore);
}catch(error){return failure(error);}}
export async function POST(request:Request){try{const who=await requirePlatformAdmin(request);return Response.json(await adminResolveAlert(who.user.userId,await privateJSON(request,4096)),noStore);}catch(error){return failure(error);}}
