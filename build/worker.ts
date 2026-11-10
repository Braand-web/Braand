import {ensureContextSearchSchema} from '../lib/agent-context-schema';
import {ensureModelRates} from "../lib/model-rate-refresh";
import {ensureFalRates} from '../lib/fal-rate-refresh';
import {ensureApprovedFalModels} from '../lib/fal-models';
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import { raiseOperationalAlert } from "../lib/operations";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import {authenticateRequest, cleanupAuth, handleAuth, identityFreeHeaders} from "../lib/auth-runtime";
import {secureResponse} from '../lib/response-security.mjs';
import sitesGateway from "../services/sites/handler.mjs";
import {recordTraffic} from "../lib/traffic";
import {platformAdminIdsFrom} from '../lib/platform-owner-ids.mjs';
import {hasInternalTrafficCookie,internalTrafficCookie} from '../lib/traffic-core.mjs';
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
  await ensureContextSearchSchema(env.DB,scheduledTime);
  await ensureModelRates(env);
  await ensureFalRates(env as unknown as Record<string,unknown> & {BUCKET?:R2Bucket});await ensureApprovedFalModels(env as unknown as Record<string,unknown>);
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
      // Keep the cause with the alert (status and error code only, never a message or secret).
      const code = await response.clone().json().then((body: {code?: unknown}) => typeof body?.code === "string" ? body.code : "").catch(() => "");
      await raiseOperationalAlert(
        `cron:${slot}:${task.name}`,
        "scheduled_task_failed",
        alertCause(task.name, String(response.status), code),
      );
      console.error("Braand scheduled task returned an error.", task.name, response.status);
    } catch (error) {
      try {
        await raiseOperationalAlert(
          `cron:${slot}:${task.name}`,
          "scheduled_task_failed",
          alertCause(task.name, "exception", error instanceof Error ? error.name : ""),
        );
      } catch {
        // If storage itself is unavailable, keep only a sanitized platform log.
      }
      console.error("Braand scheduled task failed.", task.name);
    }
  }
}

/** "billing:503:database_unavailable": readable in the alert, safe to store. */
function alertCause(task: string, status: string, code: string) {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  return [clean(task), clean(status), clean(code)].filter(Boolean).join(":").slice(0, 180) || "task";
}

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // Published sites run their author's JavaScript, so they live on this Worker's
    // workers.dev address (a separate registrable domain). That host serves the
    // site gateway only: never the app, its API, sign-in or any cookie.
    const startedAt = Date.now();
    if (new URL(request.url).hostname.endsWith(".workers.dev")) {
      const siteResponse = await sitesGateway.fetch(request, env as never);
      const slug = new URL(request.url).pathname.match(/^\/([a-z0-9][a-z0-9-]{1,39})\//)?.[1];
      if (slug && slug !== "__preview") recordTraffic(env.DB, ctx, request, siteResponse, startedAt, {slug});
      return siteResponse;
    }
    const measured = request;
    // The local-only Vite middleware strips supplied headers before adding its fixture.
    // The root is a public client shell, with no private server data. Its assets
    // must load even when session storage is down, without reading D1 per chunk.
    // API/auth requests still reconstruct identity from the revocable D1 session.
    const path = new URL(request.url).pathname;
    const publicShell = (request.method === "GET" || request.method === "HEAD") && (
      path === "/" || /^\/(?:_next\/static|brand|fonts|onboarding)\//.test(path) ||
      ["/auth.css", "/favicon.ico", "/favicon.svg", "/file.svg", "/globe.svg", "/window.svg"].includes(path)
    );
    let sessionCookie: string | null = null;
    let verifiedAdmin = false, verifiedUser = false;
    if (!import.meta.env.DEV && publicShell) request = new Request(request, {headers: identityFreeHeaders(request.headers)});
    else if (!import.meta.env.DEV) {
      try {
        const authResponse = await handleAuth(request, env);
        if (authResponse) return secureResponse(authResponse,request);
        const authenticated = await authenticateRequest(request, env);
        request = authenticated.request;sessionCookie = authenticated.setCookie;
        const userId=request.headers.get('x-braand-identity-id');verifiedUser=!!userId;
        verifiedAdmin=!!userId&&platformAdminIdsFrom(env).has(userId);
      } catch {
        return secureResponse(Response.json({error:"Connexion temporairement indisponible.",code:"authentication_unavailable"}, {status:503,headers:{"Cache-Control":"no-store"}}),request);
      }
    }
    if (new URL(request.url).pathname.startsWith("/api/") && request.headers.has("x-braand-identity-id")) {await ensureModelRates(env);await ensureFalRates(env as unknown as Record<string,unknown> & {BUCKET?:R2Bucket});await ensureApprovedFalModels(env as unknown as Record<string,unknown>);}
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
    let response = secureResponse(await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx)),request);
    recordTraffic(env.DB, ctx, measured, response, startedAt,undefined,verifiedAdmin);
    // Remember a known administrator's browser without any identifier or D1
    // read on the public shell. A verified non-admin clears the opt-out when
    // sharing that browser. Supplied identity headers never reach this policy.
    if(verifiedUser&&verifiedAdmin!==hasInternalTrafficCookie(measured.headers)){
      response=new Response(response.body,response);response.headers.append('Set-Cookie',internalTrafficCookie(verifiedAdmin));
    }
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
    await ensureFalRates(env as unknown as Record<string,unknown> & {BUCKET?:R2Bucket});await ensureApprovedFalModels(env as unknown as Record<string,unknown>);
    if(env.WORK_ENABLED!=='true'||env.WORK_STAGING_VERIFIED!=='true'){batch.retryAll({delaySeconds:60});return;}
    for(const message of batch.messages){if(!message.body||typeof message.body.workId!=='string'||message.body.workId.length>160){message.ack();continue;}
      try{const secret=env.SCHEDULER_SECRET;if(!secret||secret.length<32)throw Error('scheduler_configuration_missing');const response=await runWithConnectorBinding(undefined,()=>handler.fetch(new Request('https://aira.internal/api/internal/work-tick?workId='+encodeURIComponent(message.body.workId),{method:'POST',headers:{authorization:'Bearer '+secret}}),env,ctx));if(response.ok)message.ack();else message.retry({delaySeconds:60});}
      catch{message.retry({delaySeconds:60});}
    }
  },
};
