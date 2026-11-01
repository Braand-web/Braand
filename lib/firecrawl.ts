import {z} from 'zod';
import {config,db} from './server';
import {AppError} from './core.mjs';
import {webProviderSettings,firecrawlConfigured} from './web-providers';
import {claimToolUsage,confirmToolUsage,rejectToolUsage,unknownToolUsage} from './tool-usage';
import type {RunBudget} from './metering';
const base='https://api.firecrawl.dev/v2';
export function firecrawlReadiness(){const c=config(),ready=c.RESEARCH_ENABLED==='true'&&firecrawlConfigured(c);return {ready,reason:ready?null:c.RESEARCH_ENABLED!=='true'?'activation_pending':'configuration_pending',canReadPages:ready};}
async function read(response:Response,max=1048576){const reader=response.body?.getReader();if(!reader)throw new AppError('Résultat web vide.',502);let bytes=0,text='';const decoder=new TextDecoder();try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>max)throw new AppError('Résultat web trop volumineux.',413);text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode()) as Record<string,unknown>;}finally{await reader.cancel().catch(()=>{});}}
async function request(budget:RunBudget,operation:'search'|'extract',payload:unknown){
 const p=webProviderSettings(config()).firecrawl;if(!firecrawlReadiness().ready||!p?.enabled||!p.verified)throw new AppError('La lecture web attend sa configuration.',503,'research_unavailable');
 const credits=operation==='search'?2:1;
 // Reserve a conservative lifetime/team allowance. Unknown provider outcomes keep
 // their reservation; cache hits never allocate another call.
 let quota:Record<string,unknown>;try{const r=await fetch(base+'/team/credit-usage',{headers:{authorization:'Bearer '+p.apiKey},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error();const body=await read(r,32768);quota=z.object({remainingCredits:z.number().nonnegative(),planCredits:z.number().nonnegative().max(1000),billingPeriodStart:z.string().datetime()}).parse(body.data);}catch{throw new AppError('Le quota gratuit du fournisseur web ne peut pas être vérifié.',503,'research_quota_unverified');}
 if(Number(quota.remainingCredits)<credits)throw new AppError('Le quota gratuit du fournisseur web est épuisé.',429,'research_quota');
 const period=Date.parse(String(quota.billingPeriodStart));if(!Number.isFinite(period)||period>Date.now())throw new AppError('Période du fournisseur non vérifiée.',503,'research_quota_unverified');
 const usageId=await claimToolUsage(budget,'firecrawl','research_'+operation,0,{mode:'free_only',providerCredits:credits,source:'https://www.firecrawl.dev/pricing'});
 const reserved=await db().prepare("SELECT COALESCE(SUM(CASE WHEN operation='research_search' THEN 2 ELSE 1 END),0) n FROM agent_tool_usage WHERE provider='firecrawl' AND status!='rejected' AND created_at>=?").bind(period).first<{n:number}>();
 if(Number(reserved?.n||0)>p.maxCredits){await rejectToolUsage(usageId);throw new AppError('Le quota de lecture web est réservé par un autre travail.',429,'research_quota');}
 let response:Response;
 try{response=await fetch(base+(operation==='search'?'/search':'/scrape'),{method:'POST',headers:{authorization:'Bearer '+p.apiKey,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});}catch{await unknownToolUsage(usageId);throw new AppError('La lecture web a été interrompue. Vérifiez son état avant une nouvelle tentative.',502,'tool_usage_unknown');}
 if(!response.ok){if(response.status>=500||response.status===408)await unknownToolUsage(usageId);else await rejectToolUsage(usageId);throw new AppError(response.status===402||response.status===429?'Le quota du fournisseur web est atteint.':'La lecture web est temporairement indisponible.',502,'research_unavailable');}
 try{const body=await read(response);if(body.success!==true)throw new Error();await confirmToolUsage(usageId,0,typeof body.id==='string'?body.id:undefined);return body;}catch{await unknownToolUsage(usageId);throw new AppError('Le résultat de la lecture web ne peut pas être confirmé.',502,'tool_usage_unknown');}
}
export async function firecrawlSearch(budget:RunBudget,query:string,domains:string[]){
 const body=await request(budget,'search',{query,...(domains.length?{includeDomains:domains}:{}),limit:5,sources:['web'],timeout:15000});
 const value=z.object({web:z.array(z.object({url:z.string(),title:z.string(),description:z.string().default('')})).max(5)}).parse(body.data);
 return {sources:value.web.map(row=>({url:row.url,title:row.title,content:row.description})),provider:'firecrawl'};
}
export async function firecrawlRead(budget:RunBudget,url:string){
 const body=await request(budget,'extract',{url,formats:['markdown'],onlyMainContent:true,parsers:[],proxy:'auto',timeout:20000,maxAge:0,storeInCache:false});
 const item=z.object({markdown:z.string().max(1000000),metadata:z.object({sourceURL:z.string().optional(),url:z.string().optional(),title:z.string().optional(),statusCode:z.number().optional()}).passthrough()}).parse(body.data);
 if(item.metadata.statusCode&&item.metadata.statusCode>=400)throw new AppError('La page demandée ne fournit pas de contenu exploitable.',502,'research_source_unavailable');
 return {url:item.metadata.url||item.metadata.sourceURL||url,title:item.metadata.title||new URL(url).hostname,content:item.markdown};
}
