"use client";
// Background work inside the conversation: one "Lancer en arrière-plan"
// button, then live progress while the person keeps chatting.
import {useEffect,useState} from "react";
import {CheckCircle2,CircleAlert,Clock3,LoaderCircle,Pause,Play} from "lucide-react";
import {api,post} from "@/lib/client-api";
import {WORK_LABELS,type WorkDTO} from "@/lib/platform-contracts";
import "./proposal-card.css";
import "./media-plan-view.css";

const ACTIVE=new Set(["running","waiting_external","needs_reconciliation"]);
const stepIcon=(status:string)=>status==="completed"?<CheckCircle2 size={15}/>:["failed","cancelled"].includes(status)?<CircleAlert size={15}/>:status==="running"?<LoaderCircle size={15} className="spin"/>:<Clock3 size={15}/>;
const stepState=(status:string)=>status==="completed"?"done":["failed","cancelled"].includes(status)?"failed":status==="running"?"running":"pending";

export function WorkCard({workId,onOpen}:{workId:string;onOpen:()=>void}){
 const [work,setWork]=useState<WorkDTO|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>|undefined;
  const tick=async()=>{try{const next=await api<WorkDTO>("/api/work/"+encodeURIComponent(workId));if(!active)return;setWork(next);if(ACTIVE.has(next.status))timer=setTimeout(tick,5000);}catch(e){if(active)setError(e instanceof Error?e.message:"Suivi indisponible.");}};
  void tick();return()=>{active=false;if(timer)clearTimeout(timer);};
 },[workId,busy]);
 const command=async(action:"activate"|"pause"|"resume"|"cancel")=>{if(!work||busy)return;setBusy(true);setError("");try{setWork(await api<WorkDTO>("/api/work/"+encodeURIComponent(work.id)+"/"+(action==="activate"?"decisions":"commands"),post({action,version:work.version,commandId:crypto.randomUUID(),...(action==="activate"?{approved:true}:{})})));}catch(e){setError(e instanceof Error?e.message:"L’action n’a pas pu être prise en compte.");}finally{setBusy(false);}};
 if(!work)return <div className="proposal-card"><span className="ds-skeleton ds-skeleton-text" style={{width:"60%"}}/><span className="ds-skeleton ds-skeleton-text" style={{width:"40%"}}/></div>;
 const done=work.steps.filter(step=>step.status==="completed").length,ratio=Math.round(done/Math.max(1,work.steps.length)*100);
 return <div className="proposal-card media-plan" aria-busy={ACTIVE.has(work.status)||undefined}>
  <div className="proposal-card-head"><span className="proposal-card-icon" aria-hidden="true">{work.status==="draft"?<Play size={16}/>:stepIcon(work.status==="completed"?"completed":ACTIVE.has(work.status)?"running":work.status)}</span><div><strong>{work.objective.length>120?work.objective.slice(0,120)+"…":work.objective}</strong><small>{work.status==="draft"?`Tâche de fond · ${work.steps.length} étape${work.steps.length>1?"s":""} · ${work.maxCredits} crédits au maximum`:`${WORK_LABELS[work.status]} · ${done}/${work.steps.length} étapes · ${work.spentCredits} crédit${work.spentCredits>1?"s":""} utilisé${work.spentCredits>1?"s":""}`}</small></div></div>
  {work.status!=="draft"&&<div className="plan-meter" role="progressbar" aria-label="Avancement" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio}><span style={{width:ratio+"%"}}/></div>}
  <ol className="plan-steps">{work.steps.slice(0,8).map(step=><li key={step.id} className="plan-step" data-status={stepState(step.status)}><span className="plan-step-icon" aria-hidden="true">{stepIcon(step.status)}</span><div><strong>{step.title}</strong></div></li>)}</ol>
  {work.artifacts.length>0&&<div className="proposal-card-note">Résultats : {work.artifacts.slice(0,4).map(item=>item.title).join(" · ")}</div>}
  {error&&<p className="proposal-card-error" role="alert">{error}</p>}
  <div className="proposal-card-actions">
   {work.status==="draft"&&<button type="button" className="ds-btn ds-btn-primary" onClick={()=>void command("activate")} disabled={busy}>{busy?<span className="ds-spinner" aria-hidden="true"/>:<Play size={15} aria-hidden="true"/>}{busy?"Lancement…":`Lancer en arrière-plan · ${work.maxCredits} crédits max`}</button>}
   {work.status==="running"&&<button type="button" className="ds-btn ds-btn-secondary" onClick={()=>void command("pause")} disabled={busy}><Pause size={15} aria-hidden="true"/>Mettre en pause</button>}
   {work.status==="paused"&&<button type="button" className="ds-btn ds-btn-primary" onClick={()=>void command("resume")} disabled={busy}><Play size={15} aria-hidden="true"/>Reprendre</button>}
   <button type="button" className="ds-btn ds-btn-ghost" onClick={onOpen}>Suivre dans Activité</button>
  </div>
  {work.status==="draft"&&<p className="fine-print">Braand travaille seul pendant que vous continuez à discuter, et vous prévient à la fin. Seuls les crédits utilisés sont débités.</p>}
 </div>;
}
