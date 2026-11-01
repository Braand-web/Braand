"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,post} from '@/lib/client-api';
import type {VaultEntry,VaultOverview} from '@/lib/browser-vault';
import './browser-security.css';

export function SecureLoginForm({sessionId,initialOrigin='',onSaved}:{sessionId?:string;initialOrigin?:string;onSaved?:()=>void}){
 const [ticket,setTicket]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const form=useRef<HTMLFormElement>(null);
 useEffect(()=>{const controller=new AbortController(),currentForm=form.current;void api<{token:string}>('/api/browser/vault/capture-ticket',{...post({}),signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setTicket(value.token);}).catch(()=>{if(!controller.signal.aborted)setError('La saisie sécurisée est indisponible. Aucun identifiant ne sera envoyé.');});return()=>{controller.abort();currentForm?.reset();};},[]);
 const save=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!ticket||busy)return;
  const current=event.currentTarget,data=new FormData(current),persist=!sessionId||data.get('persist')==='on';
  const values={captureToken:ticket,origin:String(data.get('origin')||''),label:String(data.get('label')||''),username:String(data.get('username')||''),password:String(data.get('password')||''),persist,usagePermission:String(data.get('usagePermission')||'ask'),...(sessionId?{sessionId,approved:true}:{})};
  const input=current.elements.namedItem('password') as HTMLInputElement|null;if(input)input.value='';
  setBusy(true);setError('');setNotice('');setTicket(null);
  try{
   const result=await api<{credential?:VaultEntry;saved:boolean;filled?:boolean}>('/api/browser/vault/save',post(values));
   if(sessionId&&result.credential){setNotice('Identifiant enregistré. Remplissage en cours…');await api('/api/browser/vault/fill',post({sessionId,credentialId:result.credential.id,approved:true}));}
   current.reset();setNotice(sessionId?'Champs remplis. Vérifiez la page avant de soumettre le formulaire.':'Identifiant enregistré dans votre coffre privé.');onSaved?.();
  }catch(problem){setError(problem instanceof Error?problem.message:'La saisie n’a pas pu être confirmée.');}
  finally{values.username='';values.password='';setBusy(false);void api<{token:string}>('/api/browser/vault/capture-ticket',post({})).then(value=>setTicket(value.token)).catch(()=>{});}
 };
 return <form className="secure-login-form" ref={form} onSubmit={save} aria-label="Saisie sécurisée d’un identifiant" aria-busy={busy}>
  <p>Ces champs sont transmis au coffre sécurisé. Ils ne sont pas envoyés au modèle ni ajoutés à la conversation.</p>
  {error&&<p role="alert" className="browser-security-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <label>Site HTTPS<input name="origin" type="url" required defaultValue={initialOrigin} placeholder="https://compte.exemple.fr" autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
  <label>Libellé<input name="label" required maxLength={120} placeholder="Mon compte professionnel" disabled={busy}/></label>
  <label>Identifiant<input name="username" autoComplete="username" maxLength={1000} autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
  <label>Mot de passe<input name="password" type="password" autoComplete="new-password" required maxLength={4096} disabled={busy}/></label>
  <label className="browser-security-check"><input name="persist" type="checkbox" defaultChecked disabled={busy||!sessionId}/>Enregistrer dans mon coffre</label>
  {sessionId&&<p className="browser-security-help">Décochez pour un remplissage unique, sans conservation dans le coffre.</p>}
  <label>Utilisation future<select name="usagePermission" defaultValue="ask" disabled={busy}><option value="ask">Toujours me demander</option><option value="auto">Utiliser selon mes permissions de navigateur</option></select></label>
  <button type="submit" disabled={busy||!ticket}>{busy?'Transmission sécurisée…':sessionId?'Remplir dans cette session':'Enregistrer l’identifiant'}</button>
 </form>;
}

export function BrowserLoginControls({sessionId,origin}:{sessionId:string;origin:string}){
 const [overview,setOverview]=useState<VaultOverview|null>(null),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [challenge,setChallenge]=useState<{nonce:string;expiresAt:number;origin:string}|null>(null);
 const load=()=>api<VaultOverview>('/api/browser/vault').then(setOverview).catch(()=>setOverview(null));
 useEffect(()=>{let mounted=true;void api<VaultOverview>('/api/browser/vault').then(value=>{if(mounted)setOverview(value);}).catch(()=>{});return()=>{mounted=false;};},[sessionId]);
 const fill=async(id:string)=>{setBusy(true);setMessage('');try{await api('/api/browser/vault/fill',post({sessionId,credentialId:id,approved:true}));setMessage('Champs remplis. La soumission du formulaire reste distincte.');}catch(error){setMessage(error instanceof Error?error.message:'Remplissage indisponible.');}finally{setBusy(false);}};
 const prepareCode=async()=>{setBusy(true);setMessage('');try{setChallenge(await api('/api/browser/vault/otp/prepare',post({sessionId})));}catch{setMessage('Le champ de code doit être visible et prêt. Après deux saisies, vérifiez la page manuellement.');}finally{setBusy(false);}};
 const submitCode=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!challenge||busy)return;const field=event.currentTarget.elements.namedItem('code') as HTMLInputElement,code=field.value;field.value='';setBusy(true);setMessage('');
  try{if(Date.now()>=challenge.expiresAt)throw Error('Le champ doit être préparé à nouveau avant de demander un code frais.');await api('/api/browser/vault/otp/fill',post({sessionId,nonce:challenge.nonce,code}));setMessage('Code transmis au champ. Vérifiez la page avant de continuer.');}catch(error){setMessage(error instanceof Error?error.message:'Le code n’a pas pu être transmis.');}finally{setChallenge(null);setBusy(false);}
 };
 if(!overview?.ready)return null;
 return <details className="browser-disclosure browser-security"><summary>Connexion sécurisée</summary><p>La saisie reste dans cette session. Rendre la main n’autorise aucun envoi, achat ou publication.</p>
  {message&&<p role="status">{message}</p>}
  {overview.credentials.map(entry=><div className="browser-security-entry" key={entry.id}><span>{entry.label}<small>{entry.origin}</small></span><button type="button" disabled={busy} onClick={()=>void fill(entry.id)}>Remplir</button></div>)}
  <button type="button" aria-expanded={adding} onClick={()=>setAdding(value=>!value)}>Saisir un autre identifiant</button>
  {adding&&<SecureLoginForm sessionId={sessionId} initialOrigin={origin} onSaved={()=>void load()}/>}
  {challenge?<form onSubmit={submitCode} className="secure-login-form"><label>Code frais pour {challenge.origin}<input name="code" type="password" autoComplete="one-time-code" required minLength={4} maxLength={32} disabled={busy}/></label><button type="submit" disabled={busy}>Transmettre le code</button><button type="button" onClick={()=>setChallenge(null)}>Annuler la saisie</button></form>:<button type="button" disabled={busy} onClick={()=>void prepareCode()}>Préparer une saisie de code</button>}
 </details>;
}
