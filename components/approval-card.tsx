"use client";
// One approval card for every action Braand wants to take outside the app,
// shown as a compact action row. Exact content stays behind an accessible
// disclosure; destinations and spending ceilings remain visible. Decisions
// fold into their real outcome without repeating the assistant's explanation.
import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {ChevronDown,Globe2,LoaderCircle,PlugZap} from "lucide-react";
import {api,post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import type {BrowserActionDTO,BrowserSessionDTO} from "@/lib/browser-contracts";
import "./approval-card.css";

export type ApprovalField={label:string;value:string};
type Outcome={tone:"done"|"refused"|"warning"|"running";label:string};
type CardProps={icon:ReactNode;title:string;compactTitle?:string;summary?:string;fields:ApprovalField[];essentials?:ApprovalField[];content?:{label:string;text:string};exact?:string;children?:ReactNode;className?:string;resultAction?:ReactNode;approveLabel?:string;busyLabel?:string;
 outcome?:Outcome|null;busy?:"approve"|"reject"|null;error?:string;blockedNote?:string;expiresAt?:number;onApprove:()=>void;onReject?:()=>void};

export function ApprovalCard({icon,title,compactTitle,summary,fields,essentials,content,exact,children,className,resultAction,approveLabel='Autoriser',busyLabel='Exécution…',outcome,busy,error,blockedNote,expiresAt,onApprove,onReject}:CardProps){
 const detailsId=useId(),[disclosure,setDisclosure]=useState<{state:string;open:boolean}|null>(null);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{if(outcome||!expiresAt)return;const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[outcome,expiresAt]);
 const expired=!outcome&&!!expiresAt&&expiresAt<=now;
 const shown:Outcome|null=outcome||(expired?{tone:"warning",label:"Demande expirée"}:null);
 const state=shown?shown.tone+':'+shown.label:'pending',open=disclosure?.state===state&&disclosure.open;
 const label=compactTitle||title.replace(/^Autoriser Braand à /,'').replace(/\s*\?$/,'').replace(/^./,letter=>letter.toUpperCase());
 const visibleFields=essentials??fields.filter(field=>/^(Compte|Dépôt|Page|Publication|Destination|Destinataire|Canal|Plafond|Budget|Montant|Devise|Date)$/.test(field.label));
 return <section className={'approval-card'+(className?' '+className:'')} data-state={shown?shown.tone:"pending"} aria-label={title} aria-busy={!!busy}>
  <div className="approval-row">
   <span className="approval-icon" aria-hidden="true">{busy||shown?.tone==='running'?<LoaderCircle size={16} className="approval-spin"/>:icon}</span>
   <div className="approval-copy"><h3>{label}</h3>{visibleFields.length>0&&<dl className="approval-essentials">{visibleFields.map((field,index)=><div key={field.label+index}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}</div>
   {shown?<div className="approval-result"><span className="approval-outcome" role="status">{shown.label}</span>{resultAction}</div>:<div className="approval-actions">
    <button type="button" className="approval-approve" disabled={!!busy||!!blockedNote} onClick={onApprove}>{busy==="approve"?busyLabel:approveLabel}</button>
    {onReject&&<button type="button" className="approval-reject" disabled={!!busy} onClick={onReject}>{busy==="reject"?"Refus…":"Refuser"}</button>}
   </div>}
   <button type="button" className="approval-toggle" aria-label="Détails de la demande" title="Détails de la demande" aria-expanded={open} aria-controls={open?detailsId:undefined} onClick={()=>setDisclosure({state,open:!open})}><ChevronDown size={16} aria-hidden="true"/></button>
  </div>
  {open&&<div className="approval-details" id={detailsId}>
    {summary&&<p className="approval-summary">{summary}</p>}
    {fields.length>0&&<dl>{fields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
    {content&&<div className="approval-content"><strong>{content.label}</strong><p>{content.text}</p></div>}
    {children}
    {exact&&<details className="approval-exact"><summary>Paramètres exacts</summary><pre tabIndex={0}>{exact}</pre></details>}
   </div>}
  {!shown&&blockedNote&&<p className="approval-note" role="note">{blockedNote}</p>}
  {error&&<p className="approval-error" role="alert">{error}</p>}
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
export function ConnectorActionCard({resource,onUpdated}:{resource:Resource;onUpdated?:(result:Resource,decision:"approve"|"reject")=>void}){
 const [local,setCurrent]=useState(resource),[busy,setBusy]=useState<"approve"|"reject"|null>(null),[error,setError]=useState("");const pending=useRef(false);
 const current=local.id!==resource.id||resource.version>local.version?resource:local;
 const data=current.data||{},status=text(data.status)||current.status;
 const args=data.arguments&&typeof data.arguments==="object"&&!Array.isArray(data.arguments)?data.arguments as Record<string,unknown>:null;
 let exact:string|undefined;try{exact=args?JSON.stringify(args,null,2):undefined;}catch{exact=undefined;}
 const instant=data.mode==="instant",price=typeof data.priceUsd==="number"?data.priceUsd:NaN,credits=typeof data.maxCredits==="number"?data.maxCredits:NaN;
 const blockedNote=!args||exact===undefined?"Approbation bloquée : les paramètres exacts sont manquants.":instant&&!(Number.isFinite(price)&&Number.isFinite(credits))?"Approbation bloquée : le coût de cet appel n’est pas vérifié.":undefined;
 const {fields,content}=args?connectorContent(args):{fields:[],content:undefined};
 const allFields=[{label:"Action",value:connectorActionLabel(text(data.toolkit),text(data.toolSlug))},...fields,...(instant&&Number.isFinite(credits)?[{label:"Plafond",value:credits+" crédits"}]:[])];
 const decide=async(decision:"approve"|"reject")=>{
  if(pending.current)return;pending.current=true;setBusy(decision);setError("");
  try{const result=await api<Resource>("/api/connectors/approvals/"+encodeURIComponent(current.id),post({decision}));setCurrent(result);onUpdated?.(result,decision);}
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
 return <ApprovalCard icon={<Globe2 size={18}/>} title="Autoriser Braand à faire cette action dans le navigateur ?" compactTitle={command.kind==='click'&&target?.name?'Cliquer sur « '+target.name+' »':'Navigateur · '+(BROWSER_ACTIONS[command.kind]||'Action')} summary={action.description} fields={fields}
  content={command.value!==undefined?{label:"Texte exact",text:command.value||"(vide)"}:undefined} exact={JSON.stringify(command,null,2)}
  outcome={outcome} busy={busy} error={error} expiresAt={action.expiresAt} onApprove={()=>void decide("approve")} onReject={()=>void decide("reject")}/>;
}

type BatchPost={id:string;status:string;text:string;scheduledAt:number;format:string;assets?:unknown[]};
type Batch={id:string;title:string;version:number;digest:string|null;expiresAt:number|null;posts:BatchPost[]};
const when=(value:number)=>new Date(value).toLocaleString("fr-FR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
/** Social posts Braand prepared: scheduled only after « Autoriser ». */
export function SocialBatchCard({batchId,onUpdated}:{batchId:string;onUpdated?:()=>void}){
 const [batch,setBatch]=useState<Batch|null>(null),[busy,setBusy]=useState<"approve"|"reject"|null>(null),[error,setError]=useState(""),[outcome,setOutcome]=useState<Outcome|null>(null);const pending=useRef(false);
 useEffect(()=>{let stop=false;api<Batch>("/api/social/batches/"+encodeURIComponent(batchId)).then(next=>{if(!stop)setBatch(next);}).catch(e=>{if(!stop)setError(errorText(e));});return()=>{stop=true;};},[batchId]);
 if(!batch)return error?<p className="approval-error" role="alert">{error}</p>:null;
 const drafts=batch.posts.filter(post=>post.status==="draft");
 const decided=outcome||(drafts.length?null:{tone:"done" as const,label:"Déjà décidé"});
 const decide=async(decision:"approve"|"reject")=>{
  if(pending.current||!batch.digest)return;pending.current=true;setBusy(decision);setError("");
  try{const next=await api<Batch>("/api/social/batches/"+encodeURIComponent(batch.id)+"/decision",post({version:batch.version,digest:batch.digest,decision,postIds:drafts.map(item=>item.id)}));setBatch(next);setOutcome(decision==="approve"?{tone:"done",label:"Autorisé · Programmé"}:{tone:"refused",label:"Refusé"});onUpdated?.();}
  catch(e){setError(errorText(e));}finally{pending.current=false;setBusy(null);}
 };
 const list=(decided?batch.posts:drafts);
 return <ApprovalCard icon={<PlugZap size={18}/>} title={`Autoriser Braand à programmer ${list.length>1?list.length+" publications":"cette publication"} ?`} compactTitle={`Programmer ${list.length>1?list.length+' publications':'cette publication'} · ${batch.title}`} summary={batch.title}
  fields={list.length===1?[{label:"Date",value:when(list[0].scheduledAt)},{label:"Format",value:list[0].format}]:list.map((item,index)=>({label:"Publication "+(index+1),value:when(item.scheduledAt)}))}
  content={list.length===1?{label:"Texte exact",text:list[0].text||"(sans texte)"}:{label:"Textes exacts",text:list.map((item,index)=>(index+1)+". "+(item.text||"(sans texte)")).join("\n\n")}}
  outcome={decided} busy={busy} error={error} blockedNote={batch.digest?undefined:"Approbation bloquée : le lot n’a pas pu être vérifié."} expiresAt={batch.expiresAt??undefined}
  onApprove={()=>void decide("approve")} onReject={()=>void decide("reject")}/>;
}

type Reply={id:string;text:string;version:number;status:string;digest:string;comment:{text:string;author:string};account:{label:string;network:string}};
/** A reply to a comment, published only after « Autoriser ». */
export function SocialReplyCard({replyId,onUpdated}:{replyId:string;onUpdated?:()=>void}){
 const [reply,setReply]=useState<Reply|null>(null),[busy,setBusy]=useState<"approve"|"reject"|null>(null),[error,setError]=useState("");const pending=useRef(false);
 useEffect(()=>{let stop=false;api<Reply>("/api/social/replies/"+encodeURIComponent(replyId)).then(next=>{if(!stop)setReply(next);}).catch(e=>{if(!stop)setError(errorText(e));});return()=>{stop=true;};},[replyId]);
 if(!reply)return error?<p className="approval-error" role="alert">{error}</p>:null;
 const decide=async(decision:"approve"|"reject")=>{
  if(pending.current)return;pending.current=true;setBusy(decision);setError("");
  try{const next=await api<Partial<Reply>>("/api/social/replies/"+encodeURIComponent(reply.id)+"/decision",post({version:reply.version,digest:reply.digest,decision}));setReply({...reply,...next,status:typeof next.status==="string"?next.status:decision==="approve"?"published":"rejected"});onUpdated?.();}
  catch(e){setError(errorText(e));}finally{pending.current=false;setBusy(null);}
 };
 const outcome:Outcome|null=reply.status==="draft"?null:reply.status==="rejected"?{tone:"refused",label:"Refusé"}:reply.status==="published"?{tone:"done",label:"Autorisé · Réponse publiée"}:{tone:"warning",label:"Résultat à vérifier"};
 return <ApprovalCard icon={<PlugZap size={18}/>} title={`Autoriser Braand à publier cette réponse sur ${appName(reply.account.network)} ?`} summary={reply.comment.author?`En réponse à ${reply.comment.author} : « ${reply.comment.text} »`:`En réponse à « ${reply.comment.text} »`}
  fields={[{label:"Compte",value:reply.account.label}]} content={{label:"Texte exact",text:reply.text}} outcome={outcome} busy={busy} error={error}
  onApprove={()=>void decide("approve")} onReject={()=>void decide("reject")}/>;
}
