"use client";
// Braand administration: one place to see and steer the whole platform.
// Plain French, every figure explained; never shows conversation content.
import {useCallback,useEffect,useMemo,useState,type ReactNode} from "react";
import Link from "next/link";
import {api,post} from "@/lib/client-api";
import "./admin.css";

type View="overview"|"users"|"finance"|"ai"|"quality"|"media"|"system"|"audit";
const VIEWS:{id:View;label:string;help:string}[]=[
 {id:"overview",label:"Vue d’ensemble",help:"L’essentiel de Braand en un coup d’œil : utilisateurs, activité, argent et ce qui demande votre attention."},
 {id:"users",label:"Utilisateurs",help:"Tous les comptes, leurs crédits et leur activité. Cliquez sur un compte pour agir : offrir des crédits, déconnecter, suspendre."},
 {id:"finance",label:"Revenus & crédits",help:"Commandes, abonnements, remboursements et mouvements de crédits."},
 {id:"ai",label:"IA & coûts",help:"Combien coûtent les réponses de l’agent et quel cerveau (Haiku, Sonnet, Opus) a répondu."},
 {id:"quality",label:"Qualité de l’agent",help:"Réponses réussies ou échouées, outils qui posent problème, avis des utilisateurs et leçons apprises automatiquement."},
 {id:"media",label:"Médias",help:"Images, vidéos et voix générées, par modèle, avec leur statut."},
 {id:"system",label:"Opérations",help:"État des services, tâches automatiques, alertes et sauvegardes. Aucun secret n’est affiché."},
 {id:"audit",label:"Journal",help:"Les dernières actions sensibles, dont toutes celles faites depuis cette administration."},
];
type Json=Record<string,unknown>;
const fmt=(n:unknown,d=0)=>(Number(n)||0).toLocaleString("fr-FR",{maximumFractionDigits:d}).replace(/[\u202f\u00a0]/g," ");
const xaf=(n:unknown)=>fmt(n)+" FCFA";
const date=(t:unknown)=>t?new Date(Number(t)).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—";
const dateTime=(t:unknown)=>t?new Date(Number(t)).toLocaleString("fr-FR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const ago=(t:unknown)=>{if(!t)return "jamais";const s=(Date.now()-Number(t))/1000;if(s<3600)return "il y a "+Math.max(1,Math.round(s/60))+" min";if(s<86400)return "il y a "+Math.round(s/3600)+" h";return "il y a "+Math.round(s/86400)+" j";};
const statusTag=(s:unknown)=>{const v=String(s||"");const cls=/^(verified|fulfilled|paid|completed|complete|settled|ready|active|succeeded|ok|up|done)$/.test(v)?"ok":/^(failed|error|rejected|expired|cancelled|blocked|unknown)$/.test(v)?"bad":"warn";return <span className={"adm-tag "+cls}>{v||"—"}</span>;};

function useData<T>(path:string|null){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(""),[tick,setTick]=useState(0);
 useEffect(()=>{if(!path)return;let live=true;api<T>(path).then(d=>{if(live){setData(d);setError("");}}).catch(e=>{if(live)setError(e instanceof Error?e.message:"Chargement impossible.");});return()=>{live=false;};},[path,tick]);
 return {data,error,reload:()=>setTick(t=>t+1)};
}
function Kpi({label,value,hint,tone}:{label:string;value:ReactNode;hint?:string;tone?:"good"|"bad"}){return <div className={"adm-card adm-kpi"+(tone?" "+tone:"")}><div className="label">{label}</div><div className="value">{value}</div>{hint?<div className="hint">{hint}</div>:null}</div>;}
function Skeleton(){return <div className="adm-grid">{Array.from({length:8},(_,i)=><div key={i} className="adm-skel"/>)}</div>;}
function Table({head,rows,onRow,empty="Rien à afficher pour le moment."}:{head:string[];rows:ReactNode[][];onRow?:(i:number)=>void;empty?:string}){
 if(!rows.length)return <div className="adm-table-wrap"><div className="adm-empty">{empty}</div></div>;
 return <div className="adm-table-wrap"><table className="adm-table"><thead><tr>{head.map(h=><th key={h} className={/^(Montant|Crédits|Coût|Appels|Réponses|Nombre|Solde|Moy)/.test(h)?"adm-num":""}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} className={onRow?"clickable":""} onClick={onRow?()=>onRow(i):undefined} tabIndex={onRow?0:undefined} onKeyDown={onRow?e=>{if(e.key==="Enter")onRow(i);}:undefined}>{r.map((c,j)=><td key={j} className={typeof c==="number"||/^[\d\s.,-]+( FCFA)?$/.test(String(c))?"adm-num":""}>{c}</td>)}</tr>)}</tbody></table></div>;
}

