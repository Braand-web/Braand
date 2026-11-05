"use client";
// A website Braand built. The user previews it, then publishes it with one
// explicit click (Braand never publishes by itself), and can take it offline.
import {useEffect,useState} from "react";
import {Eye,Globe,LoaderCircle,Power,Rocket,X} from "lucide-react";
import {api,post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import "./proposal-card.css";

type Publication={status:string;url:string|null;badge:boolean;version:number}|null;
type Prepared={version:number;digest:string;url:string;badge:boolean;files:number};
export const isSite=(resource:Resource)=>resource.kind==="site";

export function SiteCard({site}:{site:Resource}){
 const files=Array.isArray(site.data?.files)?site.data.files as {path:string}[]:[],pages=files.filter(file=>/\.html?$/.test(file.path)).length;
 const [publication,setPublication]=useState<Publication>(null),[busy,setBusy]=useState(false),[note,setNote]=useState(""),[preview,setPreview]=useState<string|null>(null),[confirm,setConfirm]=useState<Prepared|null>(null),[version,setVersion]=useState(site.version);
 const base="/api/sites/"+encodeURIComponent(site.id);
 useEffect(()=>{let live=true;void api<{publication:Publication;version:number}>(base).then(data=>{if(live){setPublication(data.publication);setVersion(data.version);}}).catch(()=>{});return()=>{live=false;};},[base]);
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setNote("");try{await task();}catch(e){setNote(e instanceof Error?e.message:"L’action n’a pas abouti. Réessayez.");}finally{setBusy(false);}};
 const openPreview=()=>run(async()=>{const data=await api<{url:string}>(base+"?preview");setPreview(data.url);});
 const prepare=()=>run(async()=>{setConfirm(await api<Prepared>(base,post({action:"prepare",version})));});
 const publish=()=>run(async()=>{if(!confirm)return;const result=await api<Publication>(base,post({action:"publish",version:confirm.version,digest:confirm.digest,approved:true}));setPublication(result);setConfirm(null);setNote("Votre site est en ligne.");});
 const suspend=()=>run(async()=>{const result=await api<Publication>(base,post({action:"suspend"}));setPublication(result);setNote("Le site n’est plus en ligne. Le brouillon est conservé.");});
 const online=publication?.status==="published";
 return <div className="proposal-card" role="group" aria-label={site.title}>
  <div className="proposal-card-head"><span className="proposal-card-icon"><Globe size={17}/></span><div><strong>{site.title}</strong><small>Site web · {pages} page{pages>1?"s":""} · {online?"en ligne":"brouillon privé"}</small></div></div>
  {online&&publication?.url&&<p className="proposal-card-note"><a href={publication.url} target="_blank" rel="noopener noreferrer">{publication.url}</a>{publication.badge?" · mention « Fait avec Braand »":""}</p>}
  {confirm&&<div className="proposal-card-note" role="alertdialog" aria-label="Confirmer la publication">
   <p>Le site sera <strong>public</strong> à l’adresse <strong>{confirm.url}</strong> ({confirm.files} fichier{confirm.files>1?"s":""}){confirm.badge?", avec la mention « Fait avec Braand » (compte gratuit : 1 site en ligne)":""}. Vous pourrez le retirer à tout moment.</p>
   <div className="proposal-card-actions"><button type="button" className="button small" disabled={busy} onClick={()=>void publish()}>{busy?<LoaderCircle size={15} className="spin"/>:<Rocket size={15}/>}Confirmer la publication</button><button type="button" className="button small secondary" disabled={busy} onClick={()=>setConfirm(null)}>Annuler</button></div>
  </div>}
  {!confirm&&<div className="proposal-card-actions">
   <button type="button" className="button small secondary" disabled={busy||!pages} onClick={()=>void openPreview()}><Eye size={15}/>Aperçu</button>
   <button type="button" className="button small" disabled={busy||!pages} onClick={()=>void prepare()}>{busy?<LoaderCircle size={15} className="spin"/>:<Rocket size={15}/>}{online?"Mettre à jour en ligne":"Publier"}</button>
   {online&&<button type="button" className="button small secondary" disabled={busy} onClick={()=>void suspend()}><Power size={15}/>Retirer</button>}
  </div>}
  {note&&<p className="proposal-card-note" role="status">{note}</p>}
  {preview&&<div className="site-preview" role="dialog" aria-label={"Aperçu de "+site.title}>
   <div className="site-preview-bar"><span>Aperçu privé · {site.title}</span><button type="button" className="icon-button" aria-label="Fermer l’aperçu" onClick={()=>setPreview(null)}><X size={18}/></button></div>
   {/* Opaque origin: the site's scripts can never reach Braand. */}
   <iframe title={"Aperçu de "+site.title} src={preview} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/>
  </div>}
 </div>;
}
