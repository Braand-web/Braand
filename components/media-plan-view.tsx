"use client";
// Approval and live progress of a fal.ai media plan: one approval, one budget,
// steps running in parallel, reviewed and retried automatically.
import {useEffect,useState} from "react";
import {CheckCircle2,CircleAlert,LoaderCircle,RotateCcw,Sparkles} from "lucide-react";
import {api} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import "./media-plan-view.css";

type StepState={id:string;label:string;task:string;model?:string;status:"pending"|"running"|"done"|"failed";attempts:number;outputs:string[];mediaId?:string;review?:{pass:boolean;issues:string[]};notes:string[]};
type PlanState={id:string;status:string;budget:number;expected:number;spent:number;reason?:string;steps:StepState[]};
type PlanStep={id:string;label:string;task:string;review?:string[];references?:unknown[]};
type Payload={steps:PlanStep[];quotes:{stepId:string;model:string;credits:number}[];expectedCredits:number};

const TASK_LABELS:Record<string,string>={image:"Image",image_edit:"Retouche",image_precision:"Image précise",image_edit_precision:"Retouche précise",video_short:"Vidéo courte",video_narrative:"Vidéo narrative",video_reference:"Vidéo avec référence",video_from_image:"Image animée",video_ugc:"Vidéo UGC",audio_speech:"Voix",image_upscale:"Agrandissement",image_background_removal:"Détourage",video_upscale:"Vidéo HD"};
const isVideo=(url:string)=>/\.(mp4|webm|mov)(\?|$)/i.test(url),isAudio=(url:string)=>/\.(mp3|wav|m4a|ogg)(\?|$)/i.test(url);

function Output({url,label}:{url:string;label:string}){
 if(isVideo(url))return <video className="plan-output" src={url} controls playsInline preload="metadata" aria-label={label}/>;
 if(isAudio(url))return <audio src={url} controls aria-label={label}/>;
 // eslint-disable-next-line @next/next/no-img-element
 return <img className="plan-output" src={url} alt={label} loading="lazy"/>;
}

export function MediaPlanView({proposal,onApprove,busy}:{proposal:Resource;onApprove:()=>void;busy:boolean}){
 const data=proposal.data as {rationale?:string;maxCredits:number;payload:Payload};
 const [state,setState]=useState<PlanState|null>(null),[error,setError]=useState("");
 const awaiting=proposal.status==="awaiting_approval";
 useEffect(()=>{
  if(awaiting)return;let active=true,timer:ReturnType<typeof setTimeout>|undefined;
  const tick=async()=>{try{const next=await api<PlanState>("/api/proposals/"+encodeURIComponent(proposal.id));if(!active)return;setState(next);setError("");if(next.status==="generating")timer=setTimeout(tick,4000);}catch(e){if(active){setError(e instanceof Error?e.message:"Suivi indisponible.");timer=setTimeout(tick,10000);}}};
  void tick();return ()=>{active=false;if(timer)clearTimeout(timer);};
 },[awaiting,proposal.id]);

 if(awaiting){
  const quotes=new Map(data.payload.quotes.map(q=>[q.stepId,q.credits]));
  return <div className="resource-detail media-plan">
   {data.rationale&&<p>{data.rationale}</p>}
   <div className="approval-budget"><span>Budget total</span><strong>{data.maxCredits} crédits</strong></div>
   <p className="muted small-text">Coût prévu {data.payload.expectedCredits} crédits. La marge sert aux corrections automatiques ; seuls les crédits utilisés sont débités.</p>
   <ol className="plan-steps">{data.payload.steps.map(step=><li key={step.id} className="plan-step"><span className="plan-step-icon" aria-hidden="true"><Sparkles size={15}/></span><div><strong>{step.label}</strong><small>{TASK_LABELS[step.task]||step.task} · {quotes.get(step.id)} crédits{step.review?.length?" · contrôle visuel":""}</small></div></li>)}</ol>
   <button className="button primary full-width" onClick={onApprove} disabled={busy}><CheckCircle2 size={16}/>{busy?"Validation en cours…":`Approuver ${data.payload.steps.length} création${data.payload.steps.length>1?"s":""}`}</button>
   <p className="fine-print">Une seule approbation pour tout le plan. Braand s’arrête avant de dépasser {data.maxCredits} crédits.</p>
  </div>;
 }
 const done=state?.steps.filter(step=>step.status==="done").length??0,total=data.payload.steps.length;
 const spentRatio=state?Math.min(100,Math.round(state.spent/Math.max(1,state.budget)*100)):0;
 return <div className="resource-detail media-plan" aria-busy={state?.status==="generating"||undefined}>
  <div className="plan-progress"><div><strong>{state?.status==="generating"?"Création en cours":state?.status==="completed"?"Plan terminé":state?.status==="stopped"?"Plan arrêté":"Suivi du plan"}</strong><small>{done}/{total} créations · {state?.spent??0}/{data.maxCredits} crédits utilisés</small></div><div className="plan-meter" role="progressbar" aria-label="Budget utilisé" aria-valuemin={0} aria-valuemax={100} aria-valuenow={spentRatio}><span style={{width:spentRatio+"%"}}/></div></div>
  {state?.reason&&<p className="plan-reason" role="status"><CircleAlert size={15} aria-hidden="true"/>{state.reason}</p>}
  {error&&<p className="plan-reason" role="alert">{error}</p>}
  <ol className="plan-steps">{(state?.steps||data.payload.steps.map((step):StepState=>({id:step.id,label:step.label,task:step.task,status:"pending",attempts:0,outputs:[],notes:[]}))).map(step=><li key={step.id} className="plan-step" data-status={step.status}>
   <span className="plan-step-icon" aria-hidden="true">{step.status==="done"?<CheckCircle2 size={15}/>:step.status==="failed"?<CircleAlert size={15}/>:step.status==="running"?<LoaderCircle size={15} className="spin"/>:<Sparkles size={15}/>}</span>
   <div className="plan-step-body"><strong>{step.label}</strong><small>{TASK_LABELS[step.task]||step.task}{step.attempts>1?<> · <RotateCcw size={11} aria-hidden="true"/> {step.attempts} essais</>:null}{step.review?` · ${step.review.pass?"contrôle réussi":"corrigé après contrôle"}`:""}</small>
    {step.status==="running"&&!step.outputs.length&&<span className="ds-skeleton plan-output-skeleton" aria-hidden="true"/>}
    {step.outputs.length>0&&<div className="plan-outputs">{step.outputs.slice(0,4).map((url,index)=><Output key={url} url={url} label={step.label+" "+(index+1)}/>)}</div>}
    {step.status==="failed"&&step.notes.length>0&&<small className="plan-note">{step.notes.at(-1)}</small>}
   </div></li>)}</ol>
  {state?.status==="completed"&&<p className="fine-print">Les fichiers sont enregistrés dans votre bibliothèque.</p>}
 </div>;
}