/** Bars for one series, optional line for a second (e.g. revenue vs cost). */
function Chart({points,bars,line,barColor="var(--color-action)",lineColor="var(--color-success)"}:{points:{day:string}[];bars:number[];line?:number[];barColor?:string;lineColor?:string}){
 const W=640,H=180,P=24,max=Math.max(1,...bars,...(line||[])),bw=(W-P*2)/Math.max(1,bars.length);
 const y=(v:number)=>H-P-(v/max)*(H-P*2);
 return <svg className="adm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graphique sur 30 jours">
  <line x1={P} x2={W-P} y1={H-P} y2={H-P} stroke="var(--color-border)"/>
  {bars.map((v,i)=><rect key={i} x={P+i*bw+bw*.15} y={y(v)} width={bw*.7} height={Math.max(0,H-P-y(v))} rx="2" fill={barColor} opacity=".85"><title>{points[i]?.day+" : "+fmt(v,2)}</title></rect>)}
  {line?<polyline fill="none" stroke={lineColor} strokeWidth="2" points={line.map((v,i)=>`${P+i*bw+bw/2},${y(v)}`).join(" ")}/>:null}
  <text x={P} y={H-6}>{points[0]?.day?.slice(5)}</text><text x={W-P} y={H-6} textAnchor="end">{points.at(-1)?.day?.slice(5)}</text><text x={P} y={14}>{fmt(max,max<10?2:0)}</text>
 </svg>;
}

function Overview(){
 const {data,error}=useData<Json>("/api/admin/overview");
 if(error)return <p role="alert">{error}</p>;if(!data)return <Skeleton/>;
 const u=data.users as Json,a=data.answers as Json,m=data.money as Json,c=data.credits as Json,at=data.attention as Json,s=data.series as {day:string;signups:number;answers:number;costXaf:number;revenueXaf:number}[];
 const bySource=c.bySource as Record<string,{granted:number;remaining:number}>;
 const offered=Object.entries(bySource).filter(([k])=>k!=="topup"&&k!=="subscription"&&k!=="upgrade").reduce((n,[,v])=>n+v.granted,0);
 const sold=["topup","subscription","upgrade"].reduce((n,k)=>n+(bySource[k]?.granted||0),0);
 const attention=[[Number(at.openAlerts),"alerte(s) ouverte(s)"],[Number(at.pendingRefunds),"remboursement(s) à traiter"],[Number(at.failedOrders7),"paiement(s) échoué(s) cette semaine"],[Number(at.failedAnswers24),"réponse(s) en erreur depuis 24 h"]] as [number,string][];
 return <>
  <div className="adm-attention">{attention.some(([n])=>n>0)?attention.filter(([n])=>n>0).map(([n,l])=><span key={l} className={"adm-chip "+(l.includes("erreur")||l.includes("échoué")?"bad":"warn")}>{n} {l}</span>):<span className="adm-chip ok">Rien d’urgent : tout fonctionne.</span>}</div>
  <div className="adm-grid">
   <Kpi label="Utilisateurs" value={fmt(u.total)} hint={`${fmt(u.new7)} nouveaux cette semaine · ${fmt(u.verified)} e-mails vérifiés`}/>
   <Kpi label="Actifs (7 jours)" value={fmt(u.active7)} hint="Espaces qui ont utilisé l’agent cette semaine."/>
   <Kpi label="Réponses de l’agent" value={fmt(a.total)} hint={`${fmt(a.last7)} cette semaine · ${fmt(a.errorRate7,1)} % en erreur`} tone={Number(a.errorRate7)>10?"bad":undefined}/>
   <Kpi label="Chiffre d’affaires" value={xaf(m.revenueXaf)} hint={`${xaf(m.revenue30Xaf)} sur 30 jours · ${fmt(m.paidOrders)} commande(s) payée(s)`}/>
   <Kpi label="Coût IA (30 jours)" value={xaf(m.aiCost30Xaf)} hint={`${fmt(m.aiCalls30)} appels au modèle`}/>
   <Kpi label="Marge brute" value={xaf(m.grossMarginXaf)} hint="Chiffre d’affaires total moins le coût IA total." tone={Number(m.grossMarginXaf)<0?"bad":"good"}/>
   <Kpi label="Crédits consommés" value={fmt(c.consumed,2)} hint={`${fmt(c.consumed30,2)} sur 30 jours`}/>
   <Kpi label="Crédits vendus / offerts" value={`${fmt(sold)} / ${fmt(offered)}`} hint="Vendus = recharges et abonnements. Offerts = bienvenue, tests, cadeaux."/>
  </div>
  <div className="adm-row">
   <div className="adm-card"><h2>Réponses par jour (30 jours)</h2><Chart points={s} bars={s.map(p=>p.answers)}/></div>
   <div className="adm-card"><h2>Inscriptions par jour</h2><Chart points={s} bars={s.map(p=>p.signups)} barColor="var(--color-accent)"/></div>
   <div className="adm-card"><h2>Revenu par jour (FCFA)</h2><Chart points={s} bars={s.map(p=>p.revenueXaf)} barColor="var(--color-success)"/></div>
   <div className="adm-card"><h2>Coût IA par jour (FCFA)</h2><Chart points={s} bars={s.map(p=>p.costXaf)} barColor="var(--color-warning)"/></div>
  </div>
 </>;
}

