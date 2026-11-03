// Read-only overviews so the agent can answer "what is running / planned /
// performing?" directly in the conversation. Every function is tenant-scoped,
// returns bounded summaries (never secrets or tokens) and names the view the
// user can open for full detail. No function changes state.
import {z} from 'zod';
import {list} from './server';
import {resourceProject} from './project-context';
import {listRoutines} from './routines';
import {listWork} from './work';
import {socialPostList,listSocialBatches,socialInsights,listComments} from './social';

export const OVERVIEW_VIEWS=['campaigns','publications','calendar','activity','analytics','library','creations','pages','files','projects'] as const;
export type OverviewView=typeof OVERVIEW_VIEWS[number];
const DAY=86400000;
const clip=(value:unknown,max=240)=>typeof value==='string'?value.slice(0,max):undefined;
const settle=async<T>(promise:Promise<T>):Promise<{ok:true;value:T}|{ok:false;reason:string}>=>{try{return {ok:true,value:await promise};}catch(error){return {ok:false,reason:error instanceof Error&&error.message?error.message.slice(0,200):'Lecture indisponible.'};}};

export async function listCampaigns(tenant:string,input:unknown,projectId:string|null){
 const p=z.object({status:z.enum(['all','active','draft']).default('all'),allProjects:z.boolean().default(false)}).strict().parse(input??{});
 const items=(await list(tenant,'campaign')).filter(r=>r.status!=='deleted'&&(p.allProjects||resourceProject(r.data as Record<string,unknown>)===projectId)).filter(r=>p.status==='all'||(p.status==='draft'?r.status==='draft':r.status!=='draft'));
 return {
  scope:p.allProjects?'workspace':projectId?'project':'workspace_without_project',
  count:items.length,
  items:items.slice(0,30).map(resource=>({r:resource,d:resource.data as Record<string,unknown>})).map(({r,d})=>({id:r.id,title:r.title,status:r.status,version:r.version,objective:clip(d.objective,40),country:clip(d.country,80),currency:clip(d.currency,10),dailyBudget:typeof d.dailyBudget==='number'?d.dailyBudget:undefined,destination:clip(d.destination,300),projectId:resourceProject(d),updatedAt:r.updated_at})),
  note:'Un plan enregistré par Braand est un brouillon privé : il ne prouve pas qu’une publicité est diffusée. Les campagnes publicitaires réelles se vérifient dans le compte connecté.',
  openView:'campaigns' as OverviewView,
 };
}

export async function listPublications(tenant:string,input:unknown,now=Date.now()){
 const p=z.object({period:z.enum(['today','this_week','next_7_days','last_7_days','this_month']).default('next_7_days'),includeComments:z.boolean().default(false)}).strict().parse(input??{});
 const start=new Date(now);start.setUTCHours(0,0,0,0);
 let from=start.getTime(),to=from+7*DAY;
 if(p.period==='today')to=from+DAY;
 else if(p.period==='this_week'){const day=(start.getUTCDay()+6)%7;from=start.getTime()-day*DAY;to=from+7*DAY;}
 else if(p.period==='last_7_days'){to=from+DAY;from=to-7*DAY;}
 else if(p.period==='this_month'){const month=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));from=month.getTime();to=Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1);}
 const posts=await settle(socialPostList(tenant,new URLSearchParams({start:String(from),end:String(to)})));
 const batches=await settle(listSocialBatches(tenant));
 const comments=p.includeComments?await settle(listComments(tenant)):undefined;
 const postItems=posts.ok?(posts.value.items as Record<string,unknown>[]).sort((a,b)=>Number(a.scheduledAt||0)-Number(b.scheduledAt||0)).slice(0,40).map(post=>({id:post.id,batchTitle:clip(post.batchTitle,160),network:post.network,account:clip(post.accountLabel,120),scheduledAt:post.scheduledAt,status:post.status,format:post.format,text:clip(post.text,280)})):[];
 const pending=batches.ok?(batches.value.items as Record<string,unknown>[]).filter(batch=>['draft','awaiting_approval'].includes(String(batch.status))).slice(0,10).map(batch=>({id:batch.id,title:clip(batch.title,160),status:batch.status})):[];
 return {
  period:{name:p.period,from,to,timezone:'UTC'},
  posts:postItems,
  postsAvailable:posts.ok,...(posts.ok?{}:{postsUnavailableReason:posts.reason}),
  batchesAwaitingDecision:pending,
  ...(comments?{comments:comments.ok?(comments.value.comments as Record<string,unknown>[]).slice(0,20).map(c=>({id:c.id,network:c.network,account:clip(c.accountLabel,120),author:clip(c.author,120),text:clip(c.text,280),status:c.status,syncedAt:c.syncedAt})):[],...(comments.ok?{}:{commentsUnavailableReason:comments.reason})}:{}),
  note:'Une publication programmée ou publiée exige toujours une approbation explicite. Les dates sont en UTC.',
  openView:'calendar' as OverviewView,
 };
}

