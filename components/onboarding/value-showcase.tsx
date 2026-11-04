"use client";
// First-visit showcase: what Braand actually does, with real examples and a
// one-click start for each. Plus a three-step getting-started checklist
// computed from the workspace's real resources.
import {useEffect,useRef,useState} from "react";
import Image from "next/image";
import {Play,Moon,ImageIcon,Clapperboard,FileText,GraduationCap,Check,X} from "lucide-react";
import type {Resource} from "@/lib/contracts";
import {readBraandStorage} from "@/lib/client-storage";
const writeBraandStorage=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{/* storage unavailable: hidden only for this visit */}};
import "./onboarding.css";

const PROMPTS={
 night:"Chaque matin à 7 h, prépare-moi 3 idées de publications pour ma marque avec un visuel prêt à publier. Lance-le en tâche de fond et propose-moi d’en faire une routine.",
 visual:"Crée-moi un visuel prêt à publier pour annoncer mon offre du moment (format carré pour Instagram). Pose-moi seulement les informations qui manquent.",
 video:"Crée-moi une courte vidéo IA pour présenter mon produit sur les réseaux (format vertical). Je peux t’envoyer une photo du produit : dis-moi ce dont tu as besoin et montre-moi le budget avant de générer.",
 document:"Prépare-moi un document professionnel en PDF prêt à télécharger : un guide ou un ebook court sur mon activité, avec couverture et sommaire. Demande-moi le sujet.",
 teach:"Je vais t’apprendre comment je fais une tâche que je répète souvent. Pose-moi des questions, puis enregistre la méthode pour la réutiliser.",
};

function DemoVideo(){
 const [open,setOpen]=useState(false),ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{if(!open)return;const k=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};window.addEventListener("keydown",k);return()=>window.removeEventListener("keydown",k);},[open]);
 return <>
  <button type="button" className="ob-card ob-hero" onClick={()=>setOpen(true)} onMouseEnter={()=>{void ref.current?.play().catch(()=>undefined);}} onMouseLeave={()=>ref.current?.pause()} aria-label="Regarder la démonstration de Braand (60 secondes)">
   <video ref={ref} className="ob-media" src="/onboarding/demo-1280.mp4" poster="/onboarding/demo-poster.jpg" muted loop playsInline preload="none"/>
   <span className="ob-play"><Play size={18} fill="currentColor"/></span>
   <span className="ob-caption"><strong>Regardez Braand en 60 secondes</strong><small>Une phrase, et Braand construit toute votre campagne.</small></span>
  </button>
  {open?<div className="ob-modal" role="dialog" aria-label="Démonstration de Braand" onClick={()=>setOpen(false)}>
   <button type="button" className="ob-close" aria-label="Fermer" onClick={()=>setOpen(false)}><X size={18}/></button>
   <video className="ob-modal-video" controls autoPlay playsInline poster="/onboarding/demo-poster.jpg" onClick={e=>e.stopPropagation()}>
    <source src="/onboarding/demo-portrait-540.mp4" type="video/mp4" media="(max-width: 640px)"/>
    <source src="/onboarding/demo-1280.mp4" type="video/mp4"/>
   </video>
  </div>:null}
 </>;
}

function Card({icon,title,text,action,onClick,children}:{icon:React.ReactNode;title:string;text:string;action:string;onClick:()=>void;children?:React.ReactNode}){
 return <div className="ob-card">
  {children?<div className="ob-visual">{children}</div>:null}
  <div className="ob-body"><span className="ob-icon">{icon}</span><strong>{title}</strong><p>{text}</p><button type="button" className="ob-action" onClick={onClick}>{action}</button></div>
 </div>;
}

