"use client";
// A browser session in the conversation: the mission, one clear status, the
// step in progress and the latest real picture of the page. Opens the panel.
import {useEffect,useState} from "react";
import {Globe2} from "lucide-react";
import type {BrowserSessionDTO} from "@/lib/browser-contracts";
import {currentStep,sessionState} from "@/lib/browser-state.mjs";
import {lastBrowserFrames} from "./browser-live-view";
import {BrowserActionApproval} from "./approval-card";
import "./browser-session-card.css";

export function BrowserSessionCard({sessionId,onOpen}:{sessionId:string;onOpen:()=>void}){
 const [session,setSession]=useState<BrowserSessionDTO|null>(null),[reload,setReload]=useState(0),[thumb,setThumb]=useState<string|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let stop=false,timer:ReturnType<typeof setTimeout>|undefined;
  const load=async()=>{
   try{
    const response=await fetch("/api/browser/sessions/"+encodeURIComponent(sessionId),{credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw new Error();
    const next=await response.json() as BrowserSessionDTO;if(stop)return;
    setSession(next);setFailed(false);
    // The live panel keeps the freshest picture; otherwise the session's own capture.
    const frame=lastBrowserFrames.get(sessionId)?.src||(next.captureId?"/api/browser/sessions/"+encodeURIComponent(sessionId)+"/artifacts/"+encodeURIComponent(next.captureId)+"/download":null);
    if(frame)setThumb(frame);
    if(!sessionState(next).terminal&&document.visibilityState!=="hidden")timer=setTimeout(()=>void load(),3000);
    else if(!sessionState(next).terminal)timer=setTimeout(()=>void load(),10000);
   }catch{if(!stop){setFailed(true);timer=setTimeout(()=>void load(),10000);}}
  };
  void load();
  return()=>{stop=true;clearTimeout(timer);};
 },[sessionId,reload]);
 const state=session?sessionState(session):null,step=session?currentStep(session):"";
 return <><div className="browser-card" role="group" aria-label={"Navigateur : "+(session?.objective||"session")} data-tone={state?.tone||"progress"}>
  <div className="browser-card-head"><span className="browser-card-icon"><Globe2 size={17} aria-hidden="true"/></span><div><strong>{session?.objective||"Session de navigateur"}</strong><span className="browser-card-status">{state?state.label:failed?"État indisponible":"Chargement…"}{step?<> · <span>{step}</span></>:null}</span></div></div>
  <button type="button" className="browser-card-thumb" onClick={onOpen} aria-label="Ouvrir le navigateur">
   {thumb?
    // eslint-disable-next-line @next/next/no-img-element -- a private, authenticated capture or an in-memory frame
    <img src={thumb} alt={"Dernière image de la page"+(session?.title?" « "+session.title+" »":"")} onError={()=>setThumb(null)}/>
    :<span className="browser-card-empty">{state?.live?"Le navigateur s’ouvre…":"Aucune image pour cette session"}</span>}
   {state&&!state.terminal&&<span className="browser-card-live" aria-hidden="true">{state.phase==="running"?"En direct":state.label}</span>}
  </button>
  <button type="button" className="button secondary browser-card-open" onClick={onOpen}>Ouvrir le navigateur</button>
 </div>{session?.pendingAction&&session.control!=="human"&&!state?.terminal&&<BrowserActionApproval key={session.pendingAction.id} session={session} action={session.pendingAction} onDecided={()=>setReload(value=>value+1)}/>}</>;
}
