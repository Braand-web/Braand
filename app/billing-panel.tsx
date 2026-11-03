"use client";
import {useState,useEffect,useCallback,useRef,useId} from 'react';
import {ArrowUpRight,ShieldCheck,RefreshCw,ArrowLeft,ChevronLeft,ChevronRight,Download} from 'lucide-react';
import {api,post,workspaceHeaders} from '../lib/client-api';
import BillingOffers,{PLAN_IDS,planName,type PlanId,type BillingPlan} from '../components/billing-offers';
import {CreditsView,PaymentsView,RechargeView,TeamView} from './billing-sections';
import styles from './billing-panel.module.css';
import {LoadingSkeleton} from "@/components/ds/loading";
type BillingCycle='period'|'annual';
type Catalog={annualAvailable?:boolean;checkoutMode?:'hosted'|'invoiced';plans:Record<PlanId,BillingPlan>;packs:{quantity:number;amount:number}[];custom:null;tax?:{mode?:'exclusive'|'inclusive';configured:boolean};free:{credits:number;days:number;enabled:boolean};readiness:{enabled:boolean}};
type Entry={id:string;kind:string;created_at:number;units:number;reference?:string};
type CreditDay={day:string;units:number};
type Lot={id:string;source:string;granted:number;starts_at:number;expires_at:number|null;frozen?:number|boolean;balance:number;reserved:number};
type Order={id:string;amount:number;currency?:string;product:string;created_at:number;status:string;checkoutUrl?:string};
type Summary={wallet:{available:number;reserved:number;granted?:number};creditAllowance?:number;subscription?:{plan:string;cycle:string;start_at:number;end_at:number};lots:Lot[];orders:Order[];invoices:{id:string;number:string;created_at?:number}[];readiness?:{enabled:boolean};asOf?:number};
type Member={user_id:string;role:string;active:number;id?:string;name?:string};
type Space={id:string;name:string;organization_id:string;organization_name:string;user_id?:string};
type Organization={current:string;organization:string;role:string;rights:{plan:string;limits:{members:number;spaces:number}};spaces:Space[];members:Member[];limits:{scope:string;scope_id:string;units:number}[];pendingInvites:number;activeMemberCount:number;viewer:{userId:string;email:string;displayName:string}};
type Quote={id:string;kind:string;plan?:string;cycle?:string;amount:number;subtotal:number;tax:number;total:number;taxRateBps:number;taxJurisdiction:string;taxMode:'exclusive'|'inclusive';taxConfigVersion:string;credits:number;units:number;expiresAt:number;eligible:boolean;documentKind?:'invoice'|'receipt'};
export type BillingTab='offers'|'topup'|'wallet'|'history'|'team';
type BillingPanelProps={onSignIn?:()=>void;onChange?:()=>void;embedded?:boolean;initialTab?:BillingTab;onTeam?:()=>void;onBilling?:(tab?:BillingTab)=>void};
const message=(error:unknown)=>{
 const detail=error instanceof Error?error.message:'Impossible de terminer cette opération. Réessayez.';
 if(detail==='SasPay est indisponible. La commande reste enregistrée.')return 'Le service de paiement est indisponible. Votre commande reste enregistrée.';
 if(detail==='La vérification SasPay a échoué.')return 'La vérification du paiement a échoué.';
 if(/saspay|fal\.ai|openrouter|composio|anthropic|claude/i.test(detail))return 'Ce service est indisponible pour le moment. Contactez le support Braand.';
 return detail;
};
const number=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(n);
const money=(n:number)=>number(n)+' FCFA';
const statuses:Record<string,string>={initializing:'Initialisation',pending:'Paiement attendu',verified:'Confirmation en cours',fulfilled:'Payée',needs_reconciliation:'Vérification nécessaire',refund_requested:'Remboursement demandé',refunded:'Remboursée',failed:'Échouée',expired:'Expirée'};
export default function BillingPanel(props:BillingPanelProps){return <BillingPanelContent key={(props.embedded?'embedded:':'standalone:')+(props.initialTab||'default')} {...props}/>;}
function BillingPanelContent({onSignIn,onChange,embedded=false,initialTab,onTeam,onBilling}:BillingPanelProps){
 const [catalog,setCatalog]=useState<Catalog>(),[summary,setSummary]=useState<Summary>(),[org,setOrg]=useState<Organization>(),[entries,setEntries]=useState<Entry[]>([]),[daily,setDaily]=useState<CreditDay[]>([]),[usageAsOf,setUsageAsOf]=useState<number>(),[usageRestricted,setUsageRestricted]=useState(false);
 const [selectedPlan,setSelectedPlan]=useState<PlanId>('pro');
 const [tab,setTab]=useState<BillingTab>(initialTab||(embedded?'history':'offers')),[quantity,setQuantity]=useState('125'),[quote,setQuote]=useState<Quote>();
 const [refreshing,setRefreshing]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[guest,setGuest]=useState(false),[reason,setReason]=useState(''),[refund,setRefund]=useState('');
 const [spaceName,setSpaceName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('editor'),[spaces,setSpaces]=useState<string[]>([]),[inviteLink,setInviteLink]=useState('');
 const [scope,setScope]=useState('organization'),[scopeId,setScopeId]=useState(''),[limit,setLimit]=useState('100');
 const key=useRef(''),returnChecked=useRef(false);
 const teamOnly=embedded&&initialTab==='team';
 const returnTo=embedded?'/?settings='+ (teamOnly?'team':'billing'):'/?view=billing';
 const signInHref='/auth/sign-in?return_to='+encodeURIComponent(returnTo);
 const load=useCallback(()=>api<Catalog>('/api/billing/catalog').then(async offers=>{setCatalog(offers);setError('');const [s,o,u]=await Promise.all([api<Summary>('/api/billing/summary'),api<Organization>('/api/billing/organization'),api<{entries:Entry[];daily?:CreditDay[];restricted?:boolean;asOf?:number}>('/api/billing/usage')]);setSummary(s);setOrg(o);setEntries(u.entries||[]);setDaily(u.daily||[]);setUsageAsOf(u.asOf);setUsageRestricted(!!u.restricted);setGuest(false);}).catch((e:unknown)=>{if(e instanceof Error&&'status' in e&&e.status===401)setGuest(true);else setError(message(e));}).finally(()=>setRefreshing(false)),[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(teamOnly||!summary||returnChecked.current)return;returnChecked.current=true;const id=new URL(location.href).searchParams.get('billingOrder');if(id){void api<Order>('/api/billing/orders/'+encodeURIComponent(id)+'?verify=true').then(o=>{setTab('history');setNotice(o.status==='fulfilled'?'Paiement confirmé. Vos droits sont disponibles.':'Paiement enregistré : '+(statuses[o.status]||o.status)+'.');void load();onChange?.();}).catch(e=>setError(message(e)));}},[summary,load,onChange,teamOnly]);
 const act=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e:unknown){setError(message(e));}finally{setBusy(false);}};
 const choose=(input:Record<string,unknown>)=>void act(async()=>{if(guest){location.assign(new URL(signInHref,location.origin).href);return;}const q=await api<Quote>('/api/billing/quotes',post(input));key.current=crypto.randomUUID();if(catalog?.checkoutMode==='hosted'&&q.eligible){const order=await api<Order>('/api/billing/checkout',post({quoteId:q.id,idempotencyKey:key.current}));if(order.checkoutUrl&&order.status==='pending'){location.assign(order.checkoutUrl);return;}setTab('history');setNotice(statuses[order.status]||order.status);await load();return;}setQuote(q);});
 const pay=()=>void act(async()=>{if(!quote)return;const order=await api<Order>('/api/billing/checkout',post({quoteId:quote.id,idempotencyKey:key.current}));if(order.checkoutUrl&&order.status==='pending')location.assign(order.checkoutUrl);else{setNotice(statuses[order.status]||order.status);setQuote(undefined);await load();}});
 const download=async(id:string)=>{const response=await fetch('/api/billing/invoices/'+encodeURIComponent(id),{headers:workspaceHeaders()});if(!response.ok)throw new Error('Le document est indisponible.');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='document-braand.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const organizationAction=(input:Record<string,unknown>)=>act(async()=>{const result=await api<{token?:string}>('/api/billing/organization',post(input));if(result.token)setInviteLink(location.origin+'/?invite='+encodeURIComponent(result.token));setNotice('Modification enregistrée.');await load();onChange?.();});
  const verifyOrder=(id:string)=>void act(async()=>{const result=await api<{status:string}>('/api/billing/orders/'+encodeURIComponent(id)+'?verify=true');setNotice(statuses[result.status]||result.status);await load();onChange?.();});
  const submitRefund=(id:string)=>void act(async()=>{await api('/api/billing/refund-requests',post({orderId:id,reason}));setRefund('');setReason('');setNotice('Demande enregistrée. Les crédits concernés sont protégés pendant son examen.');await load();});
 const sub=summary?.subscription,owner=embedded?org?.role==='owner':!org||org.role==='owner';
 const priceLabel=catalog?.checkoutMode==='hosted'?'prix de la commande':catalog?.tax?.configured&&catalog.tax.mode==='exclusive'?'hors taxes':catalog?.tax?.configured&&catalog.tax.mode==='inclusive'?'taxes incluses':'taxes calculées avant paiement';
 const headings:Record<string,{title:string;description:string}>={offers:{title:'De l’idée au résultat.',description:'Un forfait pour avancer. Des crédits pour créer.'},topup:{title:'Recharger',description:'Ajoutez des crédits quand votre solde ne suffit plus.'},wallet:{title:'Mes crédits',description:'Votre solde et votre consommation sur la période en cours.'},history:{title:'Paiements',description:'Votre forfait en cours, vos moyens de paiement et vos reçus.'},team:{title:'Mon équipe',description:'Gérez les accès, les espaces et les plafonds de crédits de votre organisation.'}};
 const heading=headings[tab]||headings.offers;
 const reload=()=>{setRefreshing(true);setError('');void load();};
 const discover=()=>void act(async()=>{if(guest){location.assign(new URL(signInHref,location.origin).href);return;}await api('/api/billing/free',post({}));setNotice('Vos crédits de découverte sont disponibles.');await load();onChange?.();});
 const navigation:[BillingTab,string][]=embedded?[['offers','Forfait'],['topup','Recharger'],['history','Paiements']]:[['offers','Forfaits'],['topup','Recharger'],['wallet','Mes crédits'],['history','Paiements'],['team','Mon équipe']];
 return <section className={(embedded?'':'billing-page ')+styles.page+(embedded?' '+styles.embedded:'')} aria-label={teamOnly?'Gestion de l’équipe':'Forfaits et crédits'}>
  {embedded?<div className={styles.compactToolbar}><span>{teamOnly?'Membres, espaces et plafonds':tab==='history'?'Votre abonnement et vos documents':tab==='topup'?'Ajouter des crédits':'Choisir votre forfait'}</span><button type="button" className="button secondary" disabled={refreshing||busy} onClick={reload} aria-label={teamOnly?'Actualiser l’équipe':'Actualiser la facturation'}><RefreshCw size={15} className={refreshing?'spin':undefined}/><span>{refreshing?'Actualisation…':'Actualiser'}</span></button></div>:<header className={"billing-heading "+styles.heading}><div><div className={styles.label}><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 4v32M4 20h32M8.7 8.7l22.6 22.6M8.7 31.3 31.3 8.7" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/><circle cx="20" cy="20" r="5" fill="currentColor"/></svg>Forfaits et crédits</div><h1>{heading.title}{tab==='offers'&&<><br/><span>À votre rythme.</span></>}</h1><p>{heading.description}</p></div><button type="button" className="button secondary" disabled={refreshing} onClick={reload} aria-label="Actualiser la facturation"><RefreshCw size={15} className={refreshing?'spin':undefined}/>{refreshing?'Actualisation…':'Actualiser'}</button></header>}
  {!teamOnly&&<nav className={embedded?styles.compactTabs:"billing-tabs "+styles.tabs} aria-label="Rubriques de facturation">{navigation.map(([id,label])=><button key={id} type="button" onClick={()=>{setTab(id);setQuote(undefined);}} aria-current={tab===id?'page':undefined}>{label}</button>)}</nav>}
  <div aria-live="polite">{error&&<p className="billing-alert error" role="alert">{error}</p>}{notice&&<p className="billing-alert">{notice}</p>}</div>
  {!catalog?(error?<button type="button" className="button secondary" onClick={reload}>Réessayer le chargement</button>:<LoadingSkeleton label="Chargement des offres…" shape="plans"/>):<>
  {(tab==='topup'||tab==='history'||embedded&&tab==='offers')&&!catalog.readiness.enabled&&<p className="billing-availability"><ShieldCheck size={16}/>Les tarifs sont consultables. Les paiements ne sont pas encore ouverts.</p>}
  {quote?<div className="billing-review"><button className="button ghost" onClick={()=>setQuote(undefined)}><ArrowLeft size={15}/>Revenir</button><h2>Votre récapitulatif</h2><p>{quote.kind==='topup'?number(quote.credits)+' crédits supplémentaires':quote.kind==='upgrade'?'Passage immédiat à '+planName(quote.plan):`${planName(quote.plan)} · ${quote.cycle==='annual'?'12 mois':'30 jours'}`}</p><dl className={styles.quoteBreakdown}><div><dt>Sous-total hors taxes</dt><dd>{money(quote.subtotal)}</dd></div><div><dt>Taxes · {quote.taxJurisdiction} · {number(quote.taxRateBps/100)} %</dt><dd>{money(quote.tax)}</dd></div><div><dt>Total à payer</dt><dd>{money(quote.total)}</dd></div></dl><p>Montant final en XAF, calculé par Braand avant votre accord.</p><ul>{quote.kind==='topup'?<><li>Crédits sans expiration pendant la vie du service.</li><li>Ne prolonge pas votre abonnement ni vos droits d’équipe.</li></>:<><li>{quote.kind==='upgrade'?number(quote.units/100)+' crédits complémentaires':number(quote.credits)+' crédits par '+(quote.cycle==='annual'?'mois anniversaire':'période')}.</li><li>{quote.kind==='upgrade'?'Date de fin conservée.':sub?'La nouvelle période commencera après celle déjà payée.':'Activation après confirmation du paiement.'}</li><li>Renouvellement volontaire, sans prélèvement automatique.</li></>}</ul><p className="muted">Devis valable jusqu’à {new Date(quote.expiresAt).toLocaleTimeString('fr-FR')}. Les dépenses publicitaires sont payées directement à la plateforme concernée.</p><button className="button primary" disabled={busy||!quote.eligible} onClick={pay}>{busy?'Vérification…':'Accepter le total et continuer vers le paiement'}<ArrowUpRight size={16}/></button>{!quote.eligible&&<p className="billing-note">Cette offre attend la validation des conditions de lancement. Aucun débit ne sera effectué.</p>}</div>:<>
  {tab==='offers'&&(embedded?<CompactOffers catalog={catalog} priceLabel={priceLabel} currentPlan={sub?.plan} busy={busy||refreshing} owner={owner} guest={guest} signInHref={signInHref} onSignIn={onSignIn} onChoose={(plan,cycle)=>choose({kind:'subscription',plan,cycle})} onUpgrade={plan=>choose({kind:'upgrade',plan})} onDiscover={discover} onTeam={onTeam}/>:<BillingOffers selected={selectedPlan} onSelect={setSelectedPlan} plans={catalog.plans} free={catalog.free} priceLabel={priceLabel} paymentsEnabled={catalog.readiness.enabled} annualAvailable={catalog.annualAvailable} currentPlan={sub?.plan} busy={busy} owner={owner} onChoose={(plan,cycle)=>choose({kind:'subscription',plan,cycle})} onUpgrade={plan=>choose({kind:'upgrade',plan})} onDiscover={discover}/>)}
   {embedded&&tab!=='offers'&&!guest&&!summary?<p className={styles.compactNote} role="status">{refreshing?'Chargement des informations…':'Les informations de votre organisation sont indisponibles. Actualisez pour réessayer.'}</p>:<>
   {tab==='topup'&&(guest?<Guest href={signInHref} onSignIn={onSignIn}/>:embedded?<CompactRecharge catalog={catalog} priceLabel={priceLabel} quantity={quantity} setQuantity={setQuantity} available={summary?.wallet.available} busy={busy} owner={owner} onContinue={()=>choose({kind:'topup',quantity:Number(quantity)})}/>:<RechargeView packs={catalog.packs} priceLabel={priceLabel} quantity={quantity} setQuantity={setQuantity} available={summary?.wallet.available||0} busy={busy} canManage={owner} onContinue={()=>choose({kind:'topup',quantity:Number(quantity)})}/>)}
   {tab==='wallet'&&(guest?<Guest href={signInHref} onSignIn={onSignIn}/>:<CreditsView summary={summary} entries={entries} daily={daily} asOf={usageAsOf} restricted={usageRestricted} onTopup={()=>setTab('topup')}/>)}
   {tab==='history'&&(guest?<Guest href={signInHref} onSignIn={onSignIn}/>:embedded?<CompactPayments summary={summary} owner={owner} ready={catalog.readiness.enabled} busy={busy} onVerify={verifyOrder} onRefund={setRefund} onDownload={id=>void act(()=>download(id))}/>:<PaymentsView summary={summary} readiness={catalog.readiness.enabled} busy={busy} onVerify={verifyOrder} onStartRefund={id=>setRefund(id)} onSubmitRefund={submitRefund} onDownload={id=>void act(()=>download(id))} refund={refund} reason={reason} setReason={setReason} onCancelRefund={()=>setRefund('')}/>)}
   {embedded&&tab==='history'&&refund&&<form className={styles.compactRefund} onSubmit={event=>{event.preventDefault();submitRefund(refund);}}><h3>Demande de remboursement</h3><label>Motif<textarea minLength={10} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)} required/></label><p>La demande sera examinée avant toute action sur le paiement.</p><div className={styles.compactActions}><button type="submit" className="button primary" disabled={busy}>{busy?'Envoi…':'Envoyer la demande'}</button><button type="button" className="button secondary" disabled={busy} onClick={()=>setRefund('')}>Annuler</button></div></form>}
   {tab==='team'&&(guest?<Guest href={signInHref} onSignIn={onSignIn}/>:<div className={embedded?styles.embeddedTeam:undefined}><TeamView org={org} available={summary?.wallet.available||0} reserved={summary?.wallet.reserved||0} spaceName={spaceName} setSpaceName={setSpaceName} email={email} setEmail={setEmail} role={role} setRole={setRole} spaces={spaces} setSpaces={setSpaces} inviteLink={inviteLink} scope={scope} setScope={setScope} scopeId={scopeId} setScopeId={setScopeId} limit={limit} setLimit={setLimit} busy={busy} onOrganizationAction={organizationAction} onViewPlans={()=>onBilling?onBilling('offers'):setTab('offers')} onSwitchWorkspace={id=>{localStorage.setItem('braand.workspace',id);location.assign(new URL(embedded?'/?settings=team':'/?view=billing',location.origin).href);}}/></div>)}
   </>}
  </>}
  {!embedded&&<footer className="billing-footer"><ShieldCheck size={16}/><span>Les achats Braand sont distincts des dépenses publicitaires, réglées directement à la plateforme concernée.</span></footer>}
  </>}
 </section>;
}
function Guest({href,onSignIn}:{href:string;onSignIn?:()=>void}){return <div className="billing-empty"><p>Connectez-vous pour retrouver votre forfait et vos crédits.</p>{onSignIn?<button type="button" className="button primary" onClick={onSignIn}>Se connecter<ArrowUpRight size={16}/></button>:<a className="button primary" href={href} target="_top">Se connecter<ArrowUpRight size={16}/></a>}</div>;}

