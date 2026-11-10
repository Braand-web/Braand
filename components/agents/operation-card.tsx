'use client';
import {useRef,useState} from 'react';
import {Check,RefreshCw} from 'lucide-react';
import type {Resource} from '@/lib/contracts';
import {api,post} from '@/lib/client-api';
import './operation-card.css';

const names:Record<string,string>={draft:'Brouillon',tested:'Test réussi',active:'Actif',disabled:'Désactivé',ready:'Disponible',running:'En cours',completed:'Terminé',failed:'Échec'};
type Props={resource:Resource;conversationId?:string;onUpdated?:()=>void;onAsk:(text:string)=>void;onOpen?:(resource:Resource)=>void};
export function AgentOperationCard({resource,conversationId,onUpdated,onAsk,onOpen}:Props){
 const [localItem,setItem]=useState(resource),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const lock=useRef(false);
 const item=localItem.id!==resource.id||resource.version>localItem.version?resource:localItem;
 const act=async(action:string)=>{
  if(lock.current||!conversationId)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await api<Resource&{signingKey?:string}>('/api/agent-operations',post({conversationId,kind:item.kind,id:item.id,version:item.version,action,...(item.kind==='workflow'?{digest:item.data.digest}:{}),confirmed:action==='activate'}));
   if(action==='signing_key'){
    if(typeof result.signingKey!=='string')throw new Error('La clé est indisponible.');
    // Never place signing keys in a message, DOM, preview or persisted UI state.
    await navigator.clipboard.writeText(result.signingKey);setNotice('Clé de signature copiée.');
   }else{setItem(result);setNotice(action==='test'?'Résultat du test enregistré.':action==='activate'?'Activation confirmée.':'Désactivation confirmée.');onUpdated?.();}
  }catch(e){setError(e instanceof Error?e.message:'Action indisponible.');}finally{lock.current=false;setBusy(false);}
 };
 const refresh=async()=>{
  if(lock.current||!conversationId)return;lock.current=true;setBusy(true);setError('');
  try{const result=await api<{items:Resource[]}>('/api/agent-operations?conversationId='+encodeURIComponent(conversationId));const current=result.items.find(r=>r.id===item.id);if(!current)throw new Error('Cet élément n’est plus disponible dans la liste actuelle. Demandez à Braand de le retrouver.');setItem(current);setNotice('Version actuelle chargée.');}catch(e){setError(e instanceof Error?e.message:'Actualisation impossible.');}finally{lock.current=false;setBusy(false);}
 };
 const isWorkflow=item.kind==='workflow',isEvent=item.kind==='event_subscription',isProfile=item.kind==='agent_profile',isRun=item.kind==='workflow_run';
 const rows=isRun&&Array.isArray(item.data.rows)?item.data.rows:[],rowCount=typeof item.data.rowCount==='number'?item.data.rowCount:rows.length,test=item.data.test&&typeof item.data.test==='object'?item.data.test as Record<string,unknown>:null;
 return <section className="agent-operation-card" aria-label={item.title} aria-busy={busy}>
  <header><div><strong>{item.title}</strong><p>{isProfile?'Spécialiste du projet':isEvent?'Événement signé':isRun?'Résultat enregistré':'Workflow de tableaux'} · {names[item.status]||item.status} · Version {item.version}</p></div>{item.status==='completed'&&<Check size={18} aria-label="Traitement terminé"/>}</header>
  {isProfile&&<p>{String(item.data.objective||'')}</p>}
  {isWorkflow&&<p>Traite des tableaux en privé, sans appel à un modèle, envoi ni publication.</p>}
  {isEvent&&<p>Chaque événement signé exécute uniquement le workflow de tableaux lié. Aucun message n’est envoyé. Plafond : {String(item.data.maxEvents)} événements. Expiration : {new Date(Number(item.data.expiresAt)).toLocaleString('fr-FR')}.</p>}
  {isRun&&<p>{rowCount} ligne{rowCount>1?'s':''} dans le résultat. Les données sources et la version précédente sont conservées.</p>}
  {test&&<p className="operation-test">{test.passed===true?'Le cas de test correspond au résultat attendu.':'Le résultat du test doit être corrigé.'} Ce contrôle porte sur cet exemple.</p>}
  <div className="operation-actions">
   {isWorkflow&&item.status==='draft'&&<button type="button" disabled={busy||!conversationId} onClick={()=>void act('test')}>Tester l’exemple</button>}
   {isWorkflow&&item.status==='tested'&&<button type="button" disabled={busy||!conversationId} onClick={()=>void act('activate')}>Activer le workflow</button>}
   {isEvent&&['draft','disabled'].includes(item.status)&&<button type="button" disabled={busy||!conversationId} onClick={()=>void act('activate')}>Activer le webhook</button>}
   {(isEvent||isWorkflow)&&item.status==='active'&&<button type="button" disabled={busy||!conversationId} onClick={()=>void act('disable')}>Désactiver</button>}
   {isEvent&&item.status==='active'&&<button type="button" disabled={busy||!conversationId} onClick={()=>void act('signing_key')}>Copier la clé de signature</button>}
   {!isRun&&<button type="button" disabled={busy} onClick={()=>onAsk('Modifie '+(isProfile?'le profil':'le workflow')+' « '+item.title+' », identifiant '+item.id+', version '+item.version+'. Lis sa version actuelle et conserve le reste. Ma demande : ')}>Modifier avec Braand</button>}
   {isRun&&conversationId&&<a className="operation-download" href={"/api/agent-operations?conversationId="+encodeURIComponent(conversationId)+"&id="+encodeURIComponent(item.id)+"&format=csv"}>Télécharger le tableau</a>}{onOpen&&<button type="button" onClick={()=>onOpen(item)}>Voir les détails</button>}
   <button type="button" className="operation-refresh" aria-label="Actualiser cet élément" disabled={busy||!conversationId} onClick={()=>void refresh()}><RefreshCw size={15}/></button>
  </div>
  {isEvent&&<details><summary>Configurer la réception</summary><p>URL : <code>{typeof window!=='undefined'?window.location.origin:''}/api/webhooks/agent-events/{item.id}</code></p><p>La clé copiée sert à signer chaque corps JSON avec HMAC-SHA256. En-têtes et exemple dans la documentation. Elle ne doit pas être collée dans la conversation.</p></details>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
