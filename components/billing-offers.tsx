"use client";

import {useId,useState} from 'react';
import {ArrowUpRight,Megaphone,ShieldCheck,SlidersVertical} from 'lucide-react';
import styles from './billing-offers.module.css';

export type BillingPlan = {
 name:string;periodPrice:number;annualPrice:number|null;credits:number;members:number;
 spaces:number;projects:number;storage:number;transfer:number;concurrency:number;sites?:number;
};
export type PlanId='essential'|'pro'|'business'|'enterprise';
export const PLAN_IDS:PlanId[]=['essential','pro','business','enterprise'];
export const planName=(plan:unknown)=>plan==='essential'?'Essentiel':plan==='pro'?'Pro':plan==='business'?'Business':plan==='enterprise'?'Entreprise':'Braand';
// What each plan changes for the customer, in plain words: results first, no technical names.
export const PLAN_COPY:Record<PlanId,{audience:string;intro:string;autonomy:string;support:string}>={
 essential:{audience:'Pour démarrer seul',intro:'Vos textes, documents, visuels et sites prêts en quelques minutes, sans rien installer.',autonomy:'Missions guidées, une à la fois',support:'Aide par e-mail'},
 pro:{audience:'Recommandé',intro:'Tout l’Essentiel, plus des missions qui avancent seules pendant que vous êtes occupé.',autonomy:'Navigateur et missions autonomes',support:'Aide prioritaire'},
 business:{audience:'Pour une petite équipe',intro:'Tout le Pro, plus un solde partagé et des validations : l’équipe avance, vous gardez la main.',autonomy:'Équipe : rôles, budgets, validations',support:'Aide prioritaire'},
 enterprise:{audience:'Pour une organisation',intro:'Tout le Business, à l’échelle de votre organisation, avec un accompagnement dédié.',autonomy:'Gouvernance complète et journal d’audit',support:'Support dédié et prise en main'},
};
export const SITES_FALLBACK:Record<PlanId,number>={essential:3,pro:10,business:25,enterprise:100};
type Props={
 plans:Record<PlanId,BillingPlan>;free:{credits:number;days:number;enabled:boolean};
 paymentsEnabled:boolean;priceLabel:string;annualAvailable?:boolean;
 selected:PlanId;onSelect:(plan:PlanId)=>void;
 currentPlan?:string;busy:boolean;owner:boolean;onChoose:(plan:PlanId,cycle:'period'|'annual')=>void;
 onUpgrade:(plan:PlanId)=>void;onDiscover:()=>void;
};
const number=(value:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value);

