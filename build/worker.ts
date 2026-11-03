import {ensureModelRates} from "../lib/model-rate-refresh";
import {ensureFalRates} from '../lib/fal-rate-refresh';
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import { raiseOperationalAlert } from "../lib/operations";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import {authenticateRequest, cleanupAuth, handleAuth} from "../lib/auth-runtime";
import {secureResponse} from '../lib/response-security.mjs';
export {BrowserSession} from "../lib/browser-session-do";

const scheduledTasks = [
  { name: "billing", path: "/api/internal/billing-tick" },
  { name: "missions", path: "/api/internal/mission-tick" },
  { name: "operations", path: "/api/internal/operations-tick" },
] as const;

async function runScheduledTasks(
  scheduledTime: number,
  env: Cloudflare.Env,
  ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  cron?: string,
) {
  await ensureModelRates(env);
  await ensureFalRates(env as unknown as Record<string,unknown> & {BUCKET?:R2Bucket});
  const secret = env.SCHEDULER_SECRET;
  if (!secret || secret.length < 32) {
    console.error("Braand scheduled tasks are not configured.");
    return;
  }
  if(cron==='* * * * *'){
    if(!['WORK_ENABLED','SOCIAL_ENABLED','MEDIA_PERSIST_ENABLED','MEDIA_RENDER_ENABLED'].some(key=>(env as unknown as Record<string,string>)[key]==='true'))return;
    const response=await runWithConnectorBinding(undefined,()=>handler.fetch(new Request('https://aira.internal/api/internal/platform-tick',{method:'POST',headers:{authorization:'Bearer '+secret}}),env,ctx));
    if(!response.ok)await raiseOperationalAlert('platform:'+Math.floor(scheduledTime/60000),'scheduled_task_failed','platform');
    return;
  }
  const slot = Math.floor(scheduledTime / 300_000);
  try {await cleanupAuth(env);} catch {console.error("Braand auth housekeeping failed.");}
  for (const task of scheduledTasks) {
    // A deliberately closed feature is not a failed job. Keep billing/file
    // housekeeping and monitoring running even while autonomy is disabled.
    if (task.name === "missions" && env.AUTONOMY_ENABLED !== "true") continue;
    try {
      const request = new Request(`https://braand.internal${task.path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      const response = await runWithConnectorBinding(undefined, () =>
        handler.fetch(request, env, ctx),
      );
      if (response.ok) continue;
      await raiseOperationalAlert(
        `cron:${slot}:${task.name}`,
        "scheduled_task_failed",
        task.name,
      );
      console.error("Braand scheduled task returned an error.", task.name, response.status);
    } catch {
      try {
        await raiseOperationalAlert(
          `cron:${slot}:${task.name}`,
          "scheduled_task_failed",
          task.name,
        );
      } catch {
        // If storage itself is unavailable, keep only a sanitized platform log.
      }
      console.error("Braand scheduled task failed.", task.name);
    }
  }
}

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // The local-only Vite middleware strips supplied headers before adding its fixture.
    // Production always reconstructs identity from a private, revocable D1 session.
    let sessionCookie: string | null = null;
    if (!import.meta.env.DEV) {
      try {
        const authResponse = await handleAuth(request, env);
        if (authResponse) return secureResponse(authResponse,request);
        const authenticated = await authenticateRequest(request, env);
        request = authenticated.request;sessionCookie = authenticated.setCookie;
      } catch {
        return secureResponse(Response.json({error:"Connexion temporairement indisponible.",code:"authentication_unavailable"}, {status:503,headers:{"Cache-Control":"no-store"}}),request);
      }
    }
    if (new URL(request.url).pathname.startsWith("/api/") && request.headers.has("x-braand-identity-id")) {await ensureModelRates(env);await ensureFalRates(env as unknown as Record<string,unknown> & {BUCKET?:R2Bucket});}
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = secureResponse(await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx)),request);
    // An active session is extended at most once a day; streaming bodies are left untouched.
    if (sessionCookie) {try {response.headers.append("Set-Cookie", sessionCookie);} catch {const copy = new Response(response.body, response);copy.headers.append("Set-Cookie", sessionCookie);return copy;}}
    return response;
  },
  scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ) {
    ctx.waitUntil(runScheduledTasks(controller.scheduledTime, env, ctx,controller.cron));
  },
  async queue(batch:MessageBatch<{workId:string}>,env:Cloudflare.Env,ctx:ExecutionContext<{CONNECTORS?:ConnectorBinding}>){
    await ensureModelRates(env);
    await ensureFalRates(env as unknown as Record<string,unknown> & {BUCKET?:R2Bucket});
    if(env.WORK_ENABLED!=='true'||env.WORK_STAGING_VERIFIED!=='true'){batch.retryAll({delaySeconds:60});return;}
    for(const message of batch.messages){if(!message.body||typeof message.body.workId!=='string'||message.body.workId.length>160){message.ack();continue;}
      try{const secret=env.SCHEDULER_SECRET;if(!secret||secret.length<32)throw Error('scheduler_configuration_missing');const response=await runWithConnectorBinding(undefined,()=>handler.fetch(new Request('https://aira.internal/api/internal/work-tick?workId='+encodeURIComponent(message.body.workId),{method:'POST',headers:{authorization:'Bearer '+secret}}),env,ctx));if(response.ok)message.ack();else message.retry({delaySeconds:60});}
      catch{message.retry({delaySeconds:60});}
    }
  },
};