type UserRow={id:string;email:string;createdAt:number;verified:boolean;credits:number;lastActive:number|null;answers:number;costXaf:number;plan:string|null;blocked:boolean;admin:boolean};
function Users({notify}:{notify:(m:string,e?:boolean)=>void}){
 const [q,setQ]=useState(""),[query,setQuery]=useState(""),[open,setOpen]=useState<string|null>(null),[sort,setSort]=useState<"recent"|"active"|"credits"|"cost">("recent");
 useEffect(()=>{const t=setTimeout(()=>setQuery(q),300);return()=>clearTimeout(t);},[q]);
 const {data,error,reload}=useData<{users:UserRow[]}>("/api/admin/users?q="+encodeURIComponent(query));
 const users=useMemo(()=>[...(data?.users||[])].sort((a,b)=>sort==="active"?(b.lastActive||0)-(a.lastActive||0):sort==="credits"?b.credits-a.credits:sort==="cost"?b.costXaf-a.costXaf:b.createdAt-a.createdAt),[data,sort]);
 return <>
  <div className="adm-toolbar"><input className="adm-input" placeholder="Rechercher un e-mail…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Rechercher un utilisateur"/>
   <select className="adm-btn" value={sort} onChange={e=>setSort(e.target.value as typeof sort)} aria-label="Trier"><option value="recent">Plus récents</option><option value="active">Derniers actifs</option><option value="credits">Plus de crédits</option><option value="cost">Plus gros coût IA</option></select></div>
  {error?<p role="alert">{error}</p>:!data?<Skeleton/>:<Table head={["Compte","Inscription","Dernière activité","Réponses","Solde (crédits)","Coût IA","Abonnement","État"]} onRow={i=>setOpen(users[i].id)} empty="Aucun compte ne correspond."
   rows={users.map(u=>[<span key="e"><strong>{u.email}</strong>{u.admin?<> <span className="adm-tag ok">admin</span></>:null}</span>,date(u.createdAt),ago(u.lastActive),fmt(u.answers),fmt(u.credits,2),xaf(u.costXaf),u.plan||"Gratuit",u.blocked?<span key="b" className="adm-tag bad">suspendu</span>:u.verified?<span key="v" className="adm-tag ok">actif</span>:<span key="n" className="adm-tag warn">non vérifié</span>])}/>}
  {open?<UserDrawer id={open} onClose={()=>setOpen(null)} onChange={()=>reload()} notify={notify}/>:null}
 </>;
}

