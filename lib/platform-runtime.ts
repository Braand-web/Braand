import { z } from 'zod';
import { AppError } from './core.mjs';
import { browserService } from './browser';
import type { AgentScope } from './agent-state';
import type { RunBudget } from './metering';
// Background work up to this budget starts automatically, without a click.
export const AUTO_LAUNCH_MAX_CREDITS=25;
export async function executePlatformTool(name: string, input: unknown, scope: AgentScope, budget: RunBudget): Promise<unknown> {
    const parseId = () => z.object({ id: z.string().min(1).max(160) }).strict().parse(input).id;
    switch (name) {
        case 'list_saved_logins': {z.object({}).strict().parse(input);const result=await (await import('./browser-vault')).vaultRequest(budget.who,'/list');return {credentials:result.credentials};}
        case 'request_secure_login': {const p=z.object({site:z.string().url(),purpose:z.enum(['login','create','reset'])}).strict().parse(input),site=(await import('./browser-policy.mjs')).validateBrowserURL(p.site).origin;return {kind:'secure_login_request',site,purpose:p.purpose,openIn:'settings.permissions',notice:'Use the protected form. No secret may be sent to the conversation. This does not authorize account creation, reset submission or any external write.'};}
        case 'analyze_data': return (await import('./data-analysis')).analyzeData(budget.who,input);
        case 'get_analysis_result': return (await import('./data-analysis')).getAnalysisResult(budget.who,input);
        case 'save_source_project': return (await import('./source-projects')).saveSourceProject(budget.who,input);
        case 'get_source_project': return (await import('./source-projects')).getSourceProject(budget.who,input);
        case 'prepare_routine': return (await import('./routines')).prepareRoutine(budget.who,input);
        case 'get_routine': return (await import('./routines')).getRoutine(scope.tenant,parseId());
        case 'export_deliverable': return (await import('./document-delivery')).exportDeliverable(budget.who,input);
        case 'create_office_document': return (await import('./office-document-delivery')).createOfficeDocument(budget.who,input);
        case 'get_company_profile': {z.object({}).strict().parse(input);return (await import('./company-profile')).getCompanyProfile(budget.who);}
        case 'save_company_profile': return (await import('./company-profile')).saveCompanyProfile(budget.who,input);
        case 'render_visual': return (await import('./visual-delivery')).renderVisual(budget.who,input);
        case 'capabilities': return (await import('./capabilities')).workspaceCapabilities(budget.who);
        case 'prepare_brief': return (await import('./brief')).prepareBrief(budget.who, input);
        case 'prepare_work': {const parsed=z.object({id:z.string().max(160).optional(),version:z.number().int().positive().optional()}).passthrough().parse(input),{id,version,...mandate}=parsed;if(id||version){if(!id||!version)throw new AppError('Identifiant et version du brouillon requis.');return (await import('./work')).reviseWork(budget.who,id,version,mandate);}const work=await import('./work'),prepared=await work.prepareWork(budget.who,scope.conversationId,mandate);
            // Braand launches its own background work: no click needed up to the
            // auto-launch ceiling. Larger budgets still wait for the user's go.
            // Public or irreversible actions inside the work keep their own approval.
            if(prepared.work.maxCredits<=AUTO_LAUNCH_MAX_CREDITS){try{const started=await work.commandWork(budget.who,prepared.id,{action:'activate',version:prepared.work.version,commandId:crypto.randomUUID(),approved:true});return {...prepared,work:started,autoLaunched:true};}catch(error){return {...prepared,autoLaunched:false,launchError:error instanceof AppError?error.message:'Lancement automatique impossible : l’utilisateur peut la lancer depuis la carte.'};}}
            return {...prepared,autoLaunched:false,notice:'Budget supérieur à '+AUTO_LAUNCH_MAX_CREDITS+' crédits : l’utilisateur lance la tâche depuis la carte.'};}
        case 'get_work': return (await import('./work')).getWork(scope.tenant, parseId());
        case 'research_web': return (await import('./research')).researchWeb(scope, budget, input);
        case 'read_web_source': return (await import('./research')).readWebSource(scope, budget, input);
        case 'social_accounts': return (await import('./social')).socialAccounts(scope.tenant);
        case 'prepare_publications': {
            const result = await (await import('./social')).createSocialBatch(budget.who, input);
            return (await import('./server')).getClientResource(scope.tenant, result.id);
        }
        case 'get_publications': {
            const { id } = z.object({ id: z.string().max(160).optional() }).strict().parse(input);
            return id ? (await import('./social')).getSocialBatch(scope.tenant, id) : (await import('./social')).listSocialBatches(scope.tenant);
        }
        case 'prepare_social_reply': return (await import('./social')).prepareReply(budget.who, input);
        case 'browser_capabilities': return (await import('./browser')).browserReadiness();
        case 'browser_session_result': {
            const id = parseId();
            return { session: await browserService.get(budget.who, id), artifacts: await browserService.artifacts(budget.who, id) };
        }
        case 'inspect_media': return (await import('./media-assets')).inspectMedia(budget, input);
        case 'assemble_media': return (await import('./media-render')).prepareAssembly(budget.who, input);
        case 'prepare_video_edit': return (await import('./media-render')).prepareVideoEdit(budget.who, input);
        case 'get_video_edit_result': return (await import('./media-render')).videoEditResult(budget.who, input);
        default: throw new AppError('Outil indisponible.', 403);
    }
}
export async function trackArtifact(...args: Parameters<typeof import('./work')['trackWorkArtifact']>) { return (await import('./work')).trackWorkArtifact(...args); }
