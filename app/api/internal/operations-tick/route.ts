import {failure,db} from '@/lib/server';
import {cleanupTraffic} from '@/lib/traffic';
import {requireOperationsScheduler,runOperationsTick} from '@/lib/operations';
import {cleanupDrafts} from '@/lib/drafts';
export async function POST(request: Request) {
  try {
    await requireOperationsScheduler(request);
    await cleanupDrafts();
    await cleanupTraffic(db() as unknown as D1Database).catch(()=>undefined);
    return Response.json(await runOperationsTick(),{headers:{'Cache-Control':'no-store'}});
  } catch (error) {return failure(error);}
}
