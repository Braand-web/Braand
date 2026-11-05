"use client";
// Full-screen pricing: the four plans side by side, one clear choice, the
// existing purchase path (quote, then the hosted payment page).
import {useEffect,useRef,useState} from "react";
import {ArrowUpRight,Check,X} from "lucide-react";
import {api} from "@/lib/client-api";
import {startCheckout} from "@/lib/billing-checkout";
import {PLAN_COPY,PLAN_IDS,SITES_FALLBACK,type BillingPlan,type PlanId} from "@/components/billing-offers";
import "./pricing-dialog.css";

type Catalog={annualAvailable?:boolean;checkoutMode?:"hosted"|"invoiced";plans:Record<PlanId,BillingPlan>;readiness:{enabled:boolean}};
type Props={open:boolean;onClose:()=>void;currentPlan?:string;owner:boolean;guest:boolean;signInHref:string;onDetails:()=>void;onConfirmInSettings:()=>void};

const number=(value:number)=>new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(value);
const rank=(plan?:string)=>PLAN_IDS.indexOf(plan as PlanId);

/** The plan a customer should look at next, or null on the top plan. */
export function nextPlan(current?:string):PlanId|null{
 const index=rank(current);
 if(index<0||current==="essential")return "pro";
 return PLAN_IDS[index+1]??null;
}

export function PricingDialog({open,onClose,currentPlan,owner,guest,signInHref,onDetails,onConfirmInSettings}:Props){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null);
 const [catalog,setCatalog]=useState<Catalog|null>(null),[failed,setFailed]=useState(false);
 const [annual,setAnnual]=useState(false),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState<PlanId|null>(null),[error,setError]=useState("");
 useEffect(()=>{
  const node=dialog.current;if(!node)return;
  if(open&&!node.open){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;node.showModal();}
  if(!open&&node.open){node.close();opener.current?.focus();}
 },[open]);
 useEffect(()=>{
  if(!open||catalog)return;let stop=false;
  api<Catalog>("/api/billing/catalog").then(next=>{if(!stop){setCatalog(next);setFailed(false);}}).catch(()=>{if(!stop)setFailed(true);});
  return()=>{stop=true;};
 },[open,catalog,attempt]);
 const annualAvailable=!!catalog?.annualAvailable&&PLAN_IDS.every(id=>catalog.plans[id]?.annualPrice!=null);
 const yearly=annual&&annualAvailable;
 const pro=catalog?.plans.pro,monthsFree=pro&&pro.annualPrice?Math.round((pro.periodPrice*12-pro.annualPrice)/pro.periodPrice):0;
 const choose=async(id:PlanId)=>{
  if(guest){location.assign(new URL(signInHref,location.origin).href);return;}
  if(!catalog||busy)return;setBusy(id);setError("");
  try{
   const upgrade=rank(currentPlan)>=0&&rank(id)>rank(currentPlan);
   const result=await startCheckout(upgrade?{kind:"upgrade",plan:id}:{kind:"subscription",plan:id,cycle:yearly?"annual":"period"},catalog.checkoutMode);
   if(result.step==="redirect"){location.assign(result.url);return;}
   onConfirmInSettings();
  }catch(e){setError(e instanceof Error?e.message:"Impossible de préparer le paiement. Réessayez.");}
  finally{setBusy(null);}
 };
 const action=(id:PlanId)=>{
  const here=rank(currentPlan),there=rank(id);
  if(here>=0&&there<here)return {label:"Déjà inclus",disabled:true};
  if(!owner&&!guest)return {label:"Réservé au propriétaire",disabled:true};
  if(catalog&&!catalog.readiness.enabled)return {label:"Bientôt disponible",disabled:true};
  return {label:busy===id?"Préparation…":here===there?"Renouveler":"Choisir "+catalog?.plans[id].name,disabled:!!busy};
 };
 return <dialog ref={dialog} className="pricing-dialog" aria-labelledby="pricing-title" onClose={onClose} onCancel={event=>{event.preventDefault();onClose();}}>
  <div className="pricing-shell">
   <button type="button" className="pricing-close" aria-label="Fermer les tarifs" onClick={onClose}><X size={20} aria-hidden="true"/></button>
   <header className="pricing-head">
    <h2 id="pricing-title">Faites travailler Braand pour vous, tous les jours.</h2>
    <p>Un forfait, des crédits chaque mois, et une équipe qui ne dort jamais. Changez quand vous voulez.</p>
    {annualAvailable&&<div className="pricing-cycle" role="group" aria-label="Période de paiement">
     <button type="button" aria-pressed={!yearly} onClick={()=>setAnnual(false)}>30 jours</button>
     <button type="button" aria-pressed={yearly} onClick={()=>setAnnual(true)}>Annuel{monthsFree>0&&<span>{monthsFree} mois offerts</span>}</button>
    </div>}
   </header>
   {!catalog?<div className="pricing-grid" aria-busy={!failed}>{failed?<p className="pricing-error" role="alert">Les tarifs n’ont pas pu être chargés. <button type="button" onClick={()=>{setFailed(false);setAttempt(value=>value+1);}}>Réessayer</button></p>:PLAN_IDS.map(id=><div key={id} className="pricing-card pricing-card-skeleton" aria-hidden="true"/>)}</div>
   :<div className="pricing-grid">{PLAN_IDS.map(id=>{
    const plan=catalog.plans[id],copy=PLAN_COPY[id],current=currentPlan===id,featured=id==="pro",act=action(id);
    const price=yearly?plan.annualPrice!:plan.periodPrice;
    const benefits=[
     number(plan.credits)+" crédits chaque mois",
     copy.autonomy,
     (plan.sites??SITES_FALLBACK[id])+" sites en ligne",
     plan.members===1?"Pour vous seul · "+copy.support:plan.members+" membres · "+copy.support,
    ];
    return <article key={id} className="pricing-card" data-featured={featured||undefined} data-current={current||undefined} aria-labelledby={"pricing-"+id}>
     <div className="pricing-card-top"><h3 id={"pricing-"+id}>{plan.name}</h3>{current?<span className="pricing-tag">Votre forfait</span>:featured?<span className="pricing-tag pricing-tag-accent">Recommandé</span>:null}</div>
     <p className="pricing-audience">{copy.audience==="Recommandé"?"Pour aller plus vite":copy.audience}</p>
     <p className="pricing-price"><strong>{number(price)}</strong><span>FCFA {yearly?"/ an":"/ 30 jours"}</span></p>
     <p className="pricing-intro">{copy.intro}</p>
     <ul>{benefits.map(line=><li key={line}><Check size={15} aria-hidden="true"/>{line}</li>)}</ul>
     <button type="button" className={"pricing-cta"+(featured&&!act.disabled?" is-primary":"")} disabled={act.disabled} aria-label={act.disabled?act.label+" : "+plan.name:act.label+", "+number(price)+" FCFA"} onClick={()=>void choose(id)}>{act.label}{!act.disabled&&<ArrowUpRight size={16} aria-hidden="true"/>}</button>
    </article>;
   })}</div>}
   {error&&<p className="pricing-error" role="alert">{error}</p>}
   {!owner&&!guest&&<p className="pricing-note">Seul le propriétaire de l’espace peut changer de forfait. Demandez-lui de passer au forfait qui vous convient.</p>}
   <footer className="pricing-foot"><span>Paiement Mobile Money sécurisé</span><span>Sans engagement</span><span>Vos dépenses restent sous votre contrôle</span><button type="button" onClick={onDetails}>Comparer en détail</button></footer>
  </div>
 </dialog>;
}
