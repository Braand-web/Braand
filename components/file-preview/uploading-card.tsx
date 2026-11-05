"use client";
// A file being sent, shown where it will land: the attachment row of the
// composer. Its own thumbnail, faded, with a small ring that fills up.
import {FileText,X} from "lucide-react";

type Uploading={name:string;sent:number;total:number;phase:string;preview?:string};

export function UploadingCard({item,onCancel}:{item:Uploading;onCancel:()=>void}){
 const percent=item.total?Math.min(100,Math.round(item.sent/item.total*100)):0;
 // Before the first byte is confirmed the ring turns; then it shows real progress.
 const known=percent>0,circumference=2*Math.PI*9;
 const finishing=item.phase==="Validation du fichier";
 return <div className="file-card file-card-attachment file-card-uploading" data-kind={item.preview?"image":"file"} role="status" aria-label={(finishing?"Vérification de ":"Envoi de ")+item.name+(known?" : "+percent+" %":"")}>
  <div className="file-card-attachment-visual">
   {item.preview?
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the file being sent
    <img src={item.preview} alt=""/>
    :<FileText size={26} strokeWidth={1.5} aria-hidden="true"/>}
   <span className="file-uploading-ring" data-known={known&&!finishing?"true":"false"} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="9" className="track"/><circle cx="12" cy="12" r="9" className="bar" strokeDasharray={circumference} strokeDashoffset={known&&!finishing?circumference*(1-percent/100):circumference*0.7}/></svg>
   </span>
  </div>
  {!item.preview&&<div className="file-card-attachment-caption"><span>{item.name}</span></div>}
  {!finishing&&<button type="button" className="file-uploading-cancel" aria-label={"Annuler l’envoi de "+item.name} onClick={onCancel}><X size={14} aria-hidden="true"/></button>}
 </div>;
}
