"use client";
// Suggestions board: ideas and bugs shared by every Braand member. Every
// write goes through the server API; text is always rendered as plain text.
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {ArrowLeft,Bell,Bug,ChevronUp,Flag,Lightbulb,LoaderCircle,MessageSquare,Pin,Plus,Search,ShieldAlert,X} from "lucide-react";
import {api,post} from "@/lib/client-api";
import {BUG_PROMPT,STATUS_LABELS} from "@/lib/feedback-rules.mjs";
import "./feedback.css";

type Post={id:string;type:"feature"|"bug";title:string;body:string;excerpt?:string;status:string;statusLabel:string;private:boolean;duplicateOf:string|null;hasAttachment:boolean;voteCount:number;commentCount:number;pinned:boolean;authorName:string;mine:boolean;voted?:boolean;createdAt:number};
type Comment={id:string;body:string;authorName:string;isTeam:boolean;pinned:boolean;mine:boolean;createdAt:number};
type ListAnswer={posts:Post[];page:number;pages:number;total:number;statusCounts:Record<string,number>;team:boolean};
type Detail={post:Post;comments:Comment[];original:Post|null;team:boolean};
type Notice={id:string;postId:string;title:string;status:string;read:boolean;createdAt:number};
export type LibraryImage={id:string;title:string};
const SORT_LABELS={trending:"Tendances",top:"Plus votées",discussed:"Plus commentées",recent:"Récentes"} as const;
const ago=(t:number)=>{const s=(Date.now()-t)/1000;if(s<60)return "à l’instant";if(s<3600)return `il y a ${Math.round(s/60)} min`;if(s<86400)return `il y a ${Math.round(s/3600)} h`;if(s<86400*30)return `il y a ${Math.round(s/86400)} j`;return new Date(t).toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"});};
const message=(e:unknown)=>e instanceof Error?e.message:"Une erreur est survenue. Réessayez.";

function StatusPill({status}:{status:string}){return <span className="fb-status" data-status={status}>{STATUS_LABELS[status as keyof typeof STATUS_LABELS]||status}</span>;}
function TypePill({type}:{type:Post["type"]}){return <span className="fb-type" data-type={type}>{type==="bug"?<Bug size={12} aria-hidden="true"/>:<Lightbulb size={12} aria-hidden="true"/>}{type==="bug"?"Bug":"Fonctionnalité"}</span>;}

function VoteButton({post:item,onChange}:{post:Post;onChange:(next:{voted:boolean;voteCount:number})=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const disabled=item.status==="duplicate";
 const toggle=async()=>{if(busy||disabled)return;setBusy(true);setError("");const before={voted:!!item.voted,voteCount:item.voteCount};
  // Immediate feedback, rolled back if the server refuses.
  onChange({voted:!before.voted,voteCount:before.voteCount+(before.voted?-1:1)});
  try{onChange(await api<{voted:boolean;voteCount:number}>(`/api/feedback/${encodeURIComponent(item.id)}/vote`,post({})));}catch(e){onChange(before);setError(message(e));}finally{setBusy(false);}};
 return <div className="fb-vote-wrap"><button type="button" className="fb-vote" aria-pressed={!!item.voted} disabled={disabled} aria-label={`${item.voted?"Retirer mon vote pour":"Voter pour"} « ${item.title} », ${item.voteCount} vote${item.voteCount>1?"s":""}`} title={disabled?"Doublon : votez pour l’originale":undefined} onClick={()=>void toggle()}><ChevronUp size={18} aria-hidden="true"/><strong>{item.voteCount}</strong></button>{error&&<span className="fb-error-inline" role="alert">{error}</span>}</div>;
}

function Notifications({onOpen}:{onOpen:(id:string)=>void}){
 const [open,setOpen]=useState(false),[items,setItems]=useState<Notice[]|null>(null);
 const unread=items?.filter(item=>!item.read).length||0;
 useEffect(()=>{void api<{notifications:Notice[]}>("/api/feedback/notifications").then(r=>setItems(r.notifications)).catch(()=>setItems([]));},[]);
 const show=()=>{setOpen(value=>!value);if(!open&&unread){void api("/api/feedback/notifications/read",post({})).then(()=>setItems(list=>list?.map(item=>({...item,read:true}))||null)).catch(()=>{});}};
 return <div className="fb-bell"><button type="button" className="icon-button" aria-label={unread?`Notifications, ${unread} non lue${unread>1?"s":""}`:"Notifications"} aria-expanded={open} onClick={show}><Bell size={18} aria-hidden="true"/>{unread>0&&<span className="fb-dot" aria-hidden="true">{unread}</span>}</button>
  {open&&<div className="fb-bell-panel" role="dialog" aria-label="Notifications de statut"><header><strong>Avancement de vos suggestions</strong><button type="button" className="icon-button" aria-label="Fermer" onClick={()=>setOpen(false)}><X size={16}/></button></header>
   {!items?<p className="fb-muted">Chargement…</p>:items.length?<ul>{items.map(item=><li key={item.id}><button type="button" onClick={()=>{setOpen(false);onOpen(item.postId);}}><span>{item.title}</span><span className="fb-muted">passe à <StatusPill status={item.status}/> · {ago(item.createdAt)}</span></button></li>)}</ul>:<p className="fb-muted">Vous serez prévenu ici quand une suggestion que vous suivez change de statut.</p>}
  </div>}
 </div>;
}

function NewSuggestion({images,onImport,onCreated,onCancel,onOpen}:{images:LibraryImage[];onImport?:()=>void;onCreated:(id:string)=>void;onCancel:()=>void;onOpen:(id:string)=>void}){
 const [type,setType]=useState<Post["type"]>("feature"),[title,setTitle]=useState(""),[body,setBody]=useState(""),[security,setSecurity]=useState(false),[attachment,setAttachment]=useState(""),[similar,setSimilar]=useState<Post[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{const value=title.trim();if(value.length<4){const t=setTimeout(()=>setSimilar([]),0);return()=>clearTimeout(t);}const timer=setTimeout(()=>{void api<{posts:Post[]}>("/api/feedback/similar?title="+encodeURIComponent(value)).then(r=>setSimilar(r.posts)).catch(()=>setSimilar([]));},300);return()=>clearTimeout(timer);},[title]);
 const submit=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError("");try{const r=await api<Detail>("/api/feedback",post({type,title,body,...(type==="bug"&&security?{security:true}:{}),...(attachment?{attachmentFileId:attachment}:{})}));onCreated(r.post.id);}catch(e){setError(message(e));}finally{setBusy(false);}};
 const titleOk=title.trim().length>=8&&title.trim().length<=120,bodyOk=type==="feature"||body.trim().length>=10;
 return <form className="fb-form" onSubmit={submit} aria-labelledby="fb-new-title">
  <header className="fb-form-head"><button type="button" className="icon-button" aria-label="Revenir à la liste" onClick={onCancel}><ArrowLeft size={18}/></button><h2 id="fb-new-title">Nouvelle suggestion</h2></header>
  <div className="fb-segment" role="radiogroup" aria-label="Type de suggestion">{(["feature","bug"] as const).map(value=><button key={value} type="button" role="radio" aria-checked={type===value} onClick={()=>{setType(value);if(value==="feature")setSecurity(false);}}>{value==="bug"?<Bug size={15}/>:<Lightbulb size={15}/>}{value==="bug"?"Bug":"Fonctionnalité"}</button>)}</div>
  <label htmlFor="fb-title">Titre</label>
  <input id="fb-title" value={title} maxLength={120} required onChange={e=>setTitle(e.target.value)} placeholder={type==="bug"?"Ex. L’export PDF reste bloqué à 90 %":"Ex. Exporter mes factures en PDF"} aria-describedby="fb-title-help"/>
  <span id="fb-title-help" className="fb-muted">{title.trim().length}/120 · 8 caractères minimum</span>
  {similar.length>0&&<div className="fb-similar" role="status"><strong>Déjà proposé ? Votez plutôt que republier :</strong><ul>{similar.map(item=><li key={item.id}><button type="button" onClick={()=>onOpen(item.id)}><ChevronUp size={14} aria-hidden="true"/>{item.voteCount} · {item.title} <StatusPill status={item.status}/></button></li>)}</ul></div>}
  <label htmlFor="fb-body">Description{type==="bug"?"":" (facultative)"}</label>
  <textarea id="fb-body" value={body} maxLength={5000} rows={6} onChange={e=>setBody(e.target.value)} placeholder={type==="bug"?BUG_PROMPT:"Ce que vous aimeriez pouvoir faire, et pourquoi c’est utile pour vous."} aria-describedby="fb-body-help"/>
  <span id="fb-body-help" className="fb-muted">{type==="bug"?BUG_PROMPT:"Plus vous êtes précis, plus l’équipe peut agir vite."}</span>
  {type==="bug"&&<label className="fb-check"><input type="checkbox" checked={security} onChange={e=>setSecurity(e.target.checked)}/><span><ShieldAlert size={15} aria-hidden="true"/> Problème de sécurité : visible seulement par vous et l’équipe</span></label>}
  <label htmlFor="fb-attachment">Capture d’écran (facultative)</label>
  <div className="fb-attach"><select id="fb-attachment" value={attachment} onChange={e=>setAttachment(e.target.value)}><option value="">Aucune</option>{images.map(image=><option key={image.id} value={image.id}>{image.title}</option>)}</select>{onImport&&<button type="button" className="button secondary small" onClick={onImport}>Importer une image</button>}</div>
  {error&&<p className="fb-error" role="alert">{error}</p>}
  <div className="fb-actions"><button type="button" className="button secondary" onClick={onCancel}>Annuler</button><button type="submit" className="button primary" disabled={busy||!titleOk||!bodyOk}>{busy?<LoaderCircle size={16} className="spin"/>:<Plus size={16}/>}Publier</button></div>
 </form>;
}

function SuggestionDetail({id,onBack,onOpen}:{id:string;onBack:()=>void;onOpen:(id:string)=>void}){
 const [detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(""),[reply,setReply]=useState(""),[busy,setBusy]=useState(false),[note,setNote]=useState("");
 const load=useCallback(()=>api<Detail>("/api/feedback/"+encodeURIComponent(id)).then(setDetail).catch(e=>setError(message(e))),[id]);
 useEffect(()=>{void load();},[load]);
 const send=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setNote("");try{setDetail(await api<Detail>(`/api/feedback/${encodeURIComponent(id)}/comments`,post({body:reply})));setReply("");}catch(e){setNote(message(e));}finally{setBusy(false);}};
 const report=async(commentId?:string)=>{if(!window.confirm(commentId?"Signaler cette réponse à l’équipe ?":"Signaler cette suggestion à l’équipe ?"))return;const reason=window.prompt("Pourquoi ? (facultatif)")||"";try{const r=await api<{alreadyReported:boolean}>(`/api/feedback/${encodeURIComponent(id)}/report`,post({...(commentId?{commentId}:{}),reason}));setNote(r.alreadyReported?"Vous l’aviez déjà signalé. Merci.":"Merci, l’équipe va regarder.");}catch(e){setNote(message(e));}};
 if(error)return <div className="fb-empty" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={onBack}>Revenir à la liste</button></div>;
 if(!detail)return <div className="fb-skeleton" role="status" aria-label="Chargement de la suggestion"><span/><span/><span/></div>;
 const item=detail.post;
 return <article className="fb-detail" aria-labelledby="fb-detail-title">
  <button type="button" className="fb-back" onClick={onBack}><ArrowLeft size={16}/>Toutes les suggestions</button>
  <div className="fb-detail-head"><VoteButton post={item} onChange={next=>setDetail(d=>d?{...d,post:{...d.post,...next}}:d)}/><div><div className="fb-pills"><TypePill type={item.type}/><StatusPill status={item.status}/>{item.private&&<span className="fb-private"><ShieldAlert size={12}/>Privé</span>}{item.pinned&&<span className="fb-pinned"><Pin size={12}/>Épinglé</span>}</div><h2 id="fb-detail-title">{item.title}</h2><p className="fb-muted">{item.authorName} · {ago(item.createdAt)}</p></div></div>
  {detail.original&&<p className="fb-duplicate">Cette suggestion rejoint <button type="button" onClick={()=>onOpen(detail.original!.id)}>« {detail.original.title} »</button> : votez pour l’originale.</p>}
  {item.body&&<p className="fb-body">{item.body}</p>}
  {item.hasAttachment&&<>{/* A private screenshot from an authenticated API: no image optimisation applies. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img className="fb-capture" src={`/api/feedback/${encodeURIComponent(item.id)}/attachment`} alt={"Capture jointe à « "+item.title+" »"} loading="lazy"/></>}
  <div className="fb-detail-actions"><button type="button" className="fb-link" onClick={()=>void report()}><Flag size={14}/>Signaler</button></div>
  <section aria-labelledby="fb-replies"><h3 id="fb-replies">{detail.comments.length} réponse{detail.comments.length>1?"s":""}</h3>
   {detail.comments.length?<ul className="fb-comments">{detail.comments.map(comment=><li key={comment.id} className={comment.isTeam?"is-team":""}><div className="fb-comment-head"><strong>{comment.authorName}</strong>{comment.isTeam&&<span className="fb-team">Équipe</span>}{comment.pinned&&<span className="fb-pinned"><Pin size={11}/>Épinglée</span>}<span className="fb-muted">{ago(comment.createdAt)}</span>{!comment.mine&&!comment.isTeam&&<button type="button" className="fb-link" aria-label={"Signaler la réponse de "+comment.authorName} onClick={()=>void report(comment.id)}><Flag size={12}/></button>}</div><p>{comment.body}</p></li>)}</ul>:<p className="fb-muted">Pas encore de réponse. Lancez la discussion.</p>}
   {item.status!=="duplicate"&&<form className="fb-reply" onSubmit={send}><label htmlFor="fb-reply" className="sr-only">Votre réponse</label><textarea id="fb-reply" rows={3} maxLength={3000} value={reply} onChange={e=>setReply(e.target.value)} placeholder="Ajoutez un cas d’usage, une précision, une idée…"/><button type="submit" className="button primary" disabled={busy||!reply.trim()}>{busy?<LoaderCircle size={16} className="spin"/>:<MessageSquare size={16}/>}Répondre</button></form>}
   {note&&<p className="fb-muted" role="status">{note}</p>}
  </section>
 </article>;
}

export default function FeedbackBoard({initialId,images=[],onImport}:{initialId?:string|null;images?:LibraryImage[];onImport?:()=>void}){
 const [selected,setSelected]=useState<string|null>(initialId||null),[creating,setCreating]=useState(false);
 const [type,setType]=useState<""|"feature"|"bug">(""),[status,setStatus]=useState(""),[sort,setSort]=useState<keyof typeof SORT_LABELS>("trending"),[query,setQuery]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1),[retry,setRetry]=useState(0);
 const [list,setList]=useState<ListAnswer|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{const t=setTimeout(()=>{setSearch(query.trim());setPage(1);},300);return()=>clearTimeout(t);},[query]);
 const params=useMemo(()=>{const p=new URLSearchParams({sort,page:String(page)});if(type)p.set("type",type);if(status)p.set("status",status);if(search)p.set("q",search);return p.toString();},[type,status,sort,search,page]);
 useEffect(()=>{if(selected||creating)return;let live=true;const t=setTimeout(()=>{setLoading(true);void api<ListAnswer>("/api/feedback?"+params).then(r=>{if(live){setList(r);setError("");}}).catch(e=>{if(live)setError(message(e));}).finally(()=>{if(live)setLoading(false);});},0);return()=>{live=false;clearTimeout(t);};},[params,selected,creating,retry]);
 // Keep the address shareable: ?view=suggestions&id=…
 const go=useCallback((id:string|null)=>{setCreating(false);setSelected(id);const url=new URL(window.location.href);if(id)url.searchParams.set("id",id);else url.searchParams.delete("id");window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);requestAnimationFrame(()=>{window.scrollTo({top:0});heading.current?.focus();});},[]);
 const counts=list?.statusCounts||{},total=Object.values(counts).reduce((n,v)=>n+v,0);
 if(creating)return <div className="fb-board"><NewSuggestion images={images} onImport={onImport} onCancel={()=>setCreating(false)} onCreated={id=>go(id)} onOpen={id=>go(id)}/></div>;
 if(selected)return <div className="fb-board"><h1 className="sr-only" ref={heading} tabIndex={-1}>Suggestion</h1><SuggestionDetail key={selected} id={selected} onBack={()=>go(null)} onOpen={id=>go(id)}/></div>;
 return <div className="fb-board">
  <header className="fb-head"><div><h1 ref={heading} tabIndex={-1}>Suggestions</h1><p className="fb-muted">Proposez une idée, signalez un bug, votez pour ce qui compte pour vous. L’équipe répond ici.</p></div><div className="fb-head-actions"><Notifications onOpen={id=>go(id)}/><button type="button" className="button primary" onClick={()=>setCreating(true)}><Plus size={16}/>Nouvelle suggestion</button></div></header>
  <div className="fb-toolbar">
   <label className="fb-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label="Rechercher une suggestion" placeholder="Rechercher" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div className="fb-segment" role="group" aria-label="Type">{([["","Tout"],["feature","Fonctionnalités"],["bug","Bugs"]] as const).map(([value,label])=><button key={value} type="button" aria-pressed={type===value} onClick={()=>{setType(value);setPage(1);}}>{label}</button>)}</div>
   <select aria-label="Filtrer par statut" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Tous les statuts ({total})</option>{Object.entries(STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label} ({counts[value]||0})</option>)}</select>
   <select aria-label="Trier" value={sort} onChange={e=>{setSort(e.target.value as keyof typeof SORT_LABELS);setPage(1);}}>{Object.entries(SORT_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
  </div>
  {error?<div className="fb-empty" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={()=>setRetry(n=>n+1)}>Réessayer</button></div>
   :loading&&!list?<div className="fb-skeleton" role="status" aria-label="Chargement des suggestions"><span/><span/><span/></div>
   :list&&list.posts.length?<><ul className="fb-list" aria-busy={loading}>{list.posts.map(item=><li key={item.id} className="fb-row">
    <VoteButton post={item} onChange={next=>setList(l=>l?{...l,posts:l.posts.map(p=>p.id===item.id?{...p,...next}:p)}:l)}/>
    <button type="button" className="fb-row-main" onClick={()=>go(item.id)}><span className="fb-row-title">{item.pinned&&<Pin size={13} aria-label="Épinglé"/>}{item.title}</span>{item.excerpt&&<span className="fb-excerpt">{item.excerpt}</span>}<span className="fb-meta"><TypePill type={item.type}/><StatusPill status={item.status}/>{item.private&&<span className="fb-private"><ShieldAlert size={12}/>Privé</span>}<span><MessageSquare size={13} aria-hidden="true"/> {item.commentCount}<span className="sr-only"> réponses</span></span><span>{item.authorName}</span><span>{ago(item.createdAt)}</span></span></button>
   </li>)}</ul>
   {list.pages>1&&<nav className="fb-pages" aria-label="Pages"><button type="button" className="button secondary small" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Précédentes</button><span className="fb-muted">Page {list.page} sur {list.pages}</span><button type="button" className="button secondary small" disabled={page>=list.pages} onClick={()=>setPage(p=>p+1)}>Suivantes</button></nav>}</>
   :<div className="fb-empty"><Lightbulb size={28} aria-hidden="true"/><h2>{search||type||status?"Aucune suggestion ne correspond":"Aucune suggestion pour le moment"}</h2><p className="fb-muted">{search||type||status?"Essayez d’autres mots ou retirez un filtre.":"Soyez le premier à proposer une idée ou à signaler un bug."}</p><button type="button" className="button primary" onClick={()=>setCreating(true)}><Plus size={16}/>Nouvelle suggestion</button></div>}
 </div>;
}
