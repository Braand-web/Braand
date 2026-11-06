"use client";
// Questions Braand asks before a task, one at a time, inside the conversation.
// The stack slides to the active question (the card's height follows it), the
// step counter rolls like an odometer, a single choice moves on by itself and
// a multiple choice waits for « Continuer ». Answers are checked and saved by
// the server (version, audit); they never authorise a spend or a publication.
import {useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';
import {Check, ChevronDown, ChevronUp} from 'lucide-react';
import {api, post} from '@/lib/client-api';
import type {Resource} from '@/lib/contracts';
import {Button} from './ds';
import './brief-card.css';

type Question = {q: string; type: 'radio' | 'check' | 'text'; options: string[]; optional: boolean};
type Answer = {selected: number[]; custom: string; skipped: boolean};
type Props = {resource: Resource; onSaved: (resource: Resource) => void; onContinue: () => void; inline?: boolean};

const ROLL_MS = 400, ADVANCE_MS = 480;

/** Each character that changes rolls up (or down when going back). */
function RollingDigits({value}: {value: string}) {
 const [seen, setSeen] = useState(value);
 const [roll, setRoll] = useState<{from: string; to: string; down: boolean; shifted: boolean} | null>(null);
 // A new value starts a roll during render (no effect cascade); timers finish it.
 if (seen !== value) {
  setSeen(value);
  setRoll(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : {from: seen, to: value, down: parseInt(value, 10) < parseInt(seen, 10), shifted: false});
 }
 useEffect(() => {
  if (!roll || roll.shifted) return;
  let second = 0;
  const first = requestAnimationFrame(() => {second = requestAnimationFrame(() => setRoll(current => current && {...current, shifted: true}));});
  return () => {cancelAnimationFrame(first);cancelAnimationFrame(second);};
 }, [roll]);
 useEffect(() => {
  if (!roll) return;
  const done = setTimeout(() => setRoll(null), ROLL_MS);
  return () => clearTimeout(done);
 }, [roll?.to]); // eslint-disable-line react-hooks/exhaustive-deps
 if (!roll) return <>{value}</>;
 return <>{Array.from(roll.to, (char, i) => {
  const old = roll.from[i] ?? '';
  if (old === char) return <span key={i}>{char}</span>;
  const [top, bottom] = roll.down ? [char, old] : [old, char];
  const y = roll.down ? (roll.shifted ? '0' : '-1em') : (roll.shifted ? '-1em' : '0');
  return <span key={i} className="qcard-digit"><span style={{transform: `translateY(${y})`}}><span>{top}</span><span>{bottom}</span></span></span>;
 })}</>;
}

function summary(question: Question, answer: Answer | undefined) {
 if (!answer || answer.skipped) return 'Passée';
 const parts = [...answer.selected.map(i => question.options[i]).filter(Boolean), answer.custom.trim()].filter(Boolean);
 return parts.join(', ') || 'Passée';
}

export default function BriefCard({resource: initial, onSaved, onContinue, inline = false}: Props) {
 // The latest copy known here (read again, or just saved) wins over an older prop.
 const [latest, setResource] = useState<Resource | null>(null);
 const resource = latest && latest.id === initial.id && latest.version >= initial.version ? latest : initial;
 // A card restored from history may be stale: read its current state once.
 useEffect(() => {
  if (!inline) return;
  let stop = false;
  api<Resource>('/api/resources/' + encodeURIComponent(initial.id)).then(next => {if (!stop) setResource(next);}).catch(() => undefined);
  return () => {stop = true;};
 }, [initial.id, inline]);

 const questions = (Array.isArray(resource.data.questions) ? resource.data.questions : []) as Question[];
 const [index, setIndex] = useState(0);
 const [answers, setAnswers] = useState<Answer[]>(() => questions.map(() => ({selected: [], custom: '', skipped: false})));
 const [error, setError] = useState(''), [busy, setBusy] = useState(false);
 const lock = useRef(false), advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const items = useRef<(HTMLDivElement | null)[]>([]), measured = useRef(false);
 const [frame, setFrame] = useState<{height?: number; y: number; animate: boolean}>({y: 0, animate: false});
 // Until the first measure only the active question is mounted, so the card
 // opens at its real height instead of flashing to the full stack.
 const ready = frame.height !== undefined;

 const question = questions[index], answer = answers[index], last = index === questions.length - 1;
 const valid = !!answer && (answer.selected.length > 0 || !!answer.custom.trim());

 const measure = (animate: boolean) => {
  const item = items.current[index];if (!item) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setFrame({height: item.offsetHeight, y: item.offsetTop, animate: animate && !reduce});
 };
 useLayoutEffect(() => {
  const animate = measured.current;measured.current = true;measure(animate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [index, answers, resource.status]);
 useEffect(() => {const id = requestAnimationFrame(() => measure(measured.current));return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [index, ready]);
 useEffect(() => () => {if (advanceTimer.current) clearTimeout(advanceTimer.current);}, []);

 const goTo = (next: number) => {if (advanceTimer.current) clearTimeout(advanceTimer.current);setIndex(Math.min(Math.max(next, 0), questions.length - 1));};
 const save = async (final: Answer[]) => {
  if (lock.current) return;lock.current = true;setBusy(true);setError('');
  try {const saved = await api<Resource>('/api/brief/' + resource.id, post({version: resource.version, answers: final}));setResource(saved);onSaved(saved);if (inline) onContinue();}
  catch (e) {setError(e instanceof Error ? e.message : 'Les réponses restent dans cette carte. Réessayez.');lock.current = false;}
  finally {setBusy(false);}
 };
 const advance = (skip = false) => {
  if (advanceTimer.current) clearTimeout(advanceTimer.current);
  const final = answers.map((a, i) => i === index ? {...a, skipped: skip} : a);setAnswers(final);
  if (!last) {goTo(index + 1);return;}
  // A required question left behind (reached with the arrows): go back to it.
  const missing = questions.findIndex((item, i) => !item.optional && !final[i].selected.length && !final[i].custom.trim());
  if (missing >= 0) {goTo(missing);setError('Cette question attend une réponse.');return;}
  void save(final);
 };
 const change = (at: number, value: Partial<Answer>) => setAnswers(current => current.map((a, i) => i === at ? {...a, ...value, skipped: false} : a));
 const pick = (option: number) => {
  if (busy) return;
  if (question.type === 'radio') {
   change(index, {selected: [option], custom: ''});
   if (advanceTimer.current) clearTimeout(advanceTimer.current);
   // Moves on by itself, except on the last question: sending stays a click.
   if (!last) advanceTimer.current = setTimeout(() => setIndex(i => Math.min(questions.length - 1, i + 1)), ADVANCE_MS);
  } else change(index, {selected: answer.selected.includes(option) ? answer.selected.filter(n => n !== option) : [...answer.selected, option]});
 };
 const onEnter = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && valid && !busy) {event.preventDefault();advance();}
 };

 if (!questions.length) return null;
 if (resource.status !== 'waiting_input') {
  const saved = (Array.isArray(resource.data.answers) ? resource.data.answers : []) as Answer[];
  return <section className={'qcard qcard-done' + (inline ? ' inline' : '')} aria-label="Réponses au brief">
   <p className="qcard-sent"><span aria-hidden="true"><Check size={11} strokeWidth={3}/></span>Réponses envoyées</p>
   {saved.length > 0 && <dl>{questions.map((item, i) => <div key={i}><dt>{item.q}</dt><dd>{summary(item, saved[i])}</dd></div>)}</dl>}
   {!inline && <Button variant="primary" size="sm" onClick={onContinue}>Continuer avec ces réponses</Button>}
   <small>Ces réponses ne donnent aucun accord de dépense ou de publication.</small>
  </section>;
 }

 return <section className={'qcard' + (inline ? ' inline' : '')} aria-label={String(resource.title || 'Questions de Braand')}>
  {String(resource.data.summary || '') && <p className="qcard-summary">{String(resource.data.summary)}</p>}
  <div className="qcard-viewport" aria-live="polite" style={{height: frame.height, transition: frame.animate ? undefined : 'none'}}>
   <div className="qcard-track" style={{transform: `translate3d(0, ${-frame.y}px, 0)`, transition: frame.animate ? undefined : 'none'}}>
    {questions.map((item, at) => {
     const active = at === index;
     if (!ready && !active) return null;
     const picked = answers[at]?.selected ?? [];
     return <div key={at} ref={el => {items.current[at] = el;}} className={'qcard-question' + (active ? ' active' : '')} aria-hidden={active ? undefined : true} inert={!active}>
      <p className="qcard-title" id={`${resource.id}-q${at}`}>{item.q}{item.optional && <span> (facultatif)</span>}</p>
      <div className="qcard-options" role={item.type === 'radio' ? 'radiogroup' : 'group'} aria-labelledby={`${resource.id}-q${at}`}>
       {item.options.map((option, i) => {
        const on = picked.includes(i);
        return <button key={i} type="button" role={item.type === 'radio' ? 'radio' : 'checkbox'} aria-checked={on} className={'qcard-option' + (on ? ' on' : '')} disabled={busy} onClick={() => pick(i)}>
         <span className={'qcard-mark ' + (item.type === 'radio' ? 'radio' : 'check')} aria-hidden="true">{item.type === 'check' && <Check size={11} strokeWidth={3}/>}</span>
         <span>{option}</span>
        </button>;
       })}
       {item.type === 'text'
        ? <textarea className="qcard-text" rows={3} maxLength={3000} value={answers[at]?.custom ?? ''} placeholder="Votre réponse…" aria-label="Votre réponse" disabled={busy} onKeyDown={onEnter} onChange={e => change(at, {custom: e.target.value})}/>
        : <input className="qcard-other" maxLength={3000} value={answers[at]?.custom ?? ''} placeholder="Autre chose…" aria-label="Autre réponse" disabled={busy} onKeyDown={onEnter} onChange={e => change(at, item.type === 'radio' ? {custom: e.target.value, selected: []} : {custom: e.target.value})}/>}
      </div>
     </div>;
    })}
   </div>
  </div>
  {error && <p className="qcard-error" role="alert">{error}</p>}
  <footer className="qcard-footer">
   <div className="qcard-steps">
    <button type="button" aria-label="Question précédente" disabled={index <= 0 || busy} onClick={() => goTo(index - 1)}><ChevronUp size={14}/></button>
    <span aria-label={`Question ${index + 1} sur ${questions.length}`}><RollingDigits value={`${index + 1} / ${questions.length}`}/></span>
    <button type="button" aria-label="Question suivante" disabled={last || busy || !valid && !question.optional} onClick={() => goTo(index + 1)}><ChevronDown size={14}/></button>
   </div>
   <div className="qcard-actions">
    {question.optional && <Button variant="ghost" size="sm" disabled={busy} onClick={() => advance(true)}>Passer</Button>}
    <Button variant="primary" size="sm" disabled={!valid} loading={busy} onClick={() => advance()}>{last ? 'Envoyer' : 'Continuer'}</Button>
   </div>
  </footer>
 </section>;
}
