"use client";
// "Autoriser" card: shown in the conversation when Braand needs a service the
// person has not connected yet (Gmail, OneDrive, Google Drive, Facebook…).
// Plain language, one button, then « C'est fait, continuer ».
import {useState} from "react";
import {Link2,Check} from "lucide-react";
import "./proposal-card.css";

export type ConnectRequest={toolkit:string;reason:string;redirectUrl:string};
const NAMES:Record<string,string>={gmail:"Gmail",googledrive:"Google Drive",googlesheets:"Google Sheets",googledocs:"Google Docs",googlecalendar:"Google Agenda",one_drive:"OneDrive",onedrive:"OneDrive",excel:"Excel (Microsoft 365)",outlook:"Outlook",microsoft_teams:"Teams",facebook:"Facebook",instagram:"Instagram",linkedin:"LinkedIn",whatsapp:"WhatsApp",notion:"Notion",slack:"Slack",dropbox:"Dropbox",shopify:"Shopify",metaads:"Meta Ads",youtube:"YouTube",tiktok:"TikTok"};
export const serviceName=(toolkit:string)=>NAMES[toolkit.toLowerCase()]||toolkit.replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());

export function ConnectCard({request,onContinue}:{request:ConnectRequest;onContinue:(text:string)=>void}){
 const [clicked,setClicked]=useState(false),[sent,setSent]=useState(false),name=serviceName(request.toolkit);
 return <div className="proposal-card" role="group" aria-label={"Autoriser "+name}>
  <div className="proposal-card-head"><span className="proposal-card-icon"><Link2 size={17}/></span><div><strong>Autoriser {name}</strong><small>Braand a besoin de votre accord pour continuer</small></div></div>
  {request.reason?<p className="proposal-card-prompt">{request.reason}</p>:null}
  <p className="proposal-card-note">Vous vous connectez sur la page officielle du service. Braand ne voit jamais votre mot de passe, et tout envoi ou publication vous sera montré avant.</p>
  <div className="proposal-card-actions">
   <a className="button small" href={request.redirectUrl} target="_blank" rel="noopener noreferrer" onClick={()=>setClicked(true)}>Autoriser {name}</a>
   {clicked?<button type="button" className="button small secondary" disabled={sent} onClick={()=>{setSent(true);onContinue(`C’est fait : j’ai autorisé ${name}. Continue là où tu t’étais arrêté.`);}}>{sent?<><Check size={15}/>Reprise en cours</>:"C’est fait, continuer"}</button>:null}
  </div>
 </div>;
}
