'use client';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AiStatus } from '@/components/ui/ai-status';
import { api } from '@/lib/client-api';
import type { Resource } from '@/lib/contracts';
import './media-generation-preview.css';

const GridReveal = lazy(() => import('@/components/ui/grid-reveal'));
type GenerationState = 'waiting' | 'generating' | 'checking' | 'error' | 'uncertain';
type PollResult = {status:string;resourceId?:string};
const MAX_CHECKS = 120;
const POLL_INTERVAL_MS = 5000;

/** Only observes a previously approved operation. It never submits a generation. */
export function MediaGenerationPreview({proposal,kind,onReady}:{proposal:Resource;kind?:string;onReady:(resource:Resource)=>void}) {
  const [state,setState] = useState<GenerationState>('checking');
  const [reason,setReason] = useState('');
  const [attempt,setAttempt] = useState(0);
  const callbacks = useRef({onReady});
  useEffect(() => {callbacks.current = {onReady};});
  useEffect(() => {
    let disposed = false, stopped = false, inFlight = false, checks = 0, failures = 0;
    let timeout:ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      if(disposed || stopped || inFlight || document.hidden || !navigator.onLine) return;
      inFlight = true;
      try {
        const data = await api<PollResult>('/api/proposals/'+encodeURIComponent(proposal.id),{signal:controller.signal});
        if(disposed) return;
        checks++; failures = 0;
        if(data.status === 'COMPLETED' && data.resourceId) {
          const resource = await api<Resource>('/api/resources/'+encodeURIComponent(data.resourceId),{signal:controller.signal});
          if(!disposed) {
            if(resource.kind !== 'media' || resource.status !== 'ready') throw new Error('Le résultat doit encore être vérifié.');
            stopped = true;
            callbacks.current.onReady(resource);
          }
          return;
        }
        if(['needs_reconciliation','submitting','uncertain'].includes(data.status)) {
          stopped = true; setState('uncertain'); setReason('Le résultat du service de création doit être vérifié. Aucune nouvelle demande n’est envoyée.'); return;
        }
        if(['failed','rejected','cancelled'].includes(data.status)) {
          stopped = true; setState('error'); setReason(data.status === 'cancelled' ? 'La génération a été annulée.' : 'La génération n’a pas abouti. Consultez son état avant toute nouvelle demande.'); return;
        }
        if(!['IN_QUEUE','IN_PROGRESS','generating','waiting_external','settling'].includes(data.status)) {
          stopped = true; setState('uncertain'); setReason('Aucune confirmation exploitable pour le moment. Vous pouvez vérifier de nouveau.'); return;
        }
        setState(data.status === 'IN_QUEUE' ? 'waiting' : 'generating');
        setReason('');
        if(checks >= MAX_CHECKS) {stopped = true;setState('uncertain');setReason('Le résultat prend plus de temps que prévu. Vous pouvez reprendre la vérification.');return;}
        timeout = setTimeout(poll,POLL_INTERVAL_MS);
      } catch(error) {
        if(disposed) return;
        failures++;
        if(failures < 3) timeout = setTimeout(poll,POLL_INTERVAL_MS * failures);
        else {stopped = true;setState('error');setReason(error instanceof Error ? error.message : 'Impossible de vérifier cette génération.');}
      } finally {inFlight = false;}
    };
    const resume = () => {if(!disposed && !document.hidden && navigator.onLine) {clearTimeout(timeout);void poll();}};
    const offline = () => {clearTimeout(timeout);setState('uncertain');setReason('Connexion interrompue. Le suivi reprendra au retour du réseau.');};
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('online',resume);
    window.addEventListener('offline',offline);
    if(navigator.onLine) void poll(); else offline();
    return () => {disposed = true;clearTimeout(timeout);controller.abort();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',offline);};
  },[proposal.id,attempt]);
  const pending = state === 'waiting' || state === 'generating' || state === 'checking';
  const caption = state === 'waiting' ? 'En attente du service de création' : state === 'checking' ? 'Vérification de la génération' : 'Création de votre visuel';
  return <div className="media-generation-preview">
    {kind === 'image' && <Suspense fallback={<div className="media-generation-placeholder" aria-hidden="true"/>}>
      <GridReveal caption={caption} status={pending ? 'pending' : 'error'} errorMessage={reason} onRetry={() => {setState('checking');setReason('');setAttempt(value=>value+1);}}/>
    </Suspense>}
    <AiStatus state={pending ? 'analyzing' : state === 'error' ? 'error' : 'waiting'} states={{waiting:{active:false}}} label={pending ? (kind === 'image' ? caption : 'Suivi de votre génération') : 'Vérification nécessaire'} timer={false}/>
    {reason && <p className="media-generation-reason" role="status">{reason}</p>}
    <button type="button" className="button secondary small" disabled={state === 'checking'} onClick={()=>{setState('checking');setReason('');setAttempt(value=>value+1);}}>Vérifier l’état</button>
    <p className="media-generation-note">Le suivi consulte la génération déjà approuvée.</p>
  </div>;
}

export function GeneratedImage({src,alt,width,height,animate,onRevealed}:{src:string;alt:string;width?:number;height?:number;animate:boolean;onRevealed:()=>void}) {
  const ratio = width && height && width > 0 && height > 0 ? width / height : 1;
  const [revealed,setRevealed] = useState(false),[attempt,setAttempt] = useState(0);
  // A failed load (network hiccup, storage still propagating) is retried twice; the paid generation never is.
  const shown = attempt ? src + (src.includes('?') ? '&' : '?') + 'retry=' + attempt : src;
  if(!animate || revealed) return <Image key={shown} unoptimized src={shown} alt={alt} width={width || 1024} height={height || 1024} loading="lazy" decoding="async" style={{width:'100%',height:'auto'}} onError={() => {if(attempt < 2) setTimeout(() => setAttempt(value => value + 1), 400 * (attempt + 1));}}/>;
  return <Suspense fallback={<div className="media-generation-placeholder" style={{aspectRatio:ratio}} role="status" aria-label="Chargement du visuel"/>}>
    <GridReveal src={src} alt={alt} aspect={ratio} caption="Votre visuel arrive" onRevealComplete={()=>{setRevealed(true);onRevealed();}}/>
  </Suspense>;
}