function UserDrawer({id,onClose,onChange,notify}:{id:string;onClose:()=>void;onChange:()=>void;notify:(m:string,e?:boolean)=>void}){
 const {data,error,reload}=useData<Json>("/api/admin/users/"+encodeURIComponent(id));
 const [amount,setAmount]=useState("50"),[reason,setReason]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",k);return()=>window.removeEventListener("keydown",k);},[onClose]);
 const act=async(body:Json,confirmText?:string)=>{if(confirmText&&!window.confirm(confirmText))return;setBusy(true);try{const r=await api<{message:string}>("/api/admin/actions",post({...body,userId:id}));notify(r.message);reload();onChange();}catch(e){notify(e instanceof Error?e.message:"Action impossible.",true);}finally{setBusy(false);}};
 const user=data?.user as Json|undefined,lots=(data?.lots||[]) as Json[],blocked=data?.blocked as Json|null,sessions=data?.sessions as Json|undefined,usage=(data?.usage||[]) as Json[];
 return <><div className="adm-drawer-back" onClick={onClose}/><aside className="adm-drawer" role="dialog" aria-label="Fiche du compte">
  <div className="adm-toolbar" style={{justifyContent:"space-between"}}><span className="adm-tag">Compte</span><button className="adm-btn" onClick={onClose}>Fermer</button></div>
  {error?<p role="alert">{error}</p>:!user?<div className="adm-skel"/>:<>
   <h2>{String(user.email)}</h2>
   <p style={{color:"var(--color-text-muted)",fontSize:13,margin:"6px 0 0"}}>Inscrit le {date(user.createdAt)} · {user.verified?"e-mail vérifié":"e-mail non vérifié"} · {fmt(sessions?.active)} session(s) ouverte(s)</p>
   {blocked?<p className="adm-chip bad" style={{marginTop:12}}>Suspendu depuis le {date(blocked.since)} : {String(blocked.reason)}</p>:null}
   <section><h3>Offrir des crédits</h3><div className="adm-form">
    <label>Nombre de crédits<input type="number" min="1" max="100000" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Motif (visible dans le journal)<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ex. : geste commercial, test, partenaire"/></label>
    <button className="adm-btn primary" disabled={busy||!(Number(amount)>0)||reason.trim().length<3} onClick={()=>void act({action:"grant_credits",credits:Number(amount),reason},`Offrir ${amount} crédits à ${user.email} ?`)}>Offrir {amount||0} crédits</button>
   </div></section>
   <section><h3>Crédits</h3>{lots.length?<div className="adm-list">{lots.map(l=><div key={String(l.id)} className="adm-list-row"><span><strong>{fmt(l.balance,2)}</strong> / {fmt(l.granted,2)} crédits · {String(l.source)}{l.expiresAt?" · expire le "+date(l.expiresAt):""}</span>{l.source==="admin_grant"&&Number(l.balance)>0?<button className="adm-btn danger" disabled={busy} onClick={()=>void act({action:"revoke_grant",lotId:l.id,reason:"Retrait depuis l’administration"},"Retirer les crédits offerts non utilisés ?")}>Retirer</button>:<span/>}</div>)}</div>:<p className="adm-empty">Aucun crédit.</p>}</section>
   <section><h3>Utilisation de l’IA</h3>{usage.length?<div className="adm-list">{usage.map(u=><div key={String(u.model)} className="adm-list-row"><span>{String(u.model||"inconnu").replace("anthropic/","")} · {fmt(u.calls)} appels</span><strong>{xaf(u.xaf)}</strong></div>)}</div>:<p className="adm-empty">Pas encore d’appel.</p>}</section>
   <section><h3>Sécurité du compte</h3><div className="adm-toolbar">
    <button className="adm-btn" disabled={busy} onClick={()=>void act({action:"logout"},"Fermer toutes les sessions de ce compte ?")}>Déconnecter partout</button>
    {blocked?<button className="adm-btn primary" disabled={busy} onClick={()=>void act({action:"unblock"})}>Réactiver le compte</button>
     :<button className="adm-btn danger" disabled={busy} onClick={()=>{const why=window.prompt("Motif de la suspension (visible dans le journal) :");if(why&&why.trim().length>=3)void act({action:"block",reason:why.trim()});}}>Suspendre le compte</button>}
   </div><p style={{fontSize:12,color:"var(--color-text-subtle)"}}>Suspendre ferme les sessions et empêche toute nouvelle connexion, sans supprimer les données.</p></section>
  </>}
 </aside></>;
}