function CompactOffers({catalog,priceLabel,currentPlan,busy,owner,guest,signInHref,onSignIn,onChoose,onUpgrade,onDiscover,onTeam}:{catalog:Catalog;priceLabel:string;currentPlan?:string;busy:boolean;owner:boolean;guest:boolean;signInHref:string;onSignIn?:()=>void;onChoose:(plan:PlanId,cycle:BillingCycle)=>void;onUpgrade:(plan:PlanId)=>void;onDiscover:()=>void;onTeam?:()=>void}){
 const carouselRef=useRef<HTMLDivElement>(null),carouselId=useId();
 const [navigation,setNavigation]=useState({previous:false,next:true});
 const [cycle,setCycle]=useState<BillingCycle>('period');
 const annualAvailable=catalog.annualAvailable===true&&PLAN_IDS.every(id=>catalog.plans[id].annualPrice!==null);
 const annual=cycle==='annual'&&annualAvailable;
 useEffect(()=>{
  const carousel=carouselRef.current;if(!carousel)return;
  const update=()=>{
   const previous=carousel.scrollLeft>2,next=carousel.scrollLeft<carousel.scrollWidth-carousel.clientWidth-2;
   setNavigation(current=>current.previous===previous&&current.next===next?current:{previous,next});
  };
  update();carousel.addEventListener('scroll',update,{passive:true});
  const observer=new ResizeObserver(update);observer.observe(carousel);
  return ()=>{carousel.removeEventListener('scroll',update);observer.disconnect();};
 },[]);
 const move=(direction:-1|1)=>{
  const carousel=carouselRef.current;if(!carousel)return;
  const cards=carousel.children,step=cards.length>1?(cards[1] as HTMLElement).offsetLeft-(cards[0] as HTMLElement).offsetLeft:carousel.clientWidth;
  carousel.scrollBy({left:direction*step,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 };
 return <div className={styles.compactStack}>
  <div className={styles.planToolbar}>
   <p className={styles.compactNote}>{annual?'Pour 12 mois':'Pour 30 jours'} · {priceLabel}</p>
   <div className={styles.planActions}>
    <div className={styles.cycleSwitch} role="group" aria-label="Période du forfait">
     <button type="button" aria-pressed={!annual} onClick={()=>setCycle('period')}>Mensuel</button>
     <button type="button" aria-pressed={annual} disabled={!annualAvailable} aria-describedby={!annualAvailable?`${carouselId}-annual-note`:undefined} onClick={()=>setCycle('annual')}>Annuel</button>
    </div>
    <div className={styles.planControls}>
     <button type="button" aria-label="Forfaits précédents" aria-controls={carouselId} disabled={!navigation.previous} onClick={()=>move(-1)}><ChevronLeft size={18}/></button>
     <button type="button" aria-label="Forfaits suivants" aria-controls={carouselId} disabled={!navigation.next} onClick={()=>move(1)}><ChevronRight size={18}/></button>
    </div>
   </div>
  </div>
  {!annualAvailable&&<p id={`${carouselId}-annual-note`} className={styles.compactNote}>Les forfaits annuels sont actuellement indisponibles.</p>}
  {annual&&<p className={styles.compactNote}>2 mensualités offertes · paiement annuel unique. Les crédits sont renouvelés chaque mois et expirent à la fin de chaque mois d’abonnement.</p>}
  {guest&&<Guest href={signInHref} onSignIn={onSignIn}/>}
  <div ref={carouselRef} id={carouselId} className={styles.compactPlans} role="region" aria-label="Forfaits disponibles" aria-roledescription="carrousel" tabIndex={0} onKeyDown={event=>{
   if(event.target!==event.currentTarget)return;
   if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}
   if(event.key==='Home'||event.key==='End'){event.preventDefault();event.currentTarget.scrollTo({left:event.key==='Home'?0:event.currentTarget.scrollWidth,behavior:'auto'});}
  }} onFocusCapture={event=>{
   const carousel=event.currentTarget,card=(event.target as HTMLElement).closest('article');if(!card)return;
   if(card.offsetLeft<carousel.scrollLeft||card.offsetLeft+card.offsetWidth>carousel.scrollLeft+carousel.clientWidth)carousel.scrollTo({left:card.offsetLeft,behavior:'auto'});
  }}>{PLAN_IDS.map(id=>{const plan=catalog.plans[id],current=currentPlan===id;return <article key={id} className={styles.compactPlan}><header><h3>{plan.name}</h3>{current&&<span className={styles.currentPlan}>Actuel</span>}</header><p className={styles.compactPrice}><strong>{money(annual?plan.annualPrice!:plan.periodPrice)}</strong><span>{annual?'pour 12 mois':'pour 30 jours'}</span></p><dl><div><dt>Crédits</dt><dd>{number(plan.credits)} / {annual?'mois':'30 jours'}</dd></div><div><dt>Membres</dt><dd>{number(plan.members)}</dd></div><div><dt>Marques</dt><dd>{number(plan.spaces)}</dd></div><div><dt>Projets</dt><dd>{number(plan.projects)}</dd></div><div><dt>Stockage</dt><dd>{number(plan.storage/1024**3)} Go</dd></div></dl><button type="button" className={'button '+(id==='business'?'primary':'secondary')} disabled={busy||!owner||!catalog.readiness.enabled} onClick={()=>onChoose(id,annual?'annual':'period')}>{busy?'Préparation…':(current?'Renouveler ':'Choisir ')+plan.name}<ArrowUpRight size={15}/></button>{currentPlan&&PLAN_IDS.includes(currentPlan as PlanId)&&PLAN_IDS.indexOf(id)>PLAN_IDS.indexOf(currentPlan as PlanId)&&<button type="button" className={'button secondary '+styles.upgradeButton} disabled={busy||!owner||!catalog.readiness.enabled} onClick={()=>onUpgrade(id)}>Passer à {plan.name} maintenant<span>Voir le prorata</span></button>}<details className={styles.planDetails}><summary>Autres limites</summary><p>{number(plan.transfer/1024**3)} Go de transfert sur 30 jours · {number(plan.concurrency)} opération{plan.concurrency>1?'s':''} simultanée{plan.concurrency>1?'s':''}.</p><p>{id==='essential'?'Navigateur cloud et missions autonomes à partir de Pro.':'Navigateur cloud et missions autonomes sous plafond approuvé, selon leur disponibilité.'}</p></details></article>;})}</div>
  {!guest&&!owner&&<p className={styles.compactNote}>Seul le propriétaire peut gérer les paiements.</p>}
  <p className={styles.compactNote}>Un seul solde pour la conversation, les créations, les outils et les missions. Les petits appels utilisent des fractions de crédit. Les crédits du forfait expirent à la fin de la période.</p>
  <p className={styles.compactNote}>Renouvellement volontaire, sans prélèvement automatique. Les dépenses publicitaires sont réglées séparément à leur plateforme.</p>
  <div className={styles.discoveryRow}><div><h3>Découverte</h3><p>{number(catalog.free.credits)} crédits offerts à l’inscription, une seule fois, valables {catalog.free.days} jours.</p></div><button type="button" className="button secondary" disabled={busy||!guest&&(!catalog.free.enabled||!owner)} onClick={onDiscover}>{guest?'Créer mon compte':catalog.free.enabled?'Activer':'Offerts à l’inscription'}</button></div>
  {onTeam&&<button type="button" className={'button secondary '+styles.teamLink} onClick={onTeam}>Gérer mon équipe<ArrowUpRight size={15}/></button>}
 </div>;
}

function CompactRecharge({catalog,priceLabel,quantity,setQuantity,available,busy,owner,onContinue}:{catalog:Catalog;priceLabel:string;quantity:string;setQuantity:(value:string)=>void;available?:number;busy:boolean;owner:boolean;onContinue:()=>void}){
 const selected=Number(quantity),pack=catalog.packs.find(item=>item.quantity===selected),valid=!!pack;
 return <form className={styles.compactStack} onSubmit={event=>{event.preventDefault();if(valid&&owner&&catalog.readiness.enabled)onContinue();}}>
  <div className={styles.compactSummary}><span>Crédits disponibles</span><strong>{available===undefined?'Indisponible':number(available)+' crédits'}</strong></div>
  <fieldset className={styles.packChoices}><legend>Choisir une recharge · {priceLabel}</legend>{catalog.packs.map(item=><button type="button" key={item.quantity} aria-pressed={selected===item.quantity} onClick={()=>setQuantity(String(item.quantity))}><strong>{number(item.quantity)} crédits</strong><span>{money(item.amount)}</span></button>)}</fieldset>
  <div className={styles.compactSummary}><span>Montant avant récapitulatif</span><strong>{pack?money(pack.amount):'Choisissez un pack'}</strong></div>
  <button type="submit" className={'button primary '+styles.fullButton} disabled={busy||!owner||!valid||!catalog.readiness.enabled}>{busy?'Préparation…':'Vérifier le récapitulatif'}<ArrowUpRight size={15}/></button>
  {!owner&&<p className={styles.compactNote}>Seul le propriétaire peut créer une commande de paiement.</p>}
  <p className={styles.compactNote}>Les taxes et le total final seront présentés avant votre accord. Les moyens de paiement disponibles seront affichés au règlement.</p>
  <p className={styles.compactNote}>Les recharges n’expirent pas pendant la vie du service. Elles ne prolongent pas votre abonnement.</p>
 </form>;
}

function CompactPayments({summary,owner,ready,busy,onVerify,onRefund,onDownload}:{summary?:Summary;owner:boolean;ready:boolean;busy:boolean;onVerify:(id:string)=>void;onRefund:(id:string)=>void;onDownload:(id:string)=>void}){
 const [filter,setFilter]=useState('all'),orders=summary?.orders||[],sub=summary?.subscription;
 const visible=orders.filter(order=>filter==='all'||(filter==='paid'?['fulfilled','refunded','partially_refunded'].includes(order.status):filter==='pending'?['pending','verified','initializing','needs_reconciliation'].includes(order.status):['failed','expired','cancelled'].includes(order.status)));
 return <div className={styles.compactStack}>
  <dl className={styles.compactList}><div><dt>Forfait en cours</dt><dd>{sub?planName(sub.plan):'Aucun forfait actif'}</dd></div>{sub&&<><div><dt>Période</dt><dd>{sub.cycle==='annual'?'12 mois':'30 jours'}</dd></div><div><dt>Valable jusqu’au</dt><dd>{new Date(sub.end_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</dd></div></>}<div><dt>Paiement</dt><dd>{ready?'Paiement sécurisé':'Paiements indisponibles'}</dd></div></dl>
  <p className={styles.compactNote}>Renouvellement volontaire, sans prélèvement automatique.</p>
  {!owner?<p className={styles.compactNote}>Les paiements et les documents sont accessibles au propriétaire de l’organisation.</p>:<>
   <section className={styles.compactStack}><div className={styles.listHeading}><h3>Historique des paiements</h3><span>{orders.length} commande{orders.length>1?'s':''}</span></div><div className={styles.paymentFilters} role="group" aria-label="Filtrer les paiements">{[['all','Tous'],['paid','Payés'],['pending','En attente'],['failed','Échoués']].map(([id,label])=><button type="button" key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    {!visible.length?<p className={styles.compactNote}>{orders.length?'Aucun paiement dans cette catégorie.':'Aucun paiement enregistré. Le statut sera confirmé après vérification du paiement.'}</p>:<ul className={styles.paymentRows}>{visible.map(order=>{let product:Record<string,unknown>={};try{product=typeof order.product==='string'?JSON.parse(order.product):order.product;}catch{}const title=product?.kind==='topup'?'Recharge · '+number(Number(product.quantity)||0)+' crédits':product?.kind==='subscription'?'Forfait '+planName(product.plan):product?.kind==='upgrade'?'Passage à '+planName(product.plan||'business'):'Commande Braand';return <li key={order.id}><div className={styles.paymentRow}><div><strong>{title}</strong><span>{new Date(order.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'})}</span></div><div><strong>{number(order.amount)} {order.currency&&order.currency!=='XAF'?order.currency:'FCFA'}</strong><span>{statuses[order.status]||({cancelled:'Annulée',partially_refunded:'Partiellement remboursée'} as Record<string,string>)[order.status]||order.status}</span></div></div>{['pending','verified','needs_reconciliation'].includes(order.status)&&<button type="button" className="button secondary" disabled={busy} onClick={()=>onVerify(order.id)}>Vérifier le paiement</button>}{order.status==='fulfilled'&&<button type="button" className="button secondary" disabled={busy} onClick={()=>onRefund(order.id)}>Demander un remboursement</button>}</li>;})}</ul>}
   </section>
   <section className={styles.compactStack}><h3>Documents de paiement</h3>{!summary?.invoices.length?<p className={styles.compactNote}>Votre reçu sera disponible après confirmation du paiement.</p>:<ul className={styles.paymentRows}>{summary.invoices.map(invoice=><li key={invoice.id} className={styles.invoiceRow}><div><strong>{invoice.number}</strong>{invoice.created_at&&<span>{new Date(invoice.created_at).toLocaleDateString('fr-FR')}</span>}</div><button type="button" className="button secondary" disabled={busy} onClick={()=>onDownload(invoice.id)}><Download size={15}/>Télécharger</button></li>)}</ul>}</section>
  </>}
 </div>;
}
