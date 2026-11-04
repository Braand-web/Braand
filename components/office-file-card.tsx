"use client";
// A Word, Excel or PDF file created by Braand, with the actions an office
// worker needs: open directly in Excel/Word, download, print.
import {useState} from "react";
import {Download,FileSpreadsheet,FileText,LoaderCircle,Printer,ExternalLink} from "lucide-react";
import {api,post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import "./proposal-card.css";

const KINDS:Record<string,{app:string;label:string}>={
 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":{app:"Excel",label:"Classeur Excel"},
 "application/vnd.openxmlformats-officedocument.wordprocessingml.document":{app:"Word",label:"Document Word"},
 "application/vnd.openxmlformats-officedocument.presentationml.presentation":{app:"PowerPoint",label:"Présentation PowerPoint"},
 "application/pdf":{app:"",label:"PDF prêt à imprimer"},
};
export const isOfficeFile=(resource:Resource)=>resource.kind==="file"&&typeof resource.data?.mime==="string"&&String(resource.data.mime) in KINDS;

export function OfficeFileCard({file,onOpen}:{file:Resource;onOpen:()=>void}){
 const mime=String(file.data?.mime||""),kind=KINDS[mime],[busy,setBusy]=useState(false),[note,setNote]=useState("");
 const downloadUrl="/api/files?id="+encodeURIComponent(file.id);
 const openInApp=async()=>{setBusy(true);setNote("");
  try{const link=await api<{officeUrl:string;app:string}>("/api/office-link",post({id:file.id}));
   window.location.href=link.officeUrl;
   setNote(`Si ${link.app} ne s’ouvre pas tout seul, utilisez « Télécharger » puis ouvrez le fichier.`);
  }catch(e){setNote(e instanceof Error?e.message:"Ouverture directe impossible : téléchargez le fichier.");}
  finally{setBusy(false);}
 };
 const print=async()=>{setBusy(true);setNote("");
  try{const response=await fetch(downloadUrl,{credentials:"same-origin"});if(!response.ok)throw new Error();const blob=await response.blob();const url=URL.createObjectURL(new Blob([blob],{type:"application/pdf"}));const win=window.open(url,"_blank");if(!win)setNote("Autorisez les fenêtres pour imprimer, ou téléchargez le PDF.");setTimeout(()=>URL.revokeObjectURL(url),60000);}
  catch{setNote("Impression impossible ici : téléchargez le PDF puis imprimez-le.");}
  finally{setBusy(false);}
 };
 return <div className="proposal-card" role="group" aria-label={file.title}>
  <div className="proposal-card-head"><span className="proposal-card-icon">{mime.includes("sheet")?<FileSpreadsheet size={17}/>:<FileText size={17}/>}</span><div><strong>{file.title}</strong><small>{kind?.label||"Fichier"} · dans votre bibliothèque</small></div></div>
  <div className="proposal-card-actions">
   {kind?.app?<button type="button" className="button small" disabled={busy} onClick={()=>void openInApp()}>{busy?<LoaderCircle size={15} className="spin"/>:<ExternalLink size={15}/>}Ouvrir dans {kind.app}</button>:null}
   {mime==="application/pdf"?<button type="button" className="button small" disabled={busy} onClick={()=>void print()}><Printer size={15}/>Imprimer</button>:null}
   <a className="button small secondary" href={downloadUrl} download><Download size={15}/>Télécharger</a>
   <button type="button" className="proposal-card-link" onClick={onOpen}>Aperçu</button>
  </div>
  {note?<p className="proposal-card-note" role="status">{note}</p>:null}
 </div>;
}