function Finance(){
 const {data,error}=useData<Json>("/api/admin/finance");
 if(error)return <p role="alert">{error}</p>;if(!data)return <Skeleton/>;
 const orders=data.orders as Json[],subs=data.subscriptions as Json[],refunds=data.refunds as Json[],lots=data.lots as Json[],ledger=data.ledger as Json[],status=data.ordersByStatus as Json[],ready=data.readiness as {enabled?:boolean;checks?:Record<string,boolean>};
 return <>
  <div className="adm-attention">{ready?.enabled?<span className="adm-chip ok">Paiements activés</span>:<span className="adm-chip warn">Paiements pas encore activés : {Object.entries(ready?.checks||{}).filter(([,v])=>!v).map(([k])=>k).join(", ")||"configuration incomplète"}</span>}</div>
  <div className="adm-grid">{status.map(s=><Kpi key={String(s.status)} label={"Commandes « "+String(s.status)+" »"} value={fmt(s.n)} hint={xaf(s.xaf)}/>)}{lots.map(l=><Kpi key={String(l.source)} label={"Crédits « "+String(l.source)+" »"} value={fmt(l.granted)} hint={`${fmt(l.remaining,2)} encore disponibles · ${fmt(l.lots)} lot(s)`}/>)}</div>
  <div className="adm-card" style={{marginBottom:12}}><h2>Commandes</h2><Table head={["Date","Client","Produit","Montant","Statut"]} rows={orders.map(o=>[dateTime(o.created_at),String(o.email||"—"),String(o.product||"—"),xaf(o.amount),statusTag(o.status)])}/></div>
  <div className="adm-row">
   <div className="adm-card"><h2>Abonnements</h2><Table head={["Client","Formule","Statut","Fin"]} rows={subs.map(s=>[String(s.email||"—"),String(s.plan)+" · "+String(s.cycle||""),statusTag(s.status),date(s.end_at)])} empty="Aucun abonnement pour le moment."/></div>
   <div className="adm-card"><h2>Remboursements</h2><Table head={["Date","Client","Montant","Statut"]} rows={refunds.map(r=>[date(r.created_at),String(r.email||"—"),xaf(r.amount),statusTag(r.status)])} empty="Aucune demande de remboursement."/><p style={{fontSize:12.5,marginTop:8}}><a href="/admin/billing">Traiter un remboursement →</a></p></div>
  </div>
  <div className="adm-card"><h2>Derniers mouvements de crédits</h2><Table head={["Date","Client","Type","Crédits"]} rows={ledger.map(l=>[dateTime(l.createdAt),String(l.email||"—"),String(l.kind),fmt(l.credits,2)])}/></div>
 </>;
}

