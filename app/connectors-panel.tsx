"use client";

import {useCallback,useEffect,useId,useRef,useState} from "react";
import {AlertCircle,ArrowUpRight,CheckCircle2,ChevronDown,Link2,LoaderCircle,RefreshCw,Search,ShieldCheck,Unplug,Eye,SlidersHorizontal,X} from "lucide-react";
import {api,post} from "../lib/client-api";
import type {Resource} from "../lib/contracts";
import "./connectors.css";
import "../components/connector-catalog.css";

export type ConnectorToolkit={slug:string;name:string;description?:string;logo?:string;isNoAuth?:boolean;connected:boolean;status:string;accountId?:string};
type InstantSettings={enabled:boolean;monthlyLimitUsd:number;perCallLimitUsd:number;note:string};
type ToolkitPage={items:ConnectorToolkit[];nextCursor:string|null;configured:boolean;instant:InstantSettings};
type ConnectorsPanelProps={onChange?:()=>void;embedded?:boolean};
const dollars=(value:number)=>new Intl.NumberFormat("fr-FR",{style:"currency",currency:"USD",maximumFractionDigits:6}).format(value);
const amount=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0?dollars(value):"Non renseigné";
const errorMessage=(error:unknown)=>error instanceof Error?error.message:"Impossible de terminer cette opération. Réessayez.";
const normalizedStatus=(status:unknown)=>typeof status==="string"?status.toLowerCase():"";
const needsReauth=(item:ConnectorToolkit)=>/reauth|reconnect/.test(normalizedStatus(item.status))||!!item.accountId&&["expired","inactive","failed","revoked","invalid","disconnected"].includes(normalizedStatus(item.status));
const isPending=(item:ConnectorToolkit)=>["pending","initiated","initializing"].includes(normalizedStatus(item.status));
function connectionLabel(item:ConnectorToolkit){
 if(needsReauth(item))return "À reconnecter";
 if(isPending(item))return "Connexion en attente";
 if(item.connected)return "Connecté";
 if(item.isNoAuth)return "Sans compte requis";
 return "Non connecté";
}
function connectLink(value:unknown){
 if(typeof value!=="string")throw new Error("Le lien de connexion est indisponible. Réessayez.");
 let url:URL;try{url=new URL(value);}catch{throw new Error("Le lien de connexion reçu n’est pas valide. Réessayez.");}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=="https:"||url.username||url.password||url.port&&!['443'].includes(url.port)||!["composio.dev","composio.ai"].some(domain=>host===domain||host.endsWith("."+domain)))throw new Error("Le lien de connexion reçu n’est pas valide. Réessayez.");
 return url.href;
}
function ToolkitLogo({item}:{item:ConnectorToolkit}){
 const [failed,setFailed]=useState(false);
 let src:string|undefined;
 try{const url=new URL(item.logo||"");if(url.protocol==="https:"&&!url.username&&!url.password)src=url.href;}catch{}
 // Catalog logos come from runtime hosts; use their small originals without an image proxy.
 // eslint-disable-next-line @next/next/no-img-element
 return <span className="connector-logo" aria-hidden="true">{src&&!failed?<img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Link2 size={20}/>}</span>;
}