export function ValueShowcase({onPrompt,motionReady}:{onPrompt:(text:string)=>void;motionReady:boolean}){
 const clip=useRef<HTMLVideoElement>(null);
 return <section className="ob" aria-label="Ce que Braand fait pour vous">
  <h2 className="ob-title">Ce que Braand fait pour vous</h2>
  <div className="ob-grid">
   <DemoVideo/>
   <Card icon={<Moon size={16}/>} title="Il travaille pendant que vous dormez" text="Donnez une mission : Braand la mène en arrière-plan, vous prévient à la fin, et peut la refaire chaque jour ou chaque semaine." action="Essayer" onClick={()=>onPrompt(PROMPTS.night)}>
    <div className="ob-night"><span>23:40</span><span className="ob-dot"/><span>Recherche · rédaction · visuel</span><span className="ob-dot ok"/><span>07:00 · c’est prêt</span></div>
   </Card>
   <Card icon={<ImageIcon size={16}/>} title="Visuels prêts à publier" text="Posts, stories, bannières, citations, chiffres clés : mis en page avec votre marque, en quelques secondes." action="Créer le mien" onClick={()=>onPrompt(PROMPTS.visual)}>
    <div className="ob-gallery">{["annonce-carre","citation-portrait","chiffre-story","liste-carre"].map(n=><Image key={n} src={`/onboarding/${n}.webp`} alt="" width={240} height={300} unoptimized/>)}</div>
   </Card>
   <Card icon={<Clapperboard size={16}/>} title={motionReady?"Vidéos et motion design":"Vidéos IA"} text={motionReady?"Vidéos IA à partir d’une photo ou d’une idée, et vidéos en motion design (textes et formes animés), livrées en MP4.":"Vidéos courtes générées par l’IA à partir d’une photo ou d’une idée, pour vos réseaux. Le motion design arrive bientôt."} action="Créer ma vidéo" onClick={()=>onPrompt(PROMPTS.video)}>
    <video ref={clip} className="ob-media" src="/onboarding/video-clip.mp4" poster="/onboarding/video-clip.jpg" muted loop playsInline preload="none" onMouseEnter={()=>{void clip.current?.play().catch(()=>undefined);}} onMouseLeave={()=>clip.current?.pause()}/>
   </Card>
   <Card icon={<FileText size={16}/>} title="Documents de pro" text="Ebooks, guides, rapports, Word et Excel avec formules, attestations : de vrais fichiers, prêts à imprimer." action="Faire un document" onClick={()=>onPrompt(PROMPTS.document)}>
    <div className="ob-doc"><Image src="/onboarding/ebook.webp" alt="" width={72} height={108} unoptimized/><span>PDF · Word · Excel</span></div>
   </Card>
   <Card icon={<GraduationCap size={16}/>} title="Il apprend vos méthodes" text="Expliquez une fois comment vous faites (texte, captures, fichiers) : Braand la retient et l’applique ensuite tout seul." action="Lui apprendre" onClick={()=>onPrompt(PROMPTS.teach)}/>
  </div>
 </section>;
}

const STEPS:[string,string,(r:Resource[])=>boolean,string][]=[
 ["Votre première création","Un visuel, une vidéo ou un document",r=>r.some(x=>x.kind==="file"&&x.status!=="deleted"&&/png|webp|jpeg|mp4|pdf|docx|xlsx|pptx/.test(String(x.data?.format||x.data?.mime||"")))||r.some(x=>x.kind==="media"),PROMPTS.visual],
 ["Votre première tâche en arrière-plan","Braand travaille pendant que vous faites autre chose",r=>r.some(x=>x.kind==="work"),PROMPTS.night],
 ["Votre première méthode","Apprenez-lui comment vous faites",r=>r.some(x=>x.kind==="skill"&&x.data?.origin==="taught"),PROMPTS.teach],
];
const KEY="braand.onboarding.hidden";

export function StartChecklist({resources,onPrompt}:{resources:Resource[];onPrompt:(text:string)=>void}){
 const [hidden,setHidden]=useState(()=>typeof window!=="undefined"&&readBraandStorage(KEY)==="1");
 const done=STEPS.map(([, ,check])=>check(resources)),count=done.filter(Boolean).length;
 if(hidden||count===STEPS.length)return null;
 return <section className="ob-check" aria-label="Bien démarrer">
  <div className="ob-check-head"><strong>Bien démarrer · {count}/{STEPS.length}</strong><button type="button" aria-label="Masquer" onClick={()=>{writeBraandStorage(KEY,"1");setHidden(true);}}><X size={15}/></button></div>
  <div className="ob-progress"><span style={{width:Math.round(count/STEPS.length*100)+"%"}}/></div>
  <ol>{STEPS.map(([title,hint,,prompt],i)=><li key={title} className={done[i]?"done":""}><span className="ob-step">{done[i]?<Check size={13}/>:i+1}</span><span><strong>{title}</strong><small>{hint}</small></span>{done[i]?null:<button type="button" onClick={()=>onPrompt(prompt)}>Faire maintenant</button>}</li>)}</ol>
 </section>;
}