function Ai(){
 const [days,setDays]=useState(30);const {data,error}=useData<Json>("/api/admin/ai?days="+days);
 if(error)return <p role="alert">{error}</p>;if(!data)return <Skeleton/>;
 const models=data.byModel as {model:string;calls:number;costXaf:number;avgXaf:number}[],total=models.reduce((n,m)=>n+m.calls,0)||1,status=data.status as Json[],readiness=data.readiness as Json,routing=readiness.routing as Json;
 const tier=(m:string)=>/haiku/.test(m)?"Léger (Haiku)":/sonnet/.test(m)?"Standard (Sonnet)":/opus/.test(m)?"Avancé (Opus)":m;
 return <>
  <div className="adm-toolbar">{[7,30,90].map(d=><button key={d} className={"adm-btn"+(d===days?" primary":"")} onClick={()=>setDays(d)}>{d} jours</button>)}<span className={"adm-chip "+(routing?.enabled?"ok":"warn")}>{routing?.enabled?"Cerveau adaptatif activé":"Modèle unique"}</span></div>
  <div className="adm-grid"><Kpi label="Coût IA" value={xaf(data.costXaf)} hint={`Sur ${days} jours`}/><Kpi label="Réponses" value={fmt(data.answers)}/><Kpi label="Coût moyen par réponse" value={fmt(data.costPerAnswerXaf,2)+" FCFA"} hint="Une réponse peut faire plusieurs appels (outils, vérifications)."/>{status.map(s=><Kpi key={String(s.status)} label={"Appels « "+String(s.status)+" »"} value={fmt(s.n)} tone={["rejected","unknown"].includes(String(s.status))&&Number(s.n)>0?"bad":undefined} hint={s.status==="rejected"?"Refus du fournisseur (ex. limite temporaire) : rien n’est facturé.":undefined}/>)}</div>
  {(()=>{const upgrades=(data.upgrades||[]) as {reason:string;tier:string;count:number}[],fallbacks=(data.fallbacks||[]) as {code:string;count:number}[],checks=(data.fileChecks||{passed:0,refused:0}) as {passed:number;refused:number};const reasons:Record<string,string>={structural:"Demande lourde (pièces jointes, long message, mission)",tool_failure:"Après un outil en échec",validation_failed:"Après un contrôle échoué",task_complexity:"Choisi par le modèle",uncertainty:"Incertitude du modèle",video_motion:"Vidéo motion"},codes:Record<string,string>={budget_exhausted:"Plafond de la demande trop bas",rate_unverified:"Tarif non vérifié",model_not_configured:"Modèle non configuré"};
   return <div className="adm-row"><div className="adm-card"><h2>Montées de cerveau</h2><Table head={["Raison","Niveau","Nombre"]} rows={upgrades.map(u=>[reasons[u.reason]||u.reason,tier(u.tier==="standard"?"sonnet":u.tier==="advanced"?"opus":u.tier),fmt(u.count)])} empty="Aucune montée sur la période."/>{fallbacks.length>0&&<><h2 style={{marginTop:16}}>Retours au niveau léger</h2><Table head={["Cause","Nombre"]} rows={fallbacks.map(f=>[codes[f.code]||f.code,fmt(f.count)])}/></>}</div>
    <div className="adm-card"><h2>Fichiers contrôlés avant livraison</h2><div className="adm-grid" style={{marginBottom:0}}><Kpi label="Livrés après contrôle" value={fmt(checks.passed)} tone="good"/><Kpi label="Refusés puis corrigés" value={fmt(checks.refused)} tone={checks.refused?"bad":undefined} hint="Fichier vide, illisible, erreur Excel ou donnée manquante : l’agent régénère."/></div></div></div>;})()}
  <div className="adm-card"><h2>Quel cerveau a répondu</h2><div className="adm-list">{models.map(m=><div key={m.model}><div className="adm-list-row"><span><strong>{tier(m.model.replace("anthropic/",""))}</strong> · {fmt(m.calls)} appels · {fmt(m.avgXaf,2)} FCFA en moyenne</span><strong>{xaf(m.costXaf)}</strong></div><div className="adm-bar"><span style={{width:Math.round(m.calls/total*100)+"%"}}/></div></div>)}{!models.length?<p className="adm-empty">Pas encore d’appel sur la période.</p>:null}</div></div>
 </>;
}

