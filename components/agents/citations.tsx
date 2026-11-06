'use client';

import { FileText, Globe2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CitationItem {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
  icon?: ReactNode;
}

/** Sources are untrusted: only explicit web URLs can become links. */
export function citationUrl(value?: string) {
  if (!value || !/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url;
  } catch { return undefined; }
}

export function CitationStack({ citations, limit = 3, className }: { citations: CitationItem[]; limit?: number; className?: string }) {
  return <span className={cn('response-citation-stack', className)} aria-hidden="true">
    {citations.slice(0, Math.max(0, limit)).map((source, index) => <span className="response-citation-symbol" key={`${source.id}-${index}`}>
      {source.icon ?? (citationUrl(source.url) ? <Globe2 /> : <FileText />)}
    </span>)}
  </span>;
}

export function CitationList({ citations, idPrefix = 'response-source', className }: { citations: CitationItem[]; idPrefix?: string; className?: string }) {
  return <ol className={cn('response-citation-list', className)} aria-label="Sources de la réponse">
    {citations.map((source, index) => {
      const url = citationUrl(source.url);
      const content = <><span className="response-citation-number" aria-hidden="true">{index + 1}</span><span className="response-citation-text"><span className="response-citation-title">{source.title}</span><span className="response-citation-domain">{url ? url.hostname : source.domain ?? 'Document joint'}</span></span></>;
      return <li id={`${idPrefix}-${index + 1}`} key={`${source.id}-${index}`}>
        {url ? <a href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{content}<span className="sr-only"> (nouvel onglet)</span></a> : <div className="response-citation-document">{content}</div>}
      </li>;
    })}
  </ol>;
}

/** A cited passage: the end of its text and the 1-based numbers of its sources. */
export interface CitationMark { after: string; sources: number[] }

const OPEN = '\uE000', CLOSE = '\uE001';
/** Matches the private markers placed by withCitationMarks; the model never writes them. */
export const CITATION_MARKER = /(\uE000[0-9,]{1,16}\uE001)/;

/**
 * Places a marker right after each cited passage. A passage not found in the
 * text (rewritten, cut) gets no chip; its sources stay in the list below.
 */
export function withCitationMarks(text: string, marks: CitationMark[] | undefined, count: number) {
  if (!marks?.length || !count) return text;
  let out = text.replace(/[\uE000\uE001]/g, ''), from = 0;
  for (const mark of marks) {
    const numbers = mark.sources.filter(n => Number.isInteger(n) && n >= 1 && n <= count);
    const after = mark.after.replace(/[\uE000\uE001]/g, '').trimEnd();
    if (!numbers.length || !after) continue;
    const at = out.indexOf(after, from);
    if (at < 0) continue;
    const end = at + after.length, token = OPEN + numbers.join(',') + CLOSE;
    out = out.slice(0, end) + token + out.slice(end);
    from = end + token.length;
  }
  return out;
}

const CitationContext = createContext<CitationItem[]>([]);
export function CitationProvider({ sources, children }: { sources: CitationItem[] | undefined; children: ReactNode }) {
  return <CitationContext.Provider value={sources ?? []}>{children}</CitationContext.Provider>;
}

/** An inline source chip: the first source's site, plus how many others back the passage. */
export function CitationChip({ marker }: { marker: string }) {
  const sources = useContext(CitationContext);
  const numbers = marker.slice(1, -1).split(',').map(Number).filter(n => n >= 1 && n <= sources.length);
  if (!numbers.length) return null;
  const first = sources[numbers[0] - 1], url = citationUrl(first.url);
  const label = numbers.map(n => `${n}. ${typeof sources[n - 1].title === 'string' ? sources[n - 1].title : 'Source'}`).join(' · ');
  const body = <>{url ? <Globe2 aria-hidden="true" /> : <FileText aria-hidden="true" />}<span>{url ? url.hostname.replace(/^www\./, '') : first.domain ?? 'Document joint'}</span>{numbers.length > 1 && <span className="response-citation-more">+{numbers.length - 1}</span>}</>;
  return url
    ? <a className="response-citation-chip" href={url.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={label} aria-label={`Source : ${label} (nouvel onglet)`}>{body}</a>
    : <span className="response-citation-chip" title={label} role="note" aria-label={`Source : ${label}`}>{body}</span>;
}