function CreditInstrument({credits,maximum,annual}:{credits:number;maximum:number;annual:boolean}){
 const id=useId().replace(/:/g,'');
 const fraction=maximum>0?Math.min(1,Math.max(0,credits/maximum)):0;
 const arc=2*Math.PI*150,ticks=2*Math.PI*178;
 return <div className={styles.gauge}>
  <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false">
   <defs>
    <linearGradient id={id+'-arc'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7dd3fc"/><stop offset=".55" stopColor="#8f96ff"/><stop offset="1" stopColor="#c084fc"/></linearGradient>
    <mask id={id+'-lit'}><circle className={styles.tickMask} cx="200" cy="200" r="178" style={{strokeDasharray:`${ticks*fraction} ${ticks}`}}/></mask>
   </defs>
   <g transform="rotate(-90 200 200)">
    <circle className={styles.ticks} cx="200" cy="200" r="178"/>
    <circle className={`${styles.ticks} ${styles.litTicks}`} cx="200" cy="200" r="178" mask={`url(#${id}-lit)`}/>
    <circle className={styles.track} cx="200" cy="200" r="150"/>
    <circle className={styles.arc} cx="200" cy="200" r="150" stroke={`url(#${id}-arc)`} style={{strokeDasharray:`${arc*fraction} ${arc}`}}/>
   </g>
   <circle className={styles.inner} cx="200" cy="200" r="126"/>
   <circle className={styles.innerRing} cx="200" cy="200" r="104"/>
   <g className={styles.knob} style={{transform:`rotate(${fraction*359}deg)`}}><circle className={styles.knobGlow} cx="200" cy="50" r="9"/><circle cx="200" cy="50" r="3.5" fill="white"/></g>
  </svg>
  <div className={styles.gaugeValue} aria-live="polite" aria-atomic="true"><span>Crédits</span><strong>{number(credits)}</strong><span>{annual?'par mois':'pour 30 jours'}</span></div>
 </div>;
}

export default function BillingOffers({plans,free,paymentsEnabled,priceLabel,annualAvailable=false,selected,onSelect,currentPlan,busy,owner,onChoose,onUpgrade,onDiscover}:Props){
 const [cycle,setCycle]=useState<'period'|'annual'>('period');
 const canChooseAnnual=annualAvailable&&PLAN_IDS.every(id=>Number.isSafeInteger(plans[id].annualPrice)&&(plans[id].annualPrice??0)>0);
 const annual=cycle==='annual'&&canChooseAnnual;
 const plan=plans[selected],top=plans.enterprise??plans.business,copy=PLAN_COPY[selected],sites=(id:PlanId)=>plans[id].sites??SITES_FALLBACK[id];
 const price=annual?plan.annualPrice!:plan.periodPrice,perDay=Math.round(price/(annual?365:30));
 const specs=[
  {label:'Équipe',value:plan.members===1?'1 utilisateur':`${number(plan.members)} membres`,quantity:plan.members,max:top.members},
  {label:'Marques et projets',value:`${number(plan.spaces)} marque${plan.spaces>1?'s':''} · ${number(plan.projects)} projets`,quantity:plan.projects,max:top.projects},
  {label:'Stockage',value:`${number(plan.storage/1024**3)} Go`,quantity:plan.storage,max:top.storage},
  {label:'Sites en ligne',value:`${number(sites(selected))} site${sites(selected)>1?'s':''}${selected==='essential'?'':' sans mention Braand'}`,quantity:sites(selected),max:sites('enterprise')},
  {label:'Travail en parallèle',value:plan.concurrency===1?'1 tâche à la fois':`${number(plan.concurrency)} tâches en même temps`,quantity:plan.concurrency,max:top.concurrency},
  {label:'Autonomie',value:copy.autonomy,quantity:PLAN_IDS.indexOf(selected)+1,max:PLAN_IDS.length},
  {label:'Accompagnement',value:copy.support,quantity:PLAN_IDS.indexOf(selected)+1,max:PLAN_IDS.length},
 ];
 return <div className={styles.offers}>
  <div className={styles.toolbar}>
   {!paymentsEnabled&&<p className={styles.availability}><ShieldCheck size={16} aria-hidden="true"/>Les tarifs sont consultables. Les paiements ne sont pas encore ouverts.</p>}
   <div className={styles.period}><div className={styles.periodSwitch} role="group" aria-label="Période du forfait"><button type="button" aria-pressed={!annual} onClick={()=>setCycle('period')}>Mensuel</button><button type="button" aria-pressed={annual} disabled={!canChooseAnnual} onClick={()=>setCycle('annual')}>Annuel</button></div><span>{annual?'Pour 12 mois':'Pour 30 jours'} · renouvellement volontaire</span></div>
  </div>
  <section className={styles.instrument} aria-label="Comparer les forfaits">
   <div className={styles.stage}>
    <CreditInstrument credits={plan.credits} maximum={top.credits} annual={annual}/>
    <div className={styles.planSwitch} role="group" aria-label="Choisir un forfait à comparer">
     {PLAN_IDS.filter(id=>plans[id]).map(id=><button type="button" key={id} aria-pressed={selected===id} aria-label={`${plans[id].name}, ${number(annual?plans[id].annualPrice!:plans[id].periodPrice)} FCFA`} onClick={()=>onSelect(id)}><strong>{plans[id].name}</strong><span>{number(annual?plans[id].annualPrice!:plans[id].periodPrice)}</span></button>)}
    </div>
   </div>
   <div className={styles.details}>
    <div className={styles.planIntro}><div><h2>{plan.name}</h2><span className={styles.planChip}>{currentPlan===selected?'Votre forfait':copy.audience}</span></div><p>{copy.intro}</p></div>
    <div className={styles.priceBlock}><div className={styles.price}>{selected==='enterprise'&&<span>À partir de</span>}<strong>{number(price)}</strong><span>FCFA</span></div><p>{annual?'Pour 12 mois · 2 mois offerts':'Pour 30 jours'} · soit {number(perDay)} FCFA/jour{selected==='enterprise'?` pour ${number(plan.members)} membres`:''} · {priceLabel}</p></div>
    <button type="button" className={styles.choose} disabled={busy||!owner||!paymentsEnabled} onClick={()=>onChoose(selected,annual?'annual':'period')}>{busy?'Préparation…':`${currentPlan===selected?'Renouveler':'Choisir'} ${plan.name}`}<ArrowUpRight size={17} aria-hidden="true"/></button>
    {!owner&&<p className={styles.ownerNote}>Seul le propriétaire de l’espace peut gérer les paiements.</p>}
    <div><dl className={styles.specs}>{specs.map(spec=><div key={spec.label}><div className={styles.specLine}><dt>{spec.label}</dt><dd>{spec.value}</dd></div><span className={styles.bar} aria-hidden="true"><span style={{width:`${spec.max>0?Math.min(100,spec.quantity/spec.max*100):0}%`}}/></span></div>)}</dl><p className={styles.comparisonNote}>Sur tous les forfaits : un cerveau qui s’adapte à chaque demande, rapide au quotidien et expert sur vos dossiers importants. Les barres comparent au forfait Entreprise.</p></div>
    <p className={styles.annualNote}>{selected==='enterprise'&&<><a className={styles.contact} href={'mailto:novacore629@gmail.com?subject='+encodeURIComponent('Braand Entreprise : besoin sur mesure')}>Besoin de plus ? Contrat sur mesure</a> · </>}{annual?'Paiement annuel unique. Les crédits sont renouvelés chaque mois et expirent à la fin de chaque mois d’abonnement.':'Un seul solde pour la conversation, les créations et les outils. Les crédits du forfait expirent à la fin de la période.'}</p>
   </div>
  </section>
  {currentPlan&&PLAN_IDS.includes(currentPlan as PlanId)&&PLAN_IDS.indexOf(selected)>PLAN_IDS.indexOf(currentPlan as PlanId)&&<button type="button" className="button secondary" disabled={busy||!owner} onClick={()=>onUpgrade(selected)}>Passer à {plan.name} maintenant · voir le prorata<ArrowUpRight size={16}/></button>}
  <section className={styles.discovery} aria-labelledby="billing-discovery-title">
   <div className={styles.ticket}><strong>{number(free.credits)}</strong><span>crédits</span></div>
   <div className={styles.discoveryBody}><div><h2 id="billing-discovery-title">Commencez par une idée.</h2><p>Découverte : {number(free.credits)} crédits, une seule fois, valables {free.days} jours. Sans carte bancaire.</p></div><button type="button" className="button secondary" disabled={busy||!free.enabled} onClick={onDiscover}>{free.enabled?'Découvrir Braand':'Découverte indisponible'}</button></div>
  </section>
  <section className={styles.explainer} aria-labelledby="billing-credits-title"><h2 id="billing-credits-title">Comment fonctionnent les crédits</h2><div className={styles.explainerGrid}>
   <article><span><SlidersVertical size={20} aria-hidden="true"/></span><div><h3>Un solde commun</h3><p>Conversation, créations, outils et missions utilisent les mêmes crédits. Les petits appels consomment des fractions de crédit.</p></div></article>
   <article><span><ShieldCheck size={20} aria-hidden="true"/></span><div><h3>Un plafond avant d’agir</h3><p>Braand présente le plafond à approuver avant une génération ou une mission. Elle s’arrête au budget autorisé.</p></div></article>
   <article><span><Megaphone size={20} aria-hidden="true"/></span><div><h3>Publicité séparée</h3><p>Les dépenses publicitaires sont réglées directement à Meta, Google ou à la plateforme concernée.</p></div></article>
  </div><p className={styles.resultsNote}>Les exemples de résultats seront publiés après mesure des parcours.</p></section>
 </div>;
}