function System({part}:{part:"system"|"quality"}){
 const {data,error}=useData<Json>("/api/admin/system");
 const [busy,setBusy]=useState(false),[note,setNote]=useState("");
 if(error)return <p role="alert">{error}</p>;if(!data)return <Skeleton/>;
 const quality=data.quality as Json|null,lessons=(data.lessons||[]) as Json[];
 if(part==="quality"){
  const runs=(quality?.runs||[]) as Json[],tools=(quality?.tools||[]) as Json[],feedback=(quality?.feedback||[]) as Json[];
  return <>
   <div className="adm-grid">{runs.map(r=><Kpi key={String(r.status)} label={"Réponses « "+String(r.status)+" » (7 j)"} value={fmt(r.n)} tone={["failed","error"].includes(String(r.status))&&Number(r.n)>0?"bad":undefined}/>)}{feedback.map(f=><Kpi key={String(f.feedback)} label={f.feedback==="up"?"👍 Avis positifs":f.feedback==="down"?"👎 Avis négatifs":"Sans avis"} value={fmt(f.n)}/>)}</div>
   <div className="adm-row">
    <div className="adm-card"><h2>Outils de l’agent (7 jours)</h2><Table head={["Outil","Appels","Erreurs","Taux"]} rows={tools.slice(0,25).map(t=>[String(t.tool),fmt(t.calls),fmt(t.errors),Number(t.calls)?fmt(Number(t.errors)/Number(t.calls)*100,1)+" %":"—"])}/></div>
    <div className="adm-card"><h2>Leçons apprises automatiquement</h2><p style={{fontSize:12.5,color:"var(--color-text-muted)",marginTop:-6}}>Erreurs répétées que l’agent apprend à éviter seul (données techniques uniquement).</p><Table head={["Outil","Code","Nombre","Corrigé"]} rows={lessons.map(l=>[String(l.tool),String(l.code),fmt(l.count),fmt(l.recovered)])} empty="Aucune erreur répétée : rien à apprendre."/></div>
   </div>
  </>;
 }
 const services=data.services as Record<string,boolean>,ops=data.operations as Json|null,jobs=(ops?.jobs||[]) as Json[],alerts=(ops?.alerts||[]) as Json[],backups=(ops?.backups||[]) as Json[];
 const names:Record<string,string>={model:"Modèle d’IA",adaptiveBrain:"Cerveau adaptatif",media:"Génération médias (fal)",browser:"Navigateur",payments:"Paiements",backups:"Sauvegardes",connectors:"Connecteurs (Gmail, Drive…)",email:"E-mails",storage:"Stockage des fichiers",workQueue:"Tâches de fond",codeSandbox:"Bac à sable de code"};
 const test=async()=>{setBusy(true);try{await api("/api/admin/operations",post({action:"test-alert",idempotencyKey:crypto.randomUUID()}));setNote("Alerte de test envoyée.");}catch(e){setNote(e instanceof Error?e.message:"Envoi impossible.");}finally{setBusy(false);}};
 return <>
  <div className="adm-card" style={{marginBottom:12}}><h2>Services</h2><div className="adm-attention">{Object.entries(services).map(([k,v])=><span key={k} className={"adm-chip "+(v?"ok":"warn")}>{v?"✓":"○"} {names[k]||k}</span>)}</div></div>
  <div className="adm-row">
   <div className="adm-card"><h2>Alertes</h2><Table head={["Catégorie","Statut","Observations","Dernière fois"]} rows={alerts.map(a=>[String(a.category),statusTag(a.status),fmt(a.observations),dateTime(a.last_seen_at)])} empty="Aucune alerte."/><div style={{marginTop:10}}><button className="adm-btn" disabled={busy} onClick={()=>void test()}>Envoyer une alerte de test</button> <span style={{fontSize:12.5,color:"var(--color-text-muted)"}}>{note}</span></div></div>
   <div className="adm-card"><h2>Sauvegardes</h2><Table head={["Date","Statut"]} rows={backups.slice(0,15).map(b=>[dateTime(b.created_at??b.started_at),statusTag(b.status)])} empty="Aucune sauvegarde enregistrée."/></div>
  </div>
  <div className="adm-card"><h2>Tâches automatiques</h2><Table head={["Tâche","Statut","Essais","Mise à jour"]} rows={jobs.slice(0,40).map(j=>[String(j.name),statusTag(j.status),fmt(j.attempts),dateTime(j.updated_at)])}/></div>
 </>;
}

