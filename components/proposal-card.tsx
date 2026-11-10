"use client";
// Inline approval of a media proposal inside the conversation: one clear
// "Générer" button, then live progress and the result right in the chat.
import {useRef,useState} from "react";
import {ArrowUpRight, Sparkles} from "lucide-react";
import {api,post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import {MediaGenerationPreview} from "@/components/media-generation-preview";
import {MediaPlanView} from "@/components/media-plan-view";
import {ApprovalCard} from './approval-card';
import "./proposal-card.css";

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function outputURLs(output:unknown):string[]{const found:string[]=[];const visit=(value:unknown,depth:number)=>{if(depth>4||!value||typeof value!=="object")return;if(Array.isArray(value)){value.slice(0,6).forEach(item=>visit(item,depth+1));return;}const r=value as Record<string,unknown>;if(typeof r.url==="string"&&r.url.startsWith("https://"))found.push(r.url);for(const key of ["images","image","video","audio","output"])if(key in r)visit(r[key],depth+1);};visit(output,0);return [...new Set(found)];}
const mediaKind=(data:Record<string,unknown>)=>{const payload=record(data.payload),task=String(payload.task||""),model=String(payload.model||"");return task.startsWith("video")||/video/.test(model)?"video":task.startsWith("audio")||/tts|speech/.test(model)?"audio":"image";};
const KIND_LABEL:Record<string,string>={image:"Image",video:"Vidéo",audio:"Voix"};

export function ProposalCard({proposal,onOpen,onChange}:{proposal:Resource;onOpen:(target?:Resource)=>void;onChange?:()=>void}){
 const starting=useRef(false);
 const [current,setCurrent]=useState(proposal),[busy,setBusy]=useState(false),[error,setError]=useState(""),[media,setMedia]=useState<Resource|null>(null);
 const data=record(current.data),credits=Number(data.maxCredits||0),kind=mediaKind(data);
 // A ref, not the state: two clicks in the same instant must start one paid generation.
 const approve=async()=>{if(busy||starting.current)return;starting.current=true;setBusy(true);setError("");try{await api("/api/proposals/"+encodeURIComponent(current.id),post({version:current.version}));setCurrent(await api<Resource>("/api/resources/"+encodeURIComponent(current.id)));onChange?.();}catch(e){setError(e instanceof Error?e.message:"La génération n’a pas pu démarrer. Réessayez.");}finally{starting.current=false;setBusy(false);}};
 if(data.kind==="media_plan")return current.status==='awaiting_approval'?<MediaPlanView key={current.id+':'+current.version} proposal={current} onApprove={()=>void approve()} busy={busy} approvalError={error}/>:<div className="proposal-card proposal-card-plan"><MediaPlanView key={current.id+":"+current.version} proposal={current} onApprove={()=>void approve()} busy={busy}/>{error&&<p className="proposal-card-error" role="alert">{error}</p>}</div>;
 const prompt=String(record(record(data.payload).input).prompt||"");
 if(media){const urls=outputURLs(record(media.data).output);return <div className="proposal-card proposal-card-result">{urls.length?urls.slice(0,4).map((url,index)=>kind==="video"?<video key={url} className="proposal-card-media" src={url} controls playsInline preload="metadata" aria-label={current.title}/>:kind==="audio"?<audio key={url} src={url} controls aria-label={current.title}/>:
  // eslint-disable-next-line @next/next/no-img-element
  <img key={url} className="proposal-card-media" src={url} alt={current.title+" "+(index+1)} onError={event=>{const image=event.currentTarget,attempt=Number(image.dataset.retry||0);if(attempt<2){image.dataset.retry=String(attempt+1);setTimeout(()=>{image.src=url+(url.includes("?")?"&":"?")+"retry="+(attempt+1);},400*(attempt+1));}}}/>):<p className="proposal-card-note">Création prête dans votre bibliothèque.</p>}<button type="button" className="proposal-card-link" onClick={()=>onOpen(media)}>Ouvrir dans la bibliothèque<ArrowUpRight size={14} aria-hidden="true"/></button></div>;}
 if(current.status==="awaiting_approval")return <ApprovalCard icon={<Sparkles size={16}/>} title={'Autoriser la génération « '+current.title+' » ?'} compactTitle={KIND_LABEL[kind]+' · '+current.title}
  fields={[{label:'Type',value:KIND_LABEL[kind]},{label:'Plafond',value:credits+' crédit'+(credits>1?'s':'')+' maximum'}]} content={prompt?{label:'Consigne exacte',text:prompt}:undefined}
  busy={busy?'approve':null} error={error} approveLabel="Générer" busyLabel="Lancement…" onApprove={()=>void approve()}>
  <button type="button" className="proposal-card-link" onClick={()=>onOpen(current)}>Ouvrir dans l’Atelier<ArrowUpRight size={14} aria-hidden="true"/></button>
 </ApprovalCard>;
 if(["generating","completed","uncertain"].includes(current.status))return <div className="proposal-card"><MediaGenerationPreview proposal={current} kind={kind} onReady={resource=>{setMedia(resource);onChange?.();}}/></div>;
 return <div className="proposal-card"><p className="proposal-card-note">Cette proposition n’est plus disponible ({current.status}).</p><button type="button" className="proposal-card-link" onClick={()=>onOpen(current)}>Voir le détail<ArrowUpRight size={14} aria-hidden="true"/></button></div>;
}