export function ConnectorsPanel({onChange,embedded=false}:ConnectorsPanelProps={}){
 const headingId=useId(),searchId=useId(),resultsId=useId(),detailId=useId();
 const [query,setQuery]=useState(""),[filter,setFilter]=useState<"available"|"connected">("available"),[items,setItems]=useState<ConnectorToolkit[]>([]),[nextCursor,setNextCursor]=useState<string|null>(null);
 const [configured,setConfigured]=useState<boolean|null>(null),[instant,setInstant]=useState<InstantSettings|null>(null);
 const [loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[catalogError,setCatalogError]=useState("");
 const [actionError,setActionError]=useState(""),[notice,setNotice]=useState(""),[busyToolkit,setBusyToolkit]=useState(""),[reload,setReload]=useState(0);
 const [authorizationLinks,setAuthorizationLinks]=useState<Record<string,string>>({}),[selected,setSelected]=useState<ConnectorToolkit|null>(null),[confirmDisconnect,setConfirmDisconnect]=useState(false);
 const generation=useRef(0),request=useRef<AbortController|null>(null),pendingAction=useRef(false),pendingPage=useRef(false),mounted=useRef(true),detailDialog=useRef<HTMLDialogElement|null>(null),returnFocus=useRef<HTMLElement|null>(null);
 const resetCatalog=()=>{generation.current++;request.current?.abort();pendingPage.current=false;setItems([]);setNextCursor(null);setCatalogError("");setLoading(true);setLoadingMore(false);};
 const refresh=()=>{resetCatalog();setReload(value=>value+1);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
 useEffect(()=>{
  const dialog=detailDialog.current;
  if(selected&&!dialog?.open)dialog?.showModal();
  if(!selected&&dialog?.open){dialog.close();if(returnFocus.current?.isConnected)returnFocus.current.focus();else document.getElementById(searchId)?.focus();}
 },[selected,searchId]);
 const load=useCallback(async(search:string,cursor:string|null,append:boolean,revision:number,connectedOnly:boolean)=>{
  if(generation.current!==revision)return;
  request.current?.abort();const controller=new AbortController();request.current=controller;pendingPage.current=true;
  if(append)setLoadingMore(true);else setLoading(true);
  setCatalogError("");
  try{
   const params=new URLSearchParams();if(search)params.set("search",search);if(cursor)params.set("cursor",cursor);if(connectedOnly)params.set("connected","true");
   const data=await api<ToolkitPage>("/api/connectors/toolkits"+(params.size?"?"+params.toString():""),{signal:controller.signal});
   if(controller.signal.aborted||!mounted.current||generation.current!==revision)return;
   if(!Array.isArray(data.items)||typeof data.configured!=="boolean")throw new Error("Le catalogue reçu est incomplet. Réessayez.");
   const page=data.items.filter(item=>item&&typeof item.slug==="string"&&typeof item.name==="string");
   setItems(previous=>{const all=append?[...previous,...page]:page;return [...new Map(all.map(item=>[item.slug,item])).values()];});
   setNextCursor(typeof data.nextCursor==="string"&&data.nextCursor&&data.nextCursor!==cursor?data.nextCursor:null);
   setConfigured(data.configured);setInstant(data.instant||null);
   setSelected(previous=>previous?page.find(item=>item.slug===previous.slug)||previous:null);
   setAuthorizationLinks(previous=>{const next={...previous};for(const item of page)if(item.connected&&!needsReauth(item))delete next[item.slug];return next;});
  }catch(error){if(!controller.signal.aborted&&mounted.current&&generation.current===revision)setCatalogError(errorMessage(error));}
  finally{if(mounted.current&&generation.current===revision){pendingPage.current=false;setLoading(false);setLoadingMore(false);}}
 },[]);
 useEffect(()=>{
  const revision=++generation.current;request.current?.abort();pendingPage.current=false;
  const timer=window.setTimeout(()=>void load(query.trim(),null,false,revision,filter==="connected"),query?250:0);
  return()=>{window.clearTimeout(timer);request.current?.abort();};
 },[query,filter,reload,load]);
 const changeQuery=(value:string)=>{resetCatalog();setQuery(value);};
 const changeFilter=(value:typeof filter)=>{if(value===filter)return;resetCatalog();setFilter(value);};
 const more=()=>{if(loading||loadingMore||pendingPage.current||!nextCursor)return;void load(query.trim(),nextCursor,true,generation.current,filter==="connected");};
 const openDetail=(item:ConnectorToolkit,trigger:HTMLElement)=>{returnFocus.current=trigger;setActionError("");setConfirmDisconnect(false);setSelected(item);};
 const verifyConnection=(item:ConnectorToolkit)=>{setSelected(null);setFilter("available");setQuery(item.name);setNotice("Consultez l’état de "+item.name+" dans les résultats actualisés.");refresh();};
 const connect=async(item:ConnectorToolkit)=>{
  if(pendingAction.current)return;pendingAction.current=true;setBusyToolkit(item.slug);setActionError("");setNotice("");
  try{const result=await api<{redirectUrl:string}>("/api/connectors/authorize",post({toolkit:item.slug}));const url=connectLink(result.redirectUrl);if(mounted.current){setAuthorizationLinks(previous=>({...previous,[item.slug]:url}));setNotice("Lien de connexion préparé pour "+item.name+". Cliquez sur Autoriser, puis actualisez les connexions à votre retour.");}}
  catch(error){if(mounted.current)setActionError(errorMessage(error));}
  finally{pendingAction.current=false;if(mounted.current)setBusyToolkit("");}
 };
 const disconnect=async(item:ConnectorToolkit)=>{
  if(!item.accountId||!confirmDisconnect||pendingAction.current)return;pendingAction.current=true;setBusyToolkit(item.slug);setActionError("");setNotice("");
  try{await api("/api/connectors/accounts/"+encodeURIComponent(item.accountId),{method:"DELETE"});if(mounted.current){setAuthorizationLinks(previous=>{const next={...previous};delete next[item.slug];return next;});setNotice("Connexion à "+item.name+" retirée de cet espace.");setSelected(null);setConfirmDisconnect(false);refresh();onChange?.();}}
  catch(error){if(mounted.current)setActionError(errorMessage(error));}
  finally{pendingAction.current=false;if(mounted.current)setBusyToolkit("");}
 };
 const featured=filter==="available"&&!query.trim()?items.filter(item=>!item.connected&&!item.isNoAuth).slice(0,3):[];
 const detailLink=selected&&authorizationLinks[selected.slug];
 return <section className={"connectors-panel connector-catalog"+(embedded?" connector-catalog-embedded":"")} aria-labelledby={headingId}>
  <header className={embedded?"connector-catalog-tools":"connectors-heading"}><div className={embedded?"connector-sr-only":undefined}><h3 id={headingId}>Vos applications</h3><p>Retrouvez les outils du catalogue et les connexions de cet espace.</p></div><button type="button" className="connector-button connector-icon-button" onClick={refresh} disabled={loading||loadingMore||!!busyToolkit} aria-label="Actualiser les connexions" title="Actualiser les connexions"><RefreshCw size={16}/></button></header>
  <div className="connectors-search"><Search size={18} aria-hidden="true"/><label className="connector-sr-only" htmlFor={searchId}>Rechercher une application</label><input id={searchId} type="search" value={query} onChange={event=>changeQuery(event.target.value)} placeholder="Rechercher" autoComplete="off" aria-controls={resultsId}/>{query&&<button type="button" aria-label="Effacer la recherche" onClick={()=>changeQuery("")}><X size={16}/></button>}</div>
  <div className="connector-segments" role="group" aria-label="Afficher les applications"><button type="button" aria-pressed={filter==="available"} onClick={()=>changeFilter("available")}>Disponible</button><button type="button" aria-pressed={filter==="connected"} onClick={()=>changeFilter("connected")}>Connecté</button></div>
  {configured===false&&<div className="connector-note"><ShieldCheck size={18} aria-hidden="true"/><div><strong>Connexions indisponibles</strong><p>Les connexions ne sont pas encore activées dans cet espace. Votre administrateur peut activer le service pour rendre le catalogue et les connexions disponibles.</p></div></div>}
  {actionError&&!selected&&<p className="connector-error" role="alert"><AlertCircle size={17} aria-hidden="true"/>{actionError}</p>}
  <p className="connector-sr-only" role="status" aria-live="polite" aria-atomic="true">{loading?"Chargement du catalogue…":loadingMore?"Chargement d’autres applications…":items.length+" application"+(items.length>1?"s":"")+" affichée"+(items.length>1?"s":"")+"."}</p>
  {notice&&!selected&&<p className="connector-notice" role="status"><CheckCircle2 size={17} aria-hidden="true"/>{notice}</p>}
  <div id={resultsId} className="connectors-results" aria-busy={loading||loadingMore}>
   {loading?<div className="connectors-skeleton" aria-hidden="true">{[0,1,2].map(index=><div className="connector-skeleton-row" key={index}><span/><div><i/><i/></div></div>)}</div>:items.length>0?<>
    {featured.length>0&&<section className="connector-discover" aria-label="À découvrir"><h4>À découvrir</h4><div className="connector-featured">{featured.map(item=><button type="button" className="connector-feature" key={item.slug} onClick={event=>openDetail(item,event.currentTarget)} aria-label={"Découvrir "+item.name}><ToolkitLogo item={item}/><strong>{item.name}</strong><span>{item.description||"Reliez votre compte pour utiliser cette application avec Braand."}</span></button>)}</div></section>}
    <h4 className="connector-section-title">{filter==="connected"?"Vos connexions":"Toutes les applications"}</h4>
    <ul className="connector-catalog-list">{items.map(item=><li key={item.slug}><button type="button" className="connector-catalog-row" onClick={event=>openDetail(item,event.currentTarget)} aria-label={(item.connected||item.isNoAuth?"Voir ":"Activer ")+item.name}><ToolkitLogo item={item}/><span className="connector-row-copy"><strong>{item.name}</strong>{(item.connected||needsReauth(item)||isPending(item)||item.isNoAuth)&&<span className={"connector-status "+(needsReauth(item)?"attention":item.connected?"connected":"")}>{connectionLabel(item)}</span>}</span><span className="connector-row-action">{item.connected||item.isNoAuth?"Voir":needsReauth(item)?"Reconnecter":"Activer"}</span></button></li>)}</ul>
   </>:!catalogError&&configured!==false?<div className="connectors-empty"><Search size={24} aria-hidden="true"/><strong>{query?"Aucune application trouvée":filter==="connected"?"Aucune application connectée":"Aucune application disponible"}</strong><p>{query?"Essayez le nom d’une autre application.":filter==="connected"?"Choisissez une application dans l’onglet Disponible pour connecter votre compte.":"Actualisez le catalogue pour réessayer."}</p>{query&&<button type="button" className="connector-button" onClick={()=>changeQuery("")}>Effacer la recherche</button>}</div>:null}
  </div>
  {catalogError&&<div className="connector-error" role="alert"><AlertCircle size={17} aria-hidden="true"/><div><p>{catalogError}</p><button type="button" className="connector-button" onClick={()=>items.length&&nextCursor?more():refresh()} disabled={loading||loadingMore}><RefreshCw size={14} aria-hidden="true"/>Réessayer</button></div></div>}
  {nextCursor&&!loading&&!catalogError&&<button type="button" className="connector-button connectors-more" onClick={more} disabled={loadingMore}>{loadingMore?<LoaderCircle size={15} className="connector-spin" aria-hidden="true"/>:<ChevronDown size={15} aria-hidden="true"/>}{loadingMore?"Chargement…":"Afficher d’autres applications"}</button>}
  {instant&&<details className="connectors-instant"><summary>Outils Instant <span>{instant.enabled?"Activés":"Désactivés"}</span></summary><p>{instant.note||"Ces limites sont définies par l’administrateur de cet hébergement."}</p><dl><div><dt>Plafond mensuel</dt><dd>{amount(instant.monthlyLimitUsd)}</dd></div><div><dt>Plafond par appel</dt><dd>{amount(instant.perCallLimitUsd)}</dd></div></dl></details>}
  <p className="connectors-footer"><ShieldCheck size={16} aria-hidden="true"/><span>Braand utilise les connexions de cet espace. Les actions qui modifient une application et les appels Instant payants demandent votre validation.</span></p>
  <dialog ref={detailDialog} className="connector-detail" aria-labelledby={detailId} onCancel={event=>{event.stopPropagation();event.preventDefault();setSelected(null);}} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)setSelected(null);}}>
   {selected&&<div className="connector-detail-body"><button type="button" className="connector-detail-close" aria-label="Fermer la fiche de l’application" onClick={()=>setSelected(null)}><X size={20}/></button><header className="connector-detail-heading"><ToolkitLogo item={selected}/><h3 id={detailId}>{selected.name}</h3><p>{selected.description||"Connectez votre application pour retrouver ses outils dans vos discussions avec Braand."}</p><span className={"connector-status "+(needsReauth(selected)?"attention":selected.connected?"connected":"")}>{connectionLabel(selected)}</span></header>
    <div className="connector-explanations"><div><Link2 size={22} aria-hidden="true"/><div><strong>Votre compte, dans cet espace</strong><p>{selected.isNoAuth?"Cette application ne nécessite pas de compte connecté. Les appels restent soumis aux règles de Braand.":"Choisissez le compte et vérifiez les accès demandés dans la fenêtre d’autorisation."}</p></div></div><div><SlidersHorizontal size={22} aria-hidden="true"/><div><strong>Vous validez les actions sensibles</strong><p>Braand demande votre accord avant une action qui modifie une application ou un appel Instant payant, avec les paramètres à vérifier.</p></div></div><div><Eye size={22} aria-hidden="true"/><div><strong>Gardez un œil sur l’activité</strong><p>Consultez les actions dans votre discussion. Vous pouvez retirer cette connexion depuis cette fiche.</p></div></div></div>
    {actionError&&<p className="connector-error" role="alert"><AlertCircle size={17} aria-hidden="true"/>{actionError}</p>}
    {detailLink&&<div className="connector-auth-ready"><p role="status">Votre lien est prêt. L’autorisation s’ouvre dans un nouvel onglet.</p><a className="connector-button connector-primary" href={detailLink} target="_blank" rel="noopener noreferrer">Autoriser {selected.name}<ArrowUpRight size={16} aria-hidden="true"/></a><button type="button" className="connector-button" onClick={()=>verifyConnection(selected)} disabled={loading||!!busyToolkit}><RefreshCw size={16} aria-hidden="true"/>Actualiser après la connexion</button></div>}
    {(!selected.isNoAuth||needsReauth(selected))&&(!selected.connected||needsReauth(selected))&&<button type="button" className={"connector-button connector-detail-connect "+(!detailLink?"connector-primary":"")} disabled={!configured||!!busyToolkit} onClick={()=>void connect(selected)}>{busyToolkit===selected.slug?<LoaderCircle size={16} className="connector-spin" aria-hidden="true"/>:null}{busyToolkit===selected.slug?"Préparation…":detailLink||isPending(selected)?"Générer un nouveau lien":needsReauth(selected)?"Reconnecter":"Connecter"}</button>}
    {selected.accountId&&(confirmDisconnect?<div className="connector-disconnect-confirm"><p>Retirer la connexion à {selected.name} de cet espace ? Braand ne pourra plus utiliser ce compte.</p><div><button type="button" className="connector-button connector-disconnect" disabled={!!busyToolkit} onClick={()=>void disconnect(selected)}>{busyToolkit?"Déconnexion…":"Confirmer la déconnexion"}</button><button type="button" className="connector-button" disabled={!!busyToolkit} onClick={()=>setConfirmDisconnect(false)}>Annuler</button></div></div>:<button type="button" className="connector-button connector-disconnect" disabled={!!busyToolkit} onClick={()=>setConfirmDisconnect(true)}><Unplug size={16} aria-hidden="true"/>Déconnecter {selected.name}</button>)}
    <p className="connector-detail-footnote">Se connecter n’autorise aucune dépense. Les accès effectivement accordés dépendent de votre compte et de l’autorisation fournie.</p>
   </div>}
  </dialog>
 </section>;
}

