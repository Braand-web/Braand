'use client';
import {useEffect,useState} from 'react';
import {api} from '@/lib/client-api';
import type {BrowserProfileDTO} from '@/lib/browser-contracts';

export function BrowserProfiles(){
 const [profiles,setProfiles]=useState<BrowserProfileDTO[]>([]),[error,setError]=useState(''),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{const controller=new AbortController();void api<{profiles:BrowserProfileDTO[]}>('/api/browser',{signal:controller.signal}).then(result=>setProfiles(Array.isArray(result.profiles)?result.profiles:[])).catch(()=>{if(!controller.signal.aborted)setError('Les profils sont indisponibles.');});return()=>controller.abort();},[]);
 const remove=async(id:string)=>{if(busy)return;setBusy(true);try{await api('/api/browser/profiles/'+encodeURIComponent(id),{method:'DELETE'});setProfiles(current=>current.filter(item=>item.id!==id));setPending(null);}catch{setError('Le profil n’a pas pu être supprimé. Réessayez.');}finally{setBusy(false);}};
 return <details className="browser-disclosure"><summary>Profils de navigation privés ({profiles.length})</summary>{error&&<p role="alert">{error}</p>}{profiles.map(profile=><div key={profile.id}><strong>{profile.name}</strong><p>Expire le {new Date(profile.expiresAt).toLocaleDateString('fr')}</p>{pending===profile.id?<><button type="button" className="button secondary" disabled={busy} onClick={()=>void remove(profile.id)}>Confirmer la suppression</button><button type="button" className="button secondary" onClick={()=>setPending(null)}>Annuler</button></>:<button type="button" className="button secondary" onClick={()=>setPending(profile.id)}>Supprimer</button>}</div>)}</details>;
}
