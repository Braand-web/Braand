"use client";
// « Compétence apprise » : a method the user just taught Braand, with what it
// is for, who can see it, and simple controls (share, deactivate, undo).
import {useState} from "react";
import {GraduationCap,Users,User,Undo2,Power} from "lucide-react";
import {api} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import "./proposal-card.css";

export const isTaughtSkill=(resource:Resource)=>resource.kind==="skill"&&resource.data?.origin==="taught";

export function SkillCard({skill,onOpen,onAsk}:{skill:Resource;onOpen:()=>void;onAsk:(text:string)=>void}){
 const [current,setCurrent]=useState(skill),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const data=current.data as Record<string,unknown>,steps=Array.isArray(data.steps)?data.steps.length:0,team=data.visibility==="team",active=current.status!=="disabled";
 const history=Array.isArray(data.history)?data.history.length:0,missing=Array.isArray(data.toComplete)?data.toComplete.length:0;
 const act=async(action:string)=>{setBusy(true);setError("");try{setCurrent(await api<Resource>("/api/workspace-skills",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:current.id,version:current.version,action})}));}catch(e){setError(e instanceof Error?e.message:"Action impossible.");}finally{setBusy(false);}};
 return <div className="proposal-card" role="group" aria-label={"Compétence : "+current.title}>
  <div className="proposal-card-head"><span className="proposal-card-icon"><GraduationCap size={17}/></span><div><strong>{current.title}</strong><small>{active?"Compétence apprise":"Compétence désactivée"} · {steps} étape{steps>1?"s":""} · Visible par : {team?"votre équipe":"vous"}</small></div></div>
  {typeof data.whenToUse==="string"?<p className="proposal-card-prompt">Braand l’utilisera quand : {data.whenToUse}</p>:null}
  {missing?<p className="proposal-card-note">{missing} point{missing>1?"s":""} à préciser : Braand vous les demandera au moment de l’utiliser.</p>:null}
  <div className="proposal-card-actions">
   <button type="button" className="button small secondary" onClick={onOpen}>Voir</button>
   <button type="button" className="button small secondary" onClick={()=>onAsk(`Je veux modifier ma méthode « ${current.title} » : `)}>Modifier</button>
   <button type="button" className="button small secondary" disabled={busy} onClick={()=>void act(team?"personal":"share")}>{team?<User size={15}/>:<Users size={15}/>}{team?"Rendre personnelle":"Partager avec l’équipe"}</button>
   <button type="button" className="button small secondary" disabled={busy} onClick={()=>void act(active?"deactivate":"activate")}><Power size={15}/>{active?"Désactiver":"Réactiver"}</button>
   {history?<button type="button" className="proposal-card-link" disabled={busy} onClick={()=>void act("restore")}><Undo2 size={14}/>Revenir à la version précédente</button>:null}
  </div>
  {error?<p className="proposal-card-error" role="alert">{error}</p>:null}
 </div>;
}
