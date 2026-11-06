"use client";
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, Clock3, FileText, Pause, Play, RefreshCw, ShieldCheck, Square, X } from 'lucide-react';
import { api, post } from '@/lib/client-api';
import { WORK_LABELS, type WorkDTO } from '@/lib/platform-contracts';
import type { Resource } from '@/lib/contracts';
import './platform.css';
import {RoutinesPanel} from './routines-panel';
import {LoadingSkeleton} from "@/components/ds/loading";
const credits = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
const active = new Set(['running', 'waiting_approval', 'waiting_external']);
export function WorkBoard({ conversationId, compact = false, role, ready = true, legacy = [], onAsk, onOpen, onDecide, title = "Missions", hideSectionTabs = false }: {
    onDecide?: (conversationId: string) => void;
    hideSectionTabs?: boolean;
    conversationId?: string;
    title?: string;
    compact?: boolean;
    role?: string;
    ready?: boolean;
    legacy?: Resource[];
    onAsk: (text: string) => void;
    onOpen: (resource: Resource) => void;
}) {
    const [section,setSection]=useState(()=>typeof window!=='undefined'&&new URL(window.location.href).searchParams.get('section')==='routines'?'routines':'work');
    const chooseSection=(next:'work'|'routines')=>{setSection(next);if(!compact){const url=new URL(location.href);if(next==='routines')url.searchParams.set('section','routines');else url.searchParams.delete('section');history.replaceState(null,'',url.pathname+url.search+url.hash);window.dispatchEvent(new PopStateEvent('popstate'));}};
    const [items, setItems] = useState<WorkDTO[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [expanded, setExpanded] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null), [consent, setConsent] = useState<Record<string, boolean>>({}), [enabled, setEnabled] = useState(false);
    const canWrite = ['owner', 'admin', 'editor'].includes(role || ''), canApprove = ['owner', 'admin', 'approver'].includes(role || '');
    const load = useCallback(async (signal?: AbortSignal) => { if (!ready||!compact&&section==='routines')
        return; try {
        const result = await api<{
            items: WorkDTO[];
            readiness: {
                enabled: boolean;
            };
        }>('/api/work' + (conversationId ? '?conversationId=' + encodeURIComponent(conversationId) : ''), { signal });
        const target=!compact?new URL(location.href).searchParams.get('work'):null;const extra=target&&!result.items.some(item=>item.id===target)?await api<WorkDTO>('/api/work/'+encodeURIComponent(target),{signal}):null;setItems(extra?[extra,...result.items]:result.items);if(target)setExpanded(target);
        setEnabled(result.readiness.enabled);
        setError('');
    }
    catch (e) {
        if (!signal?.aborted)
            setError(e instanceof Error ? e.message : 'Les travaux sont indisponibles.');
    }
    finally {
        if (!signal?.aborted)
            setLoading(false);
    } }, [conversationId, ready,compact,section]);
    useEffect(() => { const controller = new AbortController(), initial = setTimeout(() => void load(controller.signal), 0); const timer = setInterval(() => { if (document.visibilityState === 'visible')
        void load(controller.signal); }, 5000); return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); }; }, [load]);
    const command = async (item: WorkDTO, action: 'activate' | 'pause' | 'resume' | 'cancel') => { if (busy)
        return; setBusy(item.id); setError(''); try {
        const updated = await api<WorkDTO>('/api/work/' + item.id + '/' + (action === 'activate' ? 'decisions' : 'commands'), post({ action, version: item.version, commandId: crypto.randomUUID(), ...(action === 'activate' ? { approved: true } : {}) }));
        setItems(previous => previous.map(row => row.id === updated.id ? updated : row));
        setConsent(previous => ({ ...previous, [item.id]: false }));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Cette action n’a pas abouti.');
    }
    finally {
        setBusy(null);
    } };
    const open = async (id: string) => { try {
        onOpen(await api<Resource>('/api/resources/' + encodeURIComponent(id)));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Le livrable est indisponible.');
    } };
    const visible = compact ? items.filter(item => !['completed', 'cancelled', 'expired'].includes(item.status)).slice(0, 2) : items;
    const tabs=!compact&&!hideSectionTabs&&<div className="platform-tabs" aria-label="Type de mission"><button type="button" className="platform-tab" aria-pressed={section==='work'} onClick={()=>chooseSection('work')}>Travaux</button><button type="button" className="platform-tab" aria-pressed={section==='routines'} onClick={()=>chooseSection('routines')}>Routines</button></div>;
    if(!compact&&section==='routines')return <section className="platform-work"><header className="platform-heading"><div><h1>{title}</h1><p>Vos tâches récurrentes, leur calendrier et leur plafond de crédits.</p></div></header>{tabs}<RoutinesPanel role={role} ready={ready} onAsk={onAsk}/></section>;
    if (compact && !visible.length && !error)
        return null;
    return <section className={'platform-work ' + (compact ? 'is-compact' : '')} aria-label={compact ? 'Travail dans cette discussion' : 'Travaux et décisions'}>
  {!compact && <header className="platform-heading"><div><h1>{title}</h1><p>Vos objectifs, les livrables et les décisions à prendre.</p></div><div className="platform-actions"><button type="button" className="platform-button" onClick={() => void load()} disabled={loading || !!busy}><RefreshCw size={16} aria-hidden="true"/>Actualiser</button>{canWrite && <button type="button" className="platform-button primary" onClick={() => onAsk('Je souhaite confier un objectif à Braand. Aide-moi à préciser le résultat attendu, puis prépare un travail borné avec des étapes et un plafond de crédits à examiner avant activation.')}>Confier un objectif<ArrowRight size={16} aria-hidden="true"/></button>}</div></header>}
  {error && <div className="platform-notice error" role="alert"><p>{error}</p><button type="button" className="platform-button" onClick={() => void load()}>Réessayer</button></div>}
  {tabs}
  {!compact && loading && !items.length ? <LoadingSkeleton label="Chargement des travaux…" shape="list"/> : null}
  {!compact && !loading && !items.length && !legacy.length && <div className="platform-empty"><Clock3 size={28} aria-hidden="true"/><h2>Un objectif. Une suite claire.</h2><p>Confiez un résultat à Braand. Le plan, le budget et les validations resteront consultables ici.</p>{!enabled && <p>Les plans peuvent être préparés. L’exécution en arrière-plan attend sa validation de mise en service.</p>}</div>}
  <div className="platform-work-list">{visible.map(item => {
            const show = expanded === item.id, waiting = item.status === 'waiting_approval';
            return <article key={item.id} className="platform-work-item" data-state={item.status}>
   <button type="button" className="platform-work-summary" aria-expanded={show} onClick={() => setExpanded(show ? null : item.id)}><span className="platform-work-symbol">{item.status === 'completed' ? <CheckCircle2 size={19}/> : waiting ? <ShieldCheck size={19}/> : <Clock3 size={19}/>}</span><span><strong>{item.objective}</strong><span className="platform-muted">{WORK_LABELS[item.status]} · {item.steps.filter(step => step.status === 'completed').length} / {item.steps.length} étapes</span></span><ChevronDown size={16} aria-hidden="true" className={show ? 'is-open' : ''}/></button>
   {show && <div className="platform-work-detail"><ol className="platform-steps">{item.steps.map(step => <li key={step.id}><span className="platform-step-mark" aria-hidden="true">{step.status === 'completed' ? <CheckCircle2 size={15}/> : <span />}</span><div><strong>{step.title}</strong><span className="platform-muted">{step.status === 'pending' ? 'À venir' : step.status === 'completed' ? 'Résultat enregistré' : step.status === 'running' ? 'En cours' : step.status === 'uncertain' ? 'Résultat à vérifier' : step.status === 'partial' ? 'Résultat partiel' : step.status === 'waiting_approval' ? 'Accord nécessaire' : step.status === 'waiting_external' ? 'En attente d’un service' : step.status === 'cancelled' ? 'Annulée' : 'Intervention nécessaire'}</span><details><summary>Critères</summary><ul>{step.criteria.map((text, index) => <li key={index}>{text}</li>)}</ul></details></div></li>)}</ol>
    {item.artifacts.length > 0 && <div className="platform-artifact-links" aria-label="Livrables enregistrés">{item.artifacts.map(resource => <button type="button" key={resource.id} onClick={() => void open(resource.id)}><FileText size={15} aria-hidden="true"/>{resource.title}<ArrowRight size={14} aria-hidden="true"/></button>)}</div>}
    <dl className="platform-budget"><div><dt>Consommés</dt><dd>{credits(item.spentCredits)} crédits</dd></div><div><dt>Réservés ou prévus</dt><dd>{credits(item.reservedCredits)} crédits</dd></div><div><dt>Plafond</dt><dd>{credits(item.maxCredits)} crédits</dd></div></dl>
    {item.backgroundActive && <p className="platform-muted">Le travail est pris en charge en arrière-plan. Vous pouvez fermer cette page.</p>}
    {item.status === 'draft' && <><p>Recherche : {item.researchDepth === 'deep' ? 'approfondie, jusqu’à 20 requêtes et 40 pages par phase' : 'standard, jusqu’à 5 requêtes et 10 pages par phase'}.</p><p>Mandat valable jusqu’au {new Date(item.expiresAt).toLocaleString('fr-FR', { timeZone: item.timezone })} ({item.timezone}). Les publications, générations et sessions de navigation conservent leurs accords distincts.</p>{item.constraints.length > 0 && <ul className="platform-constraints">{item.constraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>}{compact || !onDecide ? <>{canApprove && <label className="platform-check"><input type="checkbox" checked={!!consent[item.id]} onChange={e => setConsent(previous => ({ ...previous, [item.id]: e.target.checked }))}/>J’autorise ces étapes dans la limite de {credits(item.maxCredits)} crédits.</label>}<div className="platform-actions">{canApprove && <button type="button" className="platform-button primary" disabled={!consent[item.id] || !!busy || !enabled} onClick={() => void command(item, 'activate')}><Play size={15} aria-hidden="true"/>Autoriser et démarrer</button>}{canWrite && <><button type="button" className="platform-button" onClick={() => onAsk('Révisons ce travail avant son activation : ' + item.objective + '. Référence : ' + item.id + '. Je souhaite modifier : ')}>Modifier avec Braand</button><button type="button" className="platform-button quiet" disabled={!!busy} onClick={() => void command(item, 'cancel')}><X size={15} aria-hidden="true"/>Refuser</button></>}</div></> : <div className="platform-actions"><p className="platform-muted">Le lancement de cette mission se décide dans la discussion qui l’a préparée.</p><button type="button" className="platform-button primary" onClick={() => onDecide(item.conversationId)}>Décider dans la discussion</button></div>}{!enabled && <p className="platform-muted">L’exécution en arrière-plan n’est pas encore activée. Votre plan est conservé.</p>}</>}
    {waiting && <p className="platform-notice">Ouvrez la proposition ci-dessus pour examiner son contenu, son coût et prendre votre décision.</p>}
    {item.status === 'needs_reconciliation' && <p className="platform-notice">Une action ou son coût reste à vérifier. Aucun nouvel envoi automatique. Les livrables et reçus sont conservés.</p>}
    {item.status === 'partial' && <p className="platform-notice">Les résultats obtenus sont conservés. La reprise reste limitée au mandat et au budget disponibles.</p>}
    {(canWrite || canApprove) && item.status !== 'draft' && !['completed', 'cancelled', 'expired'].includes(item.status) && <div className="platform-actions">{canWrite && active.has(item.status) && <button type="button" className="platform-button" disabled={!!busy} onClick={() => void command(item, 'pause')}><Pause size={15} aria-hidden="true"/>Mettre en pause</button>}{canApprove && ['paused', 'partial', 'waiting_input', 'failed'].includes(item.status) && <button type="button" className="platform-button primary" disabled={!!busy || item.unresolved || !enabled} onClick={() => void command(item, 'resume')}><Play size={15} aria-hidden="true"/>Reprendre</button>}{canWrite && <button type="button" className="platform-button quiet" disabled={!!busy} onClick={() => void command(item, 'cancel')}><Square size={14} aria-hidden="true"/>Annuler les étapes restantes</button>}</div>}
   </div>}
  </article>;
        })}</div>
  {!compact && legacy.length > 0 && <section className="platform-legacy"><h2>Autres missions et validations</h2>{legacy.map(resource => <button type="button" className="platform-resource-row" key={resource.id} onClick={() => onOpen(resource)}><span><strong>{resource.title}</strong><span className="platform-muted">{resource.status === 'draft' ? 'Brouillon' : resource.status === 'pending' || resource.status === 'awaiting_approval' ? 'À valider' : 'Consulter le suivi'}</span></span><ArrowRight size={16} aria-hidden="true"/></button>)}</section>}
 </section>;
}
