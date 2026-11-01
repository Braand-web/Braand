import {db,config} from '@/lib/server';
import {env} from 'cloudflare:workers';
import {ensureModelRates} from '@/lib/model-rate-refresh';
import {modelReadiness} from '@/lib/metering';
import {AGENT_SYSTEM_VERSION} from '@/lib/agent-system.mjs';
import {routingReadiness} from '@/lib/model-router';
export async function GET(request?:Request) {
  try {
    await db().prepare('SELECT 1 AS ok').first();
    if (request && new URL(request.url).searchParams.get('check') === 'assistant') {
      const pricing=await ensureModelRates(env);
      const ready=modelReadiness().ready;
      return Response.json({status:ready?'ok':'unavailable',assistantReady:ready,agentSystemVersion:AGENT_SYSTEM_VERSION,routing:routingReadiness(config()),pricing:pricing.status,reason:'reason' in pricing?pricing.reason:undefined},{status:ready?200:503,headers:{'Cache-Control':'no-store'}});
    }
    return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({status:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
