"use client";
import {useState,useEffect,useCallback} from 'react';
import {api,post} from '../../../lib/client-api';
import {LoadingSkeleton} from "@/components/ds/loading";
type Refund={id:string;order_id:string;amount:number;status:string;reason:string};
type Preview={id:string;amount:number;currency:'XAF';environment:'sandbox'|'live';expiresAt:number;plan:{revokedCredits:number;consumedCredits:number;cancelSubscription:boolean;refundTotal:number}};
type AdminData={readiness:{checks:Record<string,boolean>};orders:{id:string;organization_id:string;amount:number;status:string}[];usage:{provider:string;role:string;status:string;requests:number;cost:number|null}[];refunds:Refund[];events:{id:string;status:string;attempts:number}[];creditNotes:{id:string;number:string;document:string}[]};
const message=(error:unknown)=>error instanceof Error?error.message:'La demande a échoué. Actualisez et réessayez.';
const xaf=(amount:number)=>amount.toLocaleString('fr-FR')+' FCFA';
export default function Administration(){
 const [data,setData]=useState<AdminData>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('');
 const [selected,setSelected]=useState<Refund|null>(null),[amount,setAmount]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[reference,setReference]=useState(''),[evidence,setEvidence]=useState(''),[ack,setAck]=useState(false);
 const load=useCallback(async()=>{try{setData(await api<AdminData>('/api/admin/billing'));setError('');}catch(error){setError(message(error));}},[]);
 useEffect(()=>{let active=true;api<AdminData>('/api/admin/billing').then(result=>{if(active)setData(result);},error=>{if(active)setError(message(error));});return ()=>{active=false;};},[]);
 const perform=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();}catch(error){setError(message(error));}finally{setBusy(false);}};
 function selectRefund(refund:Refund){setSelected(refund);setAmount(String(refund.amount));setPreview(null);setReference('');setEvidence('');setAck(false);setError('');setNotice('');}
 return <main className="billing-page" style={{height:'100dvh'}}>
  <header className="billing-heading"><div><h1>Administration financière</h1><p>Accès réservé aux responsables configurés côté serveur.</p></div><button className="button secondary" disabled={busy} onClick={()=>void load()}>Actualiser</button></header>
  {error&&<p className="billing-alert error" role="alert">{error}</p>}{notice&&<p className="billing-alert" role="status">{notice}</p>}
  {!data&&!error&&<LoadingSkeleton label="Chargement de la facturation…" shape="table" count={6}/>}
  {data&&<>
   <h2 className="billing-subtitle">Conditions de lancement</h2>{Object.entries(data.readiness.checks).map(([key,value])=><div className="billing-line" key={key}><span>{key}</span><strong>{value?'Validé':'À vérifier'}</strong></div>)}
   <h2 className="billing-subtitle">Commandes récentes</h2><label className="billing-field">Commande ou organisation<input value={search} onChange={event=>setSearch(event.target.value)}/></label>
   {data.orders.filter(order=>(order.id+' '+order.organization_id).includes(search)).map(order=><div className="billing-line" key={order.id}><div><strong>{xaf(order.amount)} · {order.status}</strong><small>{order.id} · {order.organization_id}</small></div><button className="button secondary" disabled={busy} onClick={()=>void perform(async()=>{await api('/api/admin/billing',post({action:'reconcile',orderId:order.id}));await load();setNotice('État de la commande vérifié.');})}>Rapprocher</button></div>)}
   <h2 className="billing-subtitle">Consommations fournisseurs</h2><p className="billing-note">Les coûts inconnus restent à rapprocher. Ce relevé ne constitue pas une marge réalisée complète.</p>
   {data.usage.map((usage,index)=><div className="billing-line" key={index}><div><strong>{usage.provider} · {usage.role}</strong><small>{usage.status} · {usage.requests} appels</small></div><span>{usage.cost==null?'Coût à rapprocher':xaf(usage.cost)}</span></div>)}
   <h2 className="billing-subtitle">Remboursements</h2><p className="billing-note">Ces contrôles enregistrent une opération déjà confirmée auprès du prestataire. Aucun transfert de fonds n’est déclenché par Braand.</p>
   {!data.refunds.length?<p className="billing-empty">Aucune demande.</p>:data.refunds.map(refund=><div className="billing-line" key={refund.id}><div><strong>{xaf(refund.amount)} · {refund.status}</strong><small>{refund.order_id}</small><p>{refund.reason}</p></div>{['requested','partially_confirmed'].includes(refund.status)&&<button className="button secondary" disabled={busy} onClick={()=>selectRefund(refund)}>Examiner</button>}</div>)}
   {selected&&<section aria-labelledby="refund-review-title">
    <h3 id="refund-review-title" className="billing-subtitle">Rapprocher un remboursement externe</h3><p className="billing-note">Commande {selected.order_id}</p>
    <form onSubmit={event=>{event.preventDefault();void perform(async()=>{setPreview(await api('/api/admin/billing',post({action:'refund-preview',refundId:selected.id,amount:Number(amount)})));setAck(false);});}}>
     <label className="billing-field">Montant de cette opération en FCFA<input type="number" min="1" max={selected.amount} step="1" required value={amount} disabled={busy} onChange={event=>{setAmount(event.target.value);setPreview(null);setAck(false);}}/></label>
     <button className="button secondary" disabled={busy}>Vérifier le montant et les droits</button>
    </form>
    {preview&&<form onSubmit={event=>{event.preventDefault();void perform(async()=>{
     await api('/api/admin/billing',post({action:'refund-confirm-external',quoteId:preview.id,amount:preview.amount,currency:preview.currency,environment:preview.environment,externalReference:reference,evidenceNote:evidence,acknowledgement:'EXTERNAL_REFUND_CONFIRMED'}));
     setPreview(null);setSelected(null);await load();setNotice('Remboursement externe enregistré. Les crédits, droits et avoir ont été rapprochés.');
    });}}>
     <div className="billing-line"><span>Environnement de l’achat</span><strong>{preview.environment==='sandbox'?'Test (sandbox)':'Production (live)'}</strong></div>
     <div className="billing-line"><span>Montant de cette opération</span><strong>{xaf(preview.amount)}</strong></div>
     <div className="billing-line"><span>Cumul remboursé après confirmation</span><strong>{xaf(preview.plan.refundTotal)}</strong></div>
     <div className="billing-line"><span>Crédits retirés du solde</span><strong>{preview.plan.revokedCredits.toLocaleString('fr-FR')}</strong></div>
     {preview.plan.consumedCredits>0&&<p className="billing-alert">La décision comprend une concession sur {preview.plan.consumedCredits.toLocaleString('fr-FR')} crédits déjà consommés ou expirés.</p>}
     <p className="billing-note">{preview.plan.cancelSubscription?'L’abonnement acheté sera annulé, ainsi que ses prochaines allocations.':'Les dates d’abonnement sont conservées pour ce remboursement partiel ou cette recharge.'}</p>
     <label className="billing-field">Référence du remboursement confirmé chez le prestataire<input required minLength={4} maxLength={160} pattern="[a-zA-Z0-9._:/-]+" value={reference} disabled={busy} onChange={event=>setReference(event.target.value)}/></label>
     <label className="billing-field">Justificatif examiné (sans données de paiement sensibles)<textarea required minLength={10} maxLength={1000} value={evidence} disabled={busy} onChange={event=>setEvidence(event.target.value)}/></label>
     <label className="billing-note"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/> J’ai vérifié le remboursement externe, son montant, son environnement et les droits affichés.</label>
     <div className="billing-actions"><button className="button primary" disabled={busy||!ack}>{busy?'Enregistrement…':'Enregistrer la confirmation externe'}</button><button type="button" className="button secondary" disabled={busy} onClick={()=>{setSelected(null);setPreview(null);}}>Annuler</button></div>
    </form>}
   </section>}
   <h2 className="billing-subtitle">Avoirs émis</h2>{!data.creditNotes.length?<p className="billing-empty">Aucun avoir.</p>:data.creditNotes.map(note=><div className="billing-line" key={note.id}><span>{note.number}</span><span>{xaf((JSON.parse(note.document) as {total:number}).total)}</span></div>)}
   <h2 className="billing-subtitle">Événements à traiter</h2>{!data.events.length?<p className="billing-empty">Aucun événement en attente.</p>:data.events.map(event=><div className="billing-line" key={event.id}><span>{event.id}</span><span>{event.status} · {event.attempts} tentatives</span></div>)}
  </>}
 </main>;
}