function Media(){
 const {data,error}=useData<Json>("/api/admin/media");
 if(error)return <p role="alert">{error}</p>;if(!data)return <Skeleton/>;
 const ops=data.byOperation as Json[],status=data.byStatus as Json[],proposals=data.proposals as Json[];
 return <>
  <div className="adm-attention"><span className={"adm-chip "+(data.falReady?"ok":"warn")}>{data.falReady?"Génération médias active":"Génération médias non configurée"}</span><a className="adm-btn" href="/admin/media-models">Gérer les modèles →</a></div>
  <div className="adm-grid">{status.map(s=><Kpi key={String(s.status)} label={"Générations « "+String(s.status)+" »"} value={fmt(s.n)}/>)}</div>
  <div className="adm-row">
   <div className="adm-card"><h2>Par outil (30 jours)</h2><Table head={["Fournisseur","Opération","Nombre","Crédits"]} rows={ops.map(o=>[String(o.provider),String(o.operation),fmt(o.count),fmt(o.credits,2)])}/></div>
   <div className="adm-card"><h2>Propositions média</h2><Table head={["Type","Statut","Nombre"]} rows={proposals.map(p=>[String(p.kind||"—"),statusTag(p.status),fmt(p.n)])}/></div>
  </div>
 </>;
}

function Audit(){
 const [q,setQ]=useState(""),[query,setQuery]=useState("");
 useEffect(()=>{const t=setTimeout(()=>setQuery(q),300);return()=>clearTimeout(t);},[q]);
 const {data,error}=useData<{entries:Json[]}>("/api/admin/audit?q="+encodeURIComponent(query));
 return <>
  <div className="adm-toolbar"><input className="adm-input" placeholder="Filtrer par action (ex. admin., refund, file…)" value={q} onChange={e=>setQ(e.target.value)} aria-label="Filtrer le journal"/></div>
  {error?<p role="alert">{error}</p>:!data?<Skeleton/>:<Table head={["Date","Source","Qui","Action","Cible","Détail"]} rows={data.entries.map(e=>[dateTime(e.createdAt),String(e.source),String(e.actor),String(e.action),String(e.target).slice(0,24),Object.entries(e.detail as Json).map(([k,v])=>k+": "+String(v)).join(" · ").slice(0,80)])}/>}
 </>;
}

export function AdminDashboard(){
 const [view,setView]=useState<View>(()=>{if(typeof window==="undefined")return "overview";const v=new URL(window.location.href).searchParams.get("vue") as View|null;return v&&VIEWS.some(x=>x.id===v)?v:"overview";});
 const [notice,setNotice]=useState<{text:string;error?:boolean}|null>(null),[refresh,setRefresh]=useState(0);
 const {data:attention}=useData<Json>("/api/admin/overview"+(refresh?"?r="+refresh:""));
 const urgent=attention?Object.values(attention.attention as Record<string,number>).reduce((n,v)=>n+Number(v||0),0):0;
 const notify=useCallback((text:string,error?:boolean)=>{setNotice({text,error});setTimeout(()=>setNotice(null),3500);},[]);
 const go=(v:View)=>{setView(v);const url=new URL(window.location.href);url.searchParams.set("vue",v);window.history.replaceState(null,"",url);window.scrollTo({top:0});};
 const current=VIEWS.find(v=>v.id===view)!;
 return <div className="adm">
  <nav className="adm-nav" aria-label="Administration"><div className="adm-brand">Braand <small>Administration</small></div>
   {VIEWS.map(v=><button key={v.id} aria-current={v.id===view?"page":undefined} onClick={()=>go(v.id)}>{v.label}{v.id==="overview"&&urgent>0?<span className="adm-badge">{urgent}</span>:null}</button>)}
   <div className="adm-nav-foot"><Link href="/">← Retour à Braand</Link></div></nav>
  <div>
   <div className="adm-mobile-tabs" role="tablist">{VIEWS.map(v=><button key={v.id} aria-current={v.id===view?"page":undefined} onClick={()=>go(v.id)}>{v.label}</button>)}</div>
   <main className="adm-main" key={view+refresh}>
    <div className="adm-head"><div><h1>{current.label}</h1><p>{current.help}</p></div><button className="adm-btn" onClick={()=>setRefresh(r=>r+1)}>Actualiser</button></div>
    {view==="overview"?<Overview/>:view==="users"?<Users notify={notify}/>:view==="finance"?<Finance/>:view==="ai"?<Ai/>:view==="quality"?<System part="quality"/>:view==="media"?<Media/>:view==="system"?<System part="system"/>:<Audit/>}
   </main>
  </div>
  {notice?<div className={"adm-notice"+(notice.error?" error":"")} role="status">{notice.text}</div>:null}
 </div>;
}
