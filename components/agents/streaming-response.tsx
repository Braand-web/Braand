'use client';

import { Check, ChevronDown, Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { CitationList, CitationStack, type CitationItem } from './citations';
import { AgentDisclosure } from './agent-disclosure';
import { cn } from '@/lib/utils';
import './streaming-response.css';

export type StreamingResponseStatus = 'streaming' | 'complete' | 'error' | 'cancelled' | 'unknown';
export type StreamingResponseFeedback = 'up' | 'down' | null;
export interface StreamingResponseProps {
  children: ReactNode;
  status?: StreamingResponseStatus;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  onRetry?: () => void;
  sources?: CitationItem[];
  sourcesOpen?: boolean;
  defaultSourcesOpen?: boolean;
  onSourcesOpenChange?: (open: boolean) => void;
  sourceIdPrefix?: string;
  feedback?: StreamingResponseFeedback;
  /** Show a short invitation to rate (long or productive answers). */
  askFeedback?: boolean;
  defaultFeedback?: StreamingResponseFeedback;
  onFeedbackChange?: (feedback: StreamingResponseFeedback) => void | Promise<void>;
  showFeedback?: boolean;
  announce?: boolean;
  showActions?: boolean;
  className?: string;
  contentClassName?: string;
  actionsClassName?: string;
}

function ResponseAction({ label, active, children, title, ...props }: ComponentProps<'button'> & { label: string; active?: boolean }) {
  return <button type="button" {...props} className="response-action" aria-label={label} title={title ?? label} aria-pressed={active}>{children}</button>;
}

/** Adapted from beUI: actions reflect actual stream and persistence outcomes. */
export function StreamingResponse({ children, askFeedback = false, status = 'streaming', copyText, onCopy, onRetry, sources = [], sourcesOpen, defaultSourcesOpen = false, onSourcesOpenChange, sourceIdPrefix, feedback, defaultFeedback = null, onFeedbackChange, showFeedback = true, announce = true, showActions = true, className, contentClassName, actionsClassName }: StreamingResponseProps) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState('');
  const [internalFeedback, setInternalFeedback] = useState(defaultFeedback);
  const [internalSourcesOpen, setInternalSourcesOpen] = useState(defaultSourcesOpen);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyPending = useRef(false);
  const votePending = useRef(false);
  const mounted = useRef(false);
  const currentFeedback = feedback !== undefined ? feedback : internalFeedback;
  const currentSourcesOpen = sourcesOpen !== undefined ? sourcesOpen : internalSourcesOpen;
  const streaming = status === 'streaming';
  const canCopy = Boolean(copyText || onCopy);
  const canVote = status === 'complete' && showFeedback;
  const actions = showActions && !streaming && (canCopy || onRetry || canVote || sources.length > 0);
  const sourcesContentId = `${id}-sources`;
  const resolvedSourcePrefix = sourceIdPrefix ?? `response-source-${id.replace(/[^a-z0-9_-]/gi, '')}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(copyTimer.current); };
  }, []);

  async function handleCopy() {
    if (copyPending.current) return;
    copyPending.current = true; setCopying(true); setCopied(false); setError('');
    try {
      if (onCopy) await onCopy();
      else {
        if (!navigator.clipboard?.writeText || !copyText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(copyText);
      }
      if (!mounted.current) return;
      setCopied(true); clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      if (mounted.current) setError('Copie impossible. Sélectionnez le texte pour le copier.');
    } finally {
      copyPending.current = false;
      if (mounted.current) setCopying(false);
    }
  }

  async function setFeedback(next: Exclude<StreamingResponseFeedback, null>) {
    if (votePending.current) return;
    votePending.current = true; setVoting(true); setError('');
    const value = currentFeedback === next ? null : next;
    try {
      await onFeedbackChange?.(value);
      if (mounted.current && feedback === undefined) setInternalFeedback(value);
    } catch {
      if (mounted.current) setError('Avis non enregistré. Réessayez.');
    } finally {
      votePending.current = false;
      if (mounted.current) setVoting(false);
    }
  }

  function toggleSources() {
    const value = !currentSourcesOpen;
    if (sourcesOpen === undefined) setInternalSourcesOpen(value);
    onSourcesOpenChange?.(value);
  }

  return <div className={cn('streaming-response', className)} data-slot="streaming-response" data-state={status} aria-busy={streaming}>
    <div className={cn('streaming-response-content', contentClassName)} aria-live={announce ? 'polite' : 'off'} aria-atomic={false}>{children}</div>
    {(status === 'error' || status === 'cancelled') && <p className="response-stream-state" role="status">{status === 'error' ? 'Réponse interrompue. Le texte déjà reçu est conservé.' : 'Réponse arrêtée à votre demande.'}</p>}
    {actions && <div className="response-footer">
      <div className={cn('response-actions', actionsClassName)}>
        {canCopy && <ResponseAction label={copied ? 'Réponse copiée' : 'Copier la réponse'} disabled={copying} onClick={() => { void handleCopy(); }}>{copied ? <Check /> : <Copy />}</ResponseAction>}
        {onRetry && <ResponseAction label="Reprendre la demande" title="Remettre la demande dans le champ de saisie avant un nouvel envoi" onClick={onRetry}><RotateCcw /></ResponseAction>}
        {canVote && <>
          {askFeedback && !currentFeedback && <span className="response-feedback-ask">Cette réponse vous a aidé ?</span>}
          <ResponseAction label="Réponse utile" active={currentFeedback === 'up'} disabled={voting} onClick={() => { void setFeedback('up'); }}><ThumbsUp /></ResponseAction>
          <ResponseAction label="Réponse peu utile" active={currentFeedback === 'down'} disabled={voting} onClick={() => { void setFeedback('down'); }}><ThumbsDown /></ResponseAction>
        </>}
        {sources.length > 0 && <button type="button" className="response-sources-toggle" aria-expanded={currentSourcesOpen} aria-controls={sourcesContentId} onClick={toggleSources}>
          <CitationStack citations={sources} /><span>{sources.length} {sources.length === 1 ? 'source' : 'sources'}</span><ChevronDown aria-hidden="true" />
        </button>}
      </div>
      <span className="sr-only" role="status">{copied ? 'Réponse copiée dans le presse-papiers.' : voting ? 'Enregistrement de votre avis…' : ''}</span>
      {error && <p className="response-action-error" role="status">{error}</p>}
      {sources.length > 0 && <AgentDisclosure id={sourcesContentId} open={currentSourcesOpen}><CitationList citations={sources} idPrefix={resolvedSourcePrefix} /></AgentDisclosure>}
    </div>}
  </div>;
}
