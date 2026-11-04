// Services (yes/no), operations jobs/alerts/backups, agent quality and automatic lessons.
import {failure} from '@/lib/server';
import {requirePlatformAdmin,adminServices} from '@/lib/platform-admin';
import {operationsSummary} from '@/lib/operations';
import {agentQualityReport} from '@/lib/agent-quality';
import {lessonPatterns} from '@/lib/agent-lessons';
export async function GET(request:Request){try{await requirePlatformAdmin(request);
 const [operations,quality,lessons]=await Promise.all([operationsSummary().catch(()=>null),agentQualityReport(7).catch(()=>null),lessonPatterns().catch(()=>[])]);
 return Response.json({services:adminServices(),operations,quality,lessons:lessons.slice(0,30).map(p=>({tool:p.tool,code:p.code,count:p.count,recovered:p.recovered,lastSeen:p.lastSeen}))},{headers:{'Cache-Control':'private, no-store'}});
}catch(error){return failure(error);}}
