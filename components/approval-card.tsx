"use client";
// One approval card for every action Braand wants to take outside the app,
// shown in the conversation: a plain question, the details (open the first
// time), the exact content that will be sent, Autoriser / Refuser. Once
// decided it folds into a single line that stays readable in the history.
import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {ChevronDown,Globe2,LoaderCircle,PlugZap} from "lucide-react";
import {api,post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import type {BrowserActionDTO,BrowserSessionDTO} from "@/lib/browser-contracts";
import "./approval-card.css";

export type ApprovalField={label:string;value:string};
type Outcome={tone:"done"|"refused"|"warning"|"running";label:string};
type CardProps={icon:ReactNode;title:string;summary?:string;fields:ApprovalField[];content?:{label:string;text:string};exact?:string;
 outcome?:Outcome|null;busy?:"approve"|"reject"|null;error?:string;blockedNote?:string;expiresAt?:number;onApprove:()=>void;onReject:()=>void};

export function ApprovalCard({icon,title,summary,fields,content,exact,outcome,busy,error,blockedNote,expiresAt,onApprove,onReject}:CardProps){
 const titleId=useId(),[open,setOpen]=useState(()=>!outcome&&!(expiresAt&&expiresAt<=Date.now()));
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{if(outcome||!expiresAt)return;const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[outcome,expiresAt]);
 const expired=!outcome&&!!expiresAt&&expiresAt<=now;
 const shown:Outcome|null=outcome||(expired?{tone:"warning",label:"Demande expirée"}:null);
 return <section className="approval-card" data-state={shown?shown.tone:"pending"} aria-labelledby={titleId} aria-busy={!!busy}>
  <header className="approval-head"><span className="approval-icon" aria-hidden="true">{icon}</span><h3 id={titleId}>{title}</h3>{shown&&<span className="approval-outcome" role="status">{shown.label}</span>}</header>
  <div className="approval-body" data-open={open||undefined}>
   <button type="button" className="approval-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
    <span className="approval-summary">{summary||"Détails de la demande"}</span><ChevronDown size={18} aria-hidden="true"/>
   </button>
   {open&&<div className="approval-details">
    {fields.length>0&&<dl>{fields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
    {content&&<div className="approval-content"><strong>{content.label}</strong><p>{content.text}</p></div>}
    {exact&&<details className="approval-exact"><summary>Paramètres exacts</summary><pre tabIndex={0}>{exact}</pre></details>}
   </div>}
  </div>
  {!shown&&blockedNote&&<p className="approval-note" role="note">{blockedNote}</p>}
  {error&&<p className="approval-error" role="alert">{error}</p>}
  {!shown&&<div className="approval-actions">
   <button type="button" className="approval-approve" disabled={!!busy||!!blockedNote} onClick={onApprove}>{busy==="approve"&&<LoaderCircle size={16} className="approval-spin" aria-hidden="true"/>}{busy==="approve"?"Exécution…":"Autoriser"}</button>
   <button type="button" className="approval-reject" disabled={!!busy} onClick={onReject}>{busy==="reject"?"Refus…":"Refuser"}</button>
  </div>}
 </section>;
}

const text=(value:unknown)=>typeof value==="string"?value:"";
const errorText=(error:unknown)=>error instanceof Error?error.message:"La décision n’a pas pu être enregistrée. Réessayez.";
const appName=(slug:string)=>({facebook:"Facebook",instagram:"Instagram",linkedin:"LinkedIn",gmail:"Gmail",googlesheets:"Google Sheets",googledrive:"Google Drive",googlecalendar:"Google Agenda",googledocs:"Google Docs",slack:"Slack",notion:"Notion",whatsapp:"WhatsApp",twitter:"X",tiktok:"TikTok",hubspot:"HubSpot",shopify:"Shopify",outlook:"Outlook"} as Record<string,string>)[slug.toLowerCase()]||slug.replace(/[_-]+/g," ").replace(/\b\w/g,letter=>letter.toUpperCase());
const VERBS:[RegExp,string][]=[[/REPLY/,"publier cette réponse"],[/COMMENT/,"publier ce commentaire"],[/SEND|EMAIL|MESSAGE/,"envoyer ce message"],[/DELETE|REMOVE/,"supprimer cet élément"],[/UPDATE|EDIT|PATCH/,"modifier cet élément"],[/POST|PUBLISH|SHARE/,"publier ce contenu"],[/CREATE|ADD|INSERT|APPEND/,"ajouter cet élément"],[/UPLOAD/,"envoyer ce fichier"]];
/** « Autoriser Braand à publier ce commentaire sur Facebook ? » from the tool slug. */
const verbOf=(toolSlug:string)=>VERBS.find(([pattern])=>pattern.test(toolSlug.toUpperCase()))?.[1]||"effectuer cette action";
export function connectorQuestion(toolkit:string,toolSlug:string){return `Autoriser Braand à ${verbOf(toolSlug)} sur ${appName(toolkit)} ?`;}
/** « Publier ce commentaire (Facebook) » rather than the provider's English slug. */
export const connectorActionLabel=(toolkit:string,toolSlug:string)=>{const verb=verbOf(toolSlug);return verb.charAt(0).toUpperCase()+verb.slice(1)+" ("+appName(toolkit)+")";};
const TEXT_KEYS=["message","text","body","content","comment","caption","reply","description","subject","title"];
const keyLabel=(key:string)=>({post_id:"Publication",object_id:"Publication",page_id:"Page",to:"Destinataire",recipient:"Destinataire",recipient_email:"Destinataire",channel:"Canal",spreadsheet_id:"Feuille",url:"Lien",link:"Lien"} as Record<string,string>)[key.toLowerCase()]||key.replace(/[_-]+/g," ").replace(/^\w/,letter=>letter.toUpperCase());
/** The text that will be published, and the other simple parameters as lines. */
export function connectorContent(args:Record<string,unknown>){
 const textKey=TEXT_KEYS.find(key=>typeof args[key]==="string"&&String(args[key]).trim());
 const fields:ApprovalField[]=Object.entries(args).filter(([key,value])=>key!==textKey&&["string","number","boolean"].includes(typeof value)&&String(value).length<=200).slice(0,5).map(([key,value])=>({label:keyLabel(key),value:String(value)}));
 return {fields,content:textKey?{label:textKey==="subject"||textKey==="title"?"Titre":"Texte exact",text:String(args[textKey])}:undefined};
}

const CONNECTOR_OUTCOMES:Record<string,Outcome>={completed:{tone:"done",label:"Autorisé · Action effectuée"},succeeded:{tone:"done",label:"Autorisé · Action effectuée"},success:{tone:"done",label:"Autorisé · Action effectuée"},approved:{tone:"running",label:"Autorisé · En cours…"},executing:{tone:"running",label:"Autorisé · En cours…"},running:{tone:"running",label:"Autorisé · En cours…"},rejected:{tone:"refused",label:"Refusé"},cancelled:{tone:"refused",label:"Annulé"},expired:{tone:"warning",label:"Demande expirée"},failed:{tone:"warning",label:"Échec de l’action"},uncertain:{tone:"warning",label:"Résultat à vérifier dans l’application"},needs_input:{tone:"warning",label:"Informations manquantes"}};

/** A connected-app action (Facebook, Gmail…) waiting for the user's decision. */
export function ConnectorActionCard({resource,onUpdated}:{resource:Resource;onUpdated?:()=>void}){
 const [current,setCurrent]=useState(resource),[busy,setBusy]=useState<"approve"|"reject"|null>(null),[error,setError]=useState("");const pending=useRef(false);
 const data=current.data||{},status=text(data.status)||current.status;
 const args=data.arguments&&typeof data.arguments==="object"&&!Array.isArray(data.arguments)?data.arguments as Record<string,unknown>:null;
 let exact:string|undefined;try{exact=args?JSON.stringify(args,null,2):undefined;}catch{exact=undefined;}
 const instant=data.mode==="instant",price=typeof data.priceUsd==="number"?data.priceUsd:NaN,credits=typeof data.maxCredits==="number"?data.maxCredits:NaN;
 const blockedNote=!args||exact===undefined?"Approbation bloquée : les paramètres exacts sont manquants.":instant&&!(Number.isFinite(price)&&Number.isFinite(credits))?"Approbation bloquée : le coût de cet appel n’est pas vérifié.":undefined;
 const {fields,content}=args?connectorContent(args):{fields:[],content:undefined};
 const allFields=[{label:"Action",value:connectorActionLabel(text(data.toolkit),text(data.toolSlug))},...fields,...(instant&&Number.isFinite(credits)?[{label:"Plafond",value:credits+" crédits"}]:[])];
 const decide=async(decision:"approve"|"reject")=>{
  if(pending.current)return;pending.current=true;setBusy(decision);setError("");
  try{setCurrent(await api<Resource>("/api/connectors/approvals/"+encodeURIComponent(current.id),post({decision})));onUpdated?.();}
  catch(e){setError(errorText(e));}finally{pending.current=false;setBusy(null);}
 };
 const awaiting=["pending","awaiting_approval"].includes(status);
 return <ApprovalCard icon={<PlugZap size={18}/>} title={connectorQuestion(text(data.toolkit),text(data.toolSlug))} summary={text(data.description)||undefined} fields={allFields} content={content} exact={exact}
  outcome={awaiting?null:CONNECTOR_OUTCOMES[status]||{tone:"warning",label:"État à vérifier"}} busy={busy} error={error} blockedNote={blockedNote}
  expiresAt={typeof data.expiresAt==="number"?data.expiresAt:undefined} onApprove={()=>void decide("approve")} onReject={()=>void decide("reject")}/>;
}

const BROWSER_ACTIONS:Record<string,string>={click:"Cliquer",fill:"Saisir un texte",type:"Saisir un texte",press:"Appuyer sur une touche",select:"Choisir dans une liste",upload:"Envoyer un fichier",close_tab:"Fermer un onglet",navigate:"Ouvrir une page",new_tab:"Ouvrir un onglet",scroll:"Faire défiler",pointer:"Cliquer"};
/** The browser's next sensitive step (submit, send, pay…), decided in the conversation. */
export function BrowserActionApproval({session,action,onDecided}:{session:BrowserSessionDTO;action:BrowserActionDTO;onDecided:()=>void}){
 const [busy,setBusy]=useState<"approve"|"reject"|null>(null),[error,setError]=useState(""),[outcome,setOutcome]=useState<Outcome|null>(null);const pending=useRef(false);
 const command=action.command,target=session.observation?.elements?.find(element=>element.ref===command.targetRef);
 const fields:ApprovalField[]=[{label:"Action",value:BROWSER_ACTIONS[command.kind]||command.kind},{label:"Page",value:session.title||session.url},...(target?[{label:"Élément",value:target.name||target.role}]:[]),...(command.url?[{label:"Destination",value:command.url}]:[]),...(command.key?[{label:"Touche",value:command.key}]:[])];
 const decide=async(decision:"approve"|"reject")=>{
  if(pending.current)return;pending.current=true;setBusy(decision);setError("");
  try{await api("/api/browser/sessions/"+encodeURIComponent(session.id)+"/actions/"+encodeURIComponent(action.id),post({decision,version:action.version,...(decision==="approve"?{approved:true}:{})}));setOutcome(decision==="approve"?{tone:"done",label:"Autorisé"}:{tone:"refused",label:"Refusé"});onDecided();}
  catch(e){setError(errorText(e));}finally{pending.current=false;setBusy(null);}
 };
 return <ApprovalCard icon={<Globe2 size={18}/>} title="Autoriser Braand à faire cette action dans le navigateur ?" summary={action.description} fields={fields}
  content={command.value!==undefined?{label:"Texte exact",text:command.value||"(vide)"}:undefined} exact={JSON.stringify(command,null,2)}
  outcome={outcome} busy={busy} error={error} expiresAt={action.expiresAt} onApprove={()=>void decide("approve")} onReject={()=>void decide("reject")}/>;
}