const approvalLabels:Record<string,string>={awaiting_approval:"À valider",pending:"À valider",approved:"Approuvée",executing:"Exécution en cours",running:"Exécution en cours",completed:"Effectuée",succeeded:"Effectuée",success:"Effectuée",rejected:"Refusée",cancelled:"Annulée",expired:"Expirée",failed:"Échec",uncertain:"État à vérifier",needs_input:"Informations requises",unknown:"État à vérifier"};
export function ConnectorApproval({resource,onUpdated}:{resource:Resource;onUpdated?:(resource:Resource)=>void|Promise<void>}){
 return <ConnectorApprovalContent key={resource.id+":"+resource.version+":"+resource.status+":"+resource.data?.status} resource={resource} onUpdated={onUpdated}/>;
}
function ConnectorApprovalContent({resource,onUpdated}:{resource:Resource;onUpdated?:(resource:Resource)=>void|Promise<void>}){
 const headingId=useId(),argumentsId=useId(),blockedId=useId(),resultId=useId();
 const [current,setCurrent]=useState(resource),[busy,setBusy]=useState<"approve"|"reject"|null>(null),[error,setError]=useState("");
 const pending=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const data=current.data||{},status=normalizedStatus(data.status||current.status),awaiting=["awaiting_approval","pending"].includes(status);
 const price=typeof data.priceUsd==='number'?data.priceUsd:NaN,maxCredits=typeof data.maxCredits==='number'?data.maxCredits:NaN;
 const instant=data.mode==="instant",knownPrice=Number.isFinite(price)&&price>=0;
 const knownCredits=Number.isFinite(maxCredits)&&maxCredits>=0;
 const finalStatus=["completed","succeeded","success","rejected","cancelled","expired","failed","uncertain"].includes(status);
 const expiry=typeof data.expiresAt==="number"&&Number.isFinite(data.expiresAt)?new Date(data.expiresAt):null;
 const validExpiry=expiry&&!Number.isNaN(expiry.getTime());
 let exact:string|undefined;try{exact=JSON.stringify(data.arguments,null,2);}catch{}
 let resultJSON:string|undefined;try{resultJSON=JSON.stringify(data.result,null,2);}catch{}
 const missingArguments=exact===undefined,blocked=instant&&(!knownPrice||!knownCredits)||missingArguments;
 const decide=async(decision:"approve"|"reject")=>{
  if(pending.current||!awaiting||decision==="approve"&&blocked)return;
  pending.current=true;setBusy(decision);setError("");
  try{const result=await api<Resource>("/api/connectors/approvals/"+encodeURIComponent(current.id),post({decision}));if(mounted.current){setCurrent(result);await onUpdated?.(result);}}
  catch(error){if(mounted.current)setError(errorMessage(error));}
  finally{pending.current=false;if(mounted.current)setBusy(null);}
 };
 return <section className="connector-approval" aria-labelledby={headingId} aria-busy={!!busy}>
  <header><h3 id={headingId}>{awaiting?"Action externe à valider":"Action externe"}</h3><span className={"connector-status "+(["failed","uncertain"].includes(status)?"attention":"")} role="status">{approvalLabels[status]||status||"État à vérifier"}</span></header>
  <p>{awaiting?"Vérifiez l’application, l’action et ses paramètres avant de donner votre accord.":"Les paramètres ci-dessous décrivent cette demande et son état enregistré."}</p>
  <dl className="connector-approval-details"><div><dt>Application</dt><dd>{typeof data.toolkit==='string'&&data.toolkit||"Non renseignée"}</dd></div><div><dt>Action</dt><dd>{typeof data.toolSlug==='string'&&data.toolSlug||"Non renseignée"}</dd></div><div><dt>Mode</dt><dd>{instant?"Outil Instant":"Connexion de cet espace"}</dd></div><div><dt>Connexion choisie</dt><dd>{typeof data.accountId==="string"&&data.accountId?data.accountId:instant?"Compte de service Instant":"Sans compte requis"}</dd></div>{(instant||knownPrice)&&<div><dt>Plafond de l’appel</dt><dd><strong>{knownPrice?dollars(price):"Inconnu"}</strong></dd></div>}{instant&&<div><dt>Plafond Braand</dt><dd><strong>{knownCredits?new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2}).format(maxCredits)+" crédits":"Inconnu"}</strong></dd></div>}<div><dt>Expiration de la demande (heure locale)</dt><dd>{validExpiry?<time dateTime={expiry.toISOString()}>{expiry.toLocaleString("fr-FR",{dateStyle:"medium",timeStyle:"short"})}</time>:"Non renseignée"}</dd></div><div><dt>Version de la demande</dt><dd>{current.version}</dd></div></dl>
  {instant&&<p className="connector-approval-footnote">Ces montants sont des plafonds autorisés. La consommation réelle peut être inférieure.</p>}
  <div className="connector-exact-arguments"><h4 id={argumentsId}>Paramètres exacts</h4><pre tabIndex={0} aria-labelledby={argumentsId}>{exact??"Paramètres indisponibles."}</pre></div>
  {awaiting&&blocked&&<p id={blockedId} className="connector-note"><ShieldCheck size={17} aria-hidden="true"/><span>{missingArguments?"L’approbation est bloquée : les paramètres exacts sont manquants.":!knownPrice?"L’approbation est bloquée : le prix de cet outil Instant n’est pas vérifié.":"L’approbation est bloquée : le plafond de crédits Braand n’est pas vérifié."}</span></p>}
  {status==="uncertain"&&<p className="connector-note" role="status"><AlertCircle size={17} aria-hidden="true"/><span>Le résultat ou le coût de cette action n’a pas pu être confirmé. L’action peut avoir eu lieu. Braand ne la relance pas, pour éviter un doublon. Vérifiez son résultat dans l’application concernée avant de préparer une nouvelle demande.</span></p>}
  {finalStatus&&resultJSON!==undefined&&<div className="connector-exact-arguments"><h4 id={resultId}>Résultat enregistré</h4><pre tabIndex={0} aria-labelledby={resultId}>{resultJSON}</pre></div>}
  {error&&<p className="connector-error" role="alert"><AlertCircle size={17} aria-hidden="true"/>{error}</p>}
  {awaiting?<><div className="connector-approval-actions"><button type="button" className="connector-button connector-primary" onClick={()=>void decide("approve")} disabled={!!busy||blocked} aria-describedby={blocked?blockedId:undefined}>{busy==="approve"?<LoaderCircle className="connector-spin" size={16} aria-hidden="true"/>:<CheckCircle2 size={16} aria-hidden="true"/>}{busy==="approve"?"Exécution…":"Autoriser l’action"}</button><button type="button" className="connector-button" onClick={()=>void decide("reject")} disabled={!!busy}>{busy==="reject"?<LoaderCircle className="connector-spin" size={16} aria-hidden="true"/>:<X size={16} aria-hidden="true"/>}{busy==="reject"?"Refus en cours…":"Refuser"}</button></div><p className="connector-approval-footnote">Votre validation porte sur cette demande et les paramètres affichés.</p></>:<p className="connector-approval-footnote">{["completed","succeeded","success"].includes(status)?"Cette action a été effectuée.":status==="rejected"?"Cette demande a été refusée.":"Cette demande ne peut plus être approuvée ici. Son état est indiqué ci-dessus."}</p>}
 </section>;
}

export default ConnectorsPanel;