export async function listActivity(tenant:string,input:unknown){
 const p=z.object({filter:z.enum(['all','running','needs_attention','recurring']).default('all')}).strict().parse(input??{});
 const work=p.filter==='recurring'?undefined:await settle(listWork(tenant));
 const routines=await settle(listRoutines(tenant));
 const missions=p.filter==='recurring'?[]:(await list(tenant,'mission')).filter(r=>r.status!=='deleted');
 const attention=new Set(['waiting_input','waiting_approval','waiting_external','needs_reconciliation','failed','partial','paused','blocked','draft']);
 const running=new Set(['running','active','queued']);
 const keep=(status:unknown)=>p.filter==='all'||p.filter==='recurring'||(p.filter==='running'?running.has(String(status)):attention.has(String(status)));
 const works=work?.ok?(work.value.items as unknown as Record<string,unknown>[]).filter(w=>keep(w.status)).slice(0,20).map(w=>({id:w.id,type:'work',objective:clip(w.objective,200),status:w.status,updatedAt:w.updatedAt,spentCredits:w.spentCredits,maxCredits:w.maxCredits})):[];
 const recurring=routines.ok?(routines.value.items as unknown as Record<string,unknown>[]).filter(r=>keep(r.status)).slice(0,20).map(r=>({id:r.id,type:'routine',title:clip(r.title,160),status:r.status,nextAt:r.nextAt,intervalHours:r.intervalHours,expiresAt:r.expiresAt,spentCredits:r.spentCredits,maxCredits:r.maxCredits})):[];
 const plans=missions.filter(m=>keep(m.status)).slice(0,20).map(m=>({id:m.id,type:'mission',title:m.title,status:m.status,updatedAt:m.updated_at}));
 return {
  filter:p.filter,
  works,routines:recurring,missions:plans,
  needsAttention:[...works,...recurring,...plans].filter(item=>attention.has(String(item.status))).length,
  ...(work&&!work.ok?{worksUnavailableReason:work.reason}:{}),
  ...(!routines.ok?{routinesUnavailableReason:routines.reason}:{}),
  note:'Mettre en pause, reprendre ou approuver passe par les contrôles existants et une confirmation explicite.',
  openView:'activity' as OverviewView,
 };
}

export async function performanceSummary(tenant:string,input:unknown,now=Date.now()){
 const p=z.object({days:z.number().int().min(1).max(90).default(28)}).strict().parse(input??{});
 const since=now-p.days*DAY;
 const insights=await settle(socialInsights(tenant));
 const rows=insights.ok?(insights.value.items as {accountLabel:string;network:string;periodStart:number;periodEnd:number;metrics:Record<string,unknown>;source:string;fetchedAt:number}[]).filter(row=>row.periodEnd>=since):[];
 const totals:Record<string,Record<string,number>>={};
 for(const row of rows){const key=row.network+' · '+row.accountLabel;totals[key]??={};for(const [metric,value] of Object.entries(row.metrics||{}))if(typeof value==='number'&&Number.isFinite(value))totals[key][metric]=(totals[key][metric]||0)+value;}
 const campaigns=(await list(tenant,'campaign')).filter(r=>r.status!=='deleted').length;
 return {
  period:{days:p.days,from:since,to:now},
  organic:{available:insights.ok&&rows.length>0,accounts:Object.entries(totals).map(([account,metrics])=>({account,metrics})),rows:rows.length,lastFetchedAt:rows.reduce((max,row)=>Math.max(max,row.fetchedAt||0),0)||null,...(insights.ok?{}:{unavailableReason:insights.reason})},
  campaignsSaved:campaigns,
  paidAds:{available:false,reason:'Les résultats publicitaires se lisent avec read_meta ou les outils du compte connecté ; ils ne sont pas inclus ici.'},
  note:'Ne complète jamais une donnée manquante. Les interactions organiques ne prouvent pas des ventes.',
  openView:'analytics' as OverviewView,
 };
}
