"use client";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Download, Image as ImageIcon, List, MessageSquare, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useComposerDraft } from '@/hooks/use-composer-draft';
import {FileCard} from './file-preview/file-card';
import { api, post } from '@/lib/client-api';
import { NETWORK_LABELS, POST_LABELS, type SocialAccountDTO, type SocialBatchDTO, type SocialPostDTO, type SocialPostInput, type SocialNetwork } from '@/lib/platform-contracts';
import { calendarDays, localDateTime, scheduleTimestamp } from '@/lib/social-time.mjs';
import './platform.css';
import './publications.css';
import {LoadingSkeleton} from "@/components/ds/loading";
type Asset = {
    id: string;
    name: string;
    mime: string;
    sha256: string;
    version: number;
    size: number;
    url: string;
};
type CalendarPost = SocialPostDTO & {
    accountLabel: string;
    batchTitle: string;
    network: SocialNetwork;
};
type Editor = {
    accountIds: string[];
    text: string;
    format: SocialPostInput['format'];
    altText: string;
    destination: string;
    date: string;
    timezone: string;
    assets: string[];
    fold: '' | 'earlier' | 'later';
};
const localTimezone = () => { try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
catch {
    return 'UTC';
} };
const initialEditor = (): Editor => { const timezone = localTimezone(); return { accountIds: [], text: '', format: 'text', altText: '', destination: '', date: localDateTime(Date.now() + 3600000, timezone), timezone, assets: [], fold: '' }; };
const editable = (status: string) => ['draft', 'approved', 'blocked', 'needs_reschedule', 'rejected'].includes(status);
const networkName = (accounts: SocialAccountDTO[], id: string) => { const a = accounts.find(a => a.id === id); return a ? NETWORK_LABELS[a.network] + ' · ' + a.label : 'Compte à vérifier'; };
export default function PublicationsHub({ role, ready = true, demonstration = false, userId, workspaceId, onAsk, onConnect, onDecide }: {
    onDecide?: (conversationId: string) => void;
    role?: string;
    userId?: string;
    workspaceId?: string;
    ready?: boolean;
    demonstration?: boolean;
    onAsk: (text: string) => void;
    onConnect: () => void;
}) {
    const canWrite = !demonstration && ['owner', 'admin', 'editor'].includes(role || ''), canApprove = !demonstration && ['owner', 'admin', 'approver'].includes(role || '');
    const [accounts, setAccounts] = useState<SocialAccountDTO[]>([]), [items, setItems] = useState<CalendarPost[]>([]), [assets, setAssets] = useState<Asset[]>([]), [mode, setMode] = useState<'calendar' | 'list' | 'comments'>('calendar'), [month, setMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; }), [zone, setZone] = useState(localTimezone), [accountFilter, setAccountFilter] = useState(''), [statusFilter, setStatusFilter] = useState(''), [dayFilter, setDayFilter] = useState(''), [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [before, setBefore] = useState<number | null>(null), [selected, setSelected] = useState<SocialBatchDTO | null>(null), [selection, setSelection] = useState<string[]>([]), [creating, setCreating] = useState(false), [editing, setEditing] = useState<string | null>(null), [editor, setEditor] = useState<Editor>(initialEditor), [title, setTitle] = useState(''), [ambiguous, setAmbiguous] = useState(false);
    useEffect(() => {
        const mobile = window.matchMedia('(max-width:700px)');
        const sync = () => { if (mobile.matches) setMode(current => current === 'calendar' ? 'list' : current); };
        sync();
        mobile.addEventListener('change', sync);
        return () => mobile.removeEventListener('change', sync);
    }, []);
    const restoreEditor = useCallback((content: string) => { if (!content)
        return; try {
        const value = JSON.parse(content);
        if (value.editor && Array.isArray(value.editor.accountIds) && typeof value.editor.text === 'string' && Array.isArray(value.editor.assets)) {
            setEditor(value.editor);
            setTitle(typeof value.title === 'string' ? value.title : '');
            setNotice('Brouillon restauré. Vérifiez les comptes, les médias et les créneaux avant de l’enregistrer.');
        }
    }
    catch { /* An invalid cached form is ignored. */ } }, []);
    const formDraft = useComposerDraft({ enabled: !!(creating || editing) && canWrite, userId, workspaceId, context: 'social:' + (editing || 'new'), content: JSON.stringify({ editor, title }), onRestore: restoreEditor });
    const days = calendarDays(month.year, month.month);
    const load = useCallback(async (append = false, cursor?: number, signal?: AbortSignal) => { if (!ready)
        return; setLoading(true); try {
        const days = calendarDays(month.year, month.month), start = Date.parse(days[0].key + 'T00:00:00Z') - 86400000, end = Date.parse(days.at(-1)!.key + 'T00:00:00Z') + 2 * 86400000, params = new URLSearchParams({ start: String(start), end: String(end), ...(accountFilter ? { accountId: accountFilter } : {}), ...(cursor ? { before: String(cursor) } : {}) });
        const [posts, destinations] = await Promise.all([api<{
                items: CalendarPost[];
                nextBefore: number | null;
            }>('/api/social/posts?' + params, { signal }), api<{
                accounts: SocialAccountDTO[];
            }>('/api/social/accounts', { signal })]);
        setItems(previous => append ? [...previous, ...posts.items.filter(item => !previous.some(p => p.id === item.id))] : posts.items);
        setBefore(posts.nextBefore);
        setAccounts(destinations.accounts);
        setError('');
    }
    catch (e) {
        if (!signal?.aborted)
            setError(e instanceof Error ? e.message : 'Le calendrier est indisponible.');
    }
    finally {
        if (!signal?.aborted)
            setLoading(false);
    } }, [month.year, month.month, accountFilter, ready]);
    useEffect(() => { const controller = new AbortController(), timer = setTimeout(() => void load(false, undefined, controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
    useEffect(() => { if (!creating && !editing && !selected?.id)
        return; const controller = new AbortController(); void api<{
        items: Asset[];
    }>('/api/social/assets', { signal: controller.signal }).then(result => setAssets(result.items)).catch(() => { if (!controller.signal.aborted)
        setError('Les médias ne peuvent pas être chargés. Votre texte est conservé.'); }); return () => controller.abort(); }, [creating, editing,selected?.id]);
    const run = async (action: () => Promise<void>) => { if (busy)
        return; setBusy(true); setError(''); setNotice(''); try {
        await action();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Cette opération n’a pas abouti. Votre saisie est conservée.');
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ambiguous_time')
            setAmbiguous(true);
    }
    finally {
        setBusy(false);
    } };
    useEffect(()=>{if(!ready)return;const id=new URL(location.href).searchParams.get('batch');if(!id)return;const controller=new AbortController();void api<SocialBatchDTO>('/api/social/batches/'+encodeURIComponent(id),{signal:controller.signal}).then(result=>setSelected(result)).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Lot indisponible.');});return()=>controller.abort();},[ready]);
    const open = async (id: string) => { await run(async () => { const result = await api<SocialBatchDTO>('/api/social/batches/' + id); setSelected(result);const url=new URL(location.href);url.searchParams.set('batch',result.id);history.replaceState(null,'',url.pathname+url.search); setSelection([]); setCreating(false); setEditing(null); }); };
    const create = () => { setEditor(initialEditor()); setTitle(''); setCreating(true); setEditing(null); setSelected(null); setAmbiguous(false); };
    const edit = (item: SocialPostDTO) => { setEditor({ accountIds: [item.accountId], text: item.text, format: item.format, altText: item.altText, destination: item.destination || '', date: localDateTime(item.scheduledAt, item.timezone), timezone: item.timezone, assets: item.assets.map(asset => asset.id), fold: '' }); setEditing(item.id); setCreating(false); setAmbiguous(false); };
    const save = (event: FormEvent) => { event.preventDefault(); void run(async () => { if (!editor.accountIds.length)
        throw new Error('Choisissez au moins un compte de destination.'); const scheduledAt = scheduleTimestamp(editor.date, editor.timezone, editor.fold || undefined), files = editor.assets.map(id => { const file = assets.find(file => file.id === id); if (!file)
        throw new Error('Un média est indisponible. Retirez-le ou actualisez la liste.'); return { id: file.id, version: file.version, sha256: file.sha256 }; }); const posts = editor.accountIds.map(accountId => ({ accountId, text: editor.text, format: editor.format, assets: files, altText: editor.altText, destination: editor.destination || null, scheduledAt, timezone: editor.timezone })); let result: SocialBatchDTO; if (editing && selected) {
        const current = selected.posts.find(item => item.id === editing);
        if (!current)
            throw new Error('La publication est indisponible.');
        result = await api<SocialBatchDTO>('/api/social/posts/' + editing, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: current.version, post: posts[0] }) });
    }
    else
        result = await api<SocialBatchDTO>('/api/social/batches', post({ title: title.trim() || 'Publications du ' + new Date(scheduledAt).toLocaleDateString('fr-FR', { timeZone: editor.timezone }), posts })); setSelected(result); setCreating(false); setEditing(null); setSelection([]); void formDraft.clear();setNotice('Brouillon enregistré. Aucune publication n’a été envoyée.'); void load(); }); };
    const decide = (decision: 'approve' | 'reject') => { if (!selected)
        return; void run(async () => { const result = await api<SocialBatchDTO>('/api/social/batches/' + selected.id + '/decision', post({ version: selected.version, digest: selected.digest, decision, postIds: selection })); setSelected(result); setSelection([]); setNotice(decision === 'approve' ? 'Les publications sélectionnées sont programmées dans leurs créneaux approuvés.' : 'Les publications sélectionnées sont refusées.'); void load(); }); };
    const back = () => {const url=new URL(location.href);url.searchParams.delete('batch');history.replaceState(null,'',url.pathname+url.search);setSelected(null); setCreating(false); setEditing(null); setError(''); setNotice(''); };
    const editorForm = <form className="platform-form publication-editor" onSubmit={save}>
  {creating && <label className="platform-field">Nom du lot<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="Ex. Les contenus de la semaine"/></label>}
  <fieldset className="publication-accounts"><legend>Comptes de destination</legend>{accounts.length ? accounts.map(account => <label key={account.id} className="platform-check"><input type={editing ? 'radio' : 'checkbox'} name="destination" checked={editor.accountIds.includes(account.id)} onChange={e => setEditor(previous => ({ ...previous, accountIds: editing ? [account.id] : e.target.checked ? [...previous.accountIds, account.id] : previous.accountIds.filter(id => id !== account.id) }))}/><span>{NETWORK_LABELS[account.network]} · {account.label}<small>{account.targetId}{account.status !== 'active' ? ' · Connexion à renouveler' : !account.capabilities.publish ? ' · Publication à vérifier' : ''}</small></span></label>) : <div className="platform-notice"><p>Connectez un réseau, puis actualisez ses comptes pour choisir une destination.</p><button type="button" className="platform-button" onClick={onConnect}>Connecter mes réseaux</button></div>}</fieldset>
  <label className="platform-field">Texte de la publication<textarea value={editor.text} onChange={e => setEditor(previous => ({ ...previous, text: e.target.value }))} maxLength={12000} rows={6} placeholder="Votre contenu, dans la voix de votre marque…"/><span className="platform-muted">{editor.text.length.toLocaleString('fr-FR')} caractères · les limites sont vérifiées selon le réseau.</span></label>
  <div className="platform-form-grid"><label className="platform-field">Format<select value={editor.format} onChange={e => setEditor(previous => ({ ...previous, format: e.target.value as Editor['format'] }))}><option value="text">Texte</option><option value="image">Image</option><option value="carousel">Carrousel</option><option value="video">Vidéo</option><option value="story">Story</option></select></label><label className="platform-field">Lien de destination<input type="url" value={editor.destination} onChange={e => setEditor(previous => ({ ...previous, destination: e.target.value }))} placeholder="https://…"/></label></div>
  {editor.format !== 'text' && <fieldset className="publication-assets"><legend>Médias définitifs</legend>{assets.length ? assets.map(file => <label className="platform-check" key={file.id}><input type="checkbox" checked={editor.assets.includes(file.id)} disabled={!editor.assets.includes(file.id) && editor.assets.length >= 10} onChange={e => setEditor(previous => ({ ...previous, assets: e.target.checked ? [...previous.assets, file.id] : previous.assets.filter(id => id !== file.id) }))}/><span><ImageIcon size={15} aria-hidden="true"/>{file.name}<small>{file.mime.startsWith('video/') ? 'Vidéo' : 'Image'} · {(file.size / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio</small></span></label>) : <p className="platform-muted">Ajoutez vos fichiers dans Fichiers ou conservez les créations du Studio avant de les sélectionner.</p>}</fieldset>}
  {editor.format !== 'text' && <label className="platform-field">Description accessible<textarea value={editor.altText} onChange={e => setEditor(previous => ({ ...previous, altText: e.target.value }))} rows={2} maxLength={2000} placeholder="Décrivez ce qui est important dans le visuel."/></label>}
  <div className="platform-form-grid"><label className="platform-field">Date et heure<input type="datetime-local" required value={editor.date} onChange={e => { setAmbiguous(false); setEditor(previous => ({ ...previous, date: e.target.value, fold: '' })); }}/></label><label className="platform-field">Fuseau horaire<input required value={editor.timezone} onChange={e => { setAmbiguous(false); setEditor(previous => ({ ...previous, timezone: e.target.value, fold: '' })); }} list="publication-timezones"/><datalist id="publication-timezones">{['Europe/Paris', 'Africa/Douala', 'Africa/Abidjan', 'Africa/Dakar', 'Africa/Lagos', 'UTC'].map(value => <option value={value} key={value}/>)}</datalist></label></div>
  {ambiguous && <fieldset><legend>Cette heure existe deux fois</legend>{[['earlier', 'Première occurrence'], ['later', 'Seconde occurrence']].map(([value, label]) => <label className="platform-check" key={value}><input type="radio" name="fold" checked={editor.fold === value} onChange={() => setEditor(previous => ({ ...previous, fold: value as Editor['fold'] }))}/>{label}</label>)}</fieldset>}
  <p className="platform-muted" role="status">{formDraft.state === 'saving' ? 'Enregistrement…' : formDraft.state === 'saved' ? 'Brouillon enregistré' : formDraft.state === 'error' ? 'Échec de l’enregistrement automatique — gardez cet onglet ouvert et réessayez.' : formDraft.state === 'conflict' ? 'Un autre onglet a modifié ce brouillon. Votre saisie est conservée.' : 'Brouillon conservé sur cet appareil lorsque le stockage est disponible.'}</p>{formDraft.state === 'conflict' && <div className="platform-actions"><button type="button" className="platform-button" onClick={formDraft.useRemote}>Reprendre la version enregistrée</button><button type="button" className="platform-button" onClick={formDraft.keepLocal}>Conserver ma saisie</button></div>}<div className="platform-actions"><button type="submit" className="platform-button primary" disabled={busy || !canWrite || !editor.accountIds.length}><Check size={16} aria-hidden="true"/>Enregistrer le brouillon</button><button type="button" className="platform-button quiet" onClick={() => { if (editing)
        setEditing(null);
    else
        back(); }} disabled={busy}>Annuler</button></div><p className="platform-muted">L’enregistrement ne publie rien. Les fichiers, comptes et horaires seront présentés dans la validation du lot.</p>
 </form>;
    const filtered = items.filter(item => (!statusFilter || item.status === statusFilter) && (!dayFilter || localDateTime(item.scheduledAt, zone).slice(0, 10) === dayFilter) && (!query || [item.text, item.batchTitle, item.accountLabel].join(' ').toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))));
    return <section className="publications-hub">
  <header className="platform-heading"><div>{(selected || creating) && <button type="button" className="publication-back" onClick={back}><ArrowLeft size={15} aria-hidden="true"/>Publications</button>}<h1>{creating ? 'Préparer des publications' : selected ? selected.title : 'Publications'}</h1><p>{selected ? 'Examinez le contenu exact, les destinations et les créneaux.' : 'Préparer, valider et suivre vos contenus sur les réseaux.'}</p></div><div className="platform-actions">{!creating && !selected && <><button type="button" className="platform-button" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true"/>Actualiser</button>{canWrite && <button type="button" className="platform-button primary" onClick={create}><Plus size={16} aria-hidden="true"/>Préparer un lot</button>}</>}{selected && <a className="platform-button" href={'/api/social/batches/' + selected.id + '/export'}><Download size={15} aria-hidden="true"/>Exporter le lot</a>}</div></header>
  {error && <div className="platform-notice error" role="alert">{error}</div>}{notice && <p className="platform-notice" role="status">{notice}</p>}
  {creating || editing ? editorForm : selected ? <>
   <div className="publication-review-heading"><span><ShieldCheck size={18} aria-hidden="true"/>Validation par publication sélectionnée</span><p>Une modification du texte, du compte, du média ou de l’horaire nécessite un nouvel accord. Une publication en retard de plus de 15 minutes attendra une reprogrammation.</p></div>
   <label className="platform-check"><input type="checkbox" checked={selection.length > 0 && selected.posts.filter(p => editable(p.status)).every(p => selection.includes(p.id))} onChange={e => setSelection(e.target.checked ? selected.posts.filter(p => editable(p.status)).map(p => p.id) : [])}/>Sélectionner toutes les publications modifiables</label>
   <div className="publication-review-list">{selected.posts.map(item => <article className="publication-review" key={item.id}><header><label className="platform-check"><input type="checkbox" checked={selection.includes(item.id)} disabled={!editable(item.status) || busy} onChange={e => setSelection(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))}/><span><strong>{networkName(accounts, item.accountId)}</strong><small>{new Date(item.scheduledAt).toLocaleString('fr-FR', { timeZone: item.timezone })} · {item.timezone}</small></span></label><span className="platform-badge" data-status={item.status}>{POST_LABELS[item.status] || 'À vérifier'}</span></header><p className="publication-text">{item.text || 'Publication sans texte'}</p>{item.assets.length > 0 && <div className="publication-preview-assets">{item.assets.map(asset => {const file=assets.find(file=>file.id===asset.id);return file?<FileCard key={asset.id} file={{id:file.id,name:file.name,mime:file.mime,size:file.size,status:'ready'}} contextFileIds={item.assets.map(item=>item.id)} variant="compact"/>:<a key={asset.id} href={'/api/files?id='+encodeURIComponent(asset.id)}>Télécharger le média définitif</a>;})}</div>}{item.altText && <p className="platform-muted">Description accessible : {item.altText}</p>}{item.destination && <a className="publication-destination" href={item.destination} target="_blank" rel="noopener noreferrer">{item.destination}</a>}{item.receipt?.url && <a className="platform-button" href={item.receipt.url} target="_blank" rel="noopener noreferrer">Voir la publication<ArrowRight size={14} aria-hidden="true"/></a>}{item.status === 'uncertain' && <p className="platform-notice">Le réseau n’a pas confirmé le résultat. Aucun renvoi automatique ; vérifiez le compte avant une nouvelle action.</p>}{item.status === 'needs_reschedule' && <p className="platform-notice">Ce créneau est dépassé. Choisissez un nouvel horaire, puis validez à nouveau.</p>}{accounts.find(account => account.id === item.accountId)?.reason && <p className="platform-muted">La publication de ce compte attend une connexion ou une vérification de capacité.</p>}{canWrite && editable(item.status) && <button type="button" className="platform-button quiet" onClick={() => edit(item)} disabled={busy}>Modifier cette publication</button>}</article>)}</div>
   {canApprove && selected && <DecideOrConfirm id={selected.id} onDecide={onDecide}><div className="publication-decision"><p>{selection.length} publication{selection.length > 1 ? 's' : ''} sélectionnée{selection.length > 1 ? 's' : ''}. Les publications déjà envoyées restent inchangées.</p><div className="platform-actions"><button type="button" className="platform-button primary" disabled={!selection.length || busy} onClick={() => decide('approve')}>Approuver et programmer</button><button type="button" className="platform-button" disabled={!selection.length || busy} onClick={() => decide('reject')}>Refuser la sélection</button></div></div></DecideOrConfirm>}
  </> : <>
   <div className="platform-tabs" aria-label="Présentation des publications">{[['calendar', 'Calendrier', CalendarDays], ['list', 'Liste', List], ['comments', 'Commentaires', MessageSquare]].map(([value, label, Icon]) => { const Control = Icon as typeof CalendarDays; return <button type="button" key={value as string} className={'platform-tab ' + (value === 'calendar' ? 'calendar-tab' : '')} aria-pressed={mode === value} onClick={() => { setMode(value as typeof mode); setDayFilter(''); }}><Control size={15} aria-hidden="true"/>{label as string}</button>; })}</div>
   {mode === 'comments' ? <Comments accounts={accounts} canWrite={canWrite} canApprove={canApprove} onAsk={onAsk} onDecide={onDecide}/> : <>
    <div className="publication-toolbar"><div className="publication-month"><button type="button" className="platform-button quiet" aria-label="Mois précédent" onClick={() => { const d = new Date(month.year, month.month - 1, 1); setMonth({ year: d.getFullYear(), month: d.getMonth() }); setDayFilter(''); }}><ChevronLeft size={18}/></button><strong>{new Date(month.year, month.month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</strong><button type="button" className="platform-button quiet" aria-label="Mois suivant" onClick={() => { const d = new Date(month.year, month.month + 1, 1); setMonth({ year: d.getFullYear(), month: d.getMonth() }); setDayFilter(''); }}><ChevronRight size={18}/></button><button type="button" className="platform-button quiet" onClick={() => { const d = new Date(); setMonth({ year: d.getFullYear(), month: d.getMonth() }); setDayFilter(''); }}>Aujourd’hui</button></div><label className="platform-field publication-zone">Fuseau du calendrier<input defaultValue={zone} onBlur={e => { try {
                new Intl.DateTimeFormat('fr', { timeZone: e.target.value });
                setZone(e.target.value);
                setError('');
            }
            catch {
                setError('Choisissez un fuseau IANA valide.');
            } }} list="calendar-timezones"/><datalist id="calendar-timezones">{['Europe/Paris', 'Africa/Douala', 'Africa/Abidjan', 'Africa/Dakar', 'UTC'].map(value => <option key={value} value={value}/>)}</datalist></label></div>
    <div className="publication-filters"><label className="platform-field"><span className="sr-only">Rechercher une publication</span><input type="search" placeholder="Rechercher dans les publications" value={query} onChange={e => setQuery(e.target.value)}/></label><label className="platform-field"><span className="sr-only">Compte</span><select value={accountFilter} onChange={e => setAccountFilter(e.target.value)}><option value="">Tous les comptes</option>{accounts.map(account => <option value={account.id} key={account.id}>{NETWORK_LABELS[account.network]} · {account.label}</option>)}</select></label><label className="platform-field"><span className="sr-only">État</span><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Tous les états</option>{Object.entries(POST_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
    {loading && !items.length ? <LoadingSkeleton label="Chargement des publications…" shape="list"/> : null}
    {!loading && !items.length && !error && <div className="platform-empty"><CalendarDays size={30} aria-hidden="true"/><h2>Votre prochain contenu commence ici.</h2><p>Préparez des publications avec Braand ou ajoutez un brouillon. Vous examinerez les comptes et les créneaux avant tout envoi.</p><div className="platform-actions"><button type="button" className="platform-button" onClick={() => onAsk('Prépare un calendrier éditorial pour ma marque. Réutilise les informations disponibles, demande uniquement les éléments indispensables et conserve les publications comme brouillons à valider.')}>Préparer avec Braand<ArrowRight size={15}/></button><button type="button" className="platform-button quiet" onClick={onConnect}>Connecter mes réseaux</button></div></div>}
    {items.length > 0 && <div className={'publication-views ' + (mode === 'calendar' ? 'is-calendar' : '')}>
     {mode === 'calendar' && <div className="platform-calendar" aria-label={'Calendrier de ' + new Date(month.year, month.month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}><div className="calendar-weekdays">{['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map(day => { const posts = filtered.filter(item => localDateTime(item.scheduledAt, zone).startsWith(day.key)); return <div className={'calendar-day ' + (!day.inMonth ? 'outside' : '')} key={day.key}><button type="button" className="calendar-day-number" aria-label={day.key + ', ' + posts.length + ' publication(s)'} onClick={() => { setDayFilter(day.key); setMode('list'); }}>{day.day}</button>{posts.slice(0, 3).map(item => <button type="button" className="calendar-entry" key={item.id} onClick={() => void open(item.batchId)} title={item.text}><span>{localDateTime(item.scheduledAt, zone).slice(11)} · {NETWORK_LABELS[item.network]}</span><strong>{item.text || item.batchTitle}</strong><span className="platform-badge" data-status={item.status}>{POST_LABELS[item.status] || 'À vérifier'}</span></button>)}{posts.length > 3 && <button className="calendar-more" type="button" onClick={() => { setDayFilter(day.key); setMode('list'); }}>Voir les {posts.length} publications</button>}</div>; })}</div></div>}
     <div className="platform-post-list" aria-label="Liste des publications">{dayFilter && <button type="button" className="platform-button quiet" onClick={() => setDayFilter('')}>Tout le mois<ArrowLeft size={14}/></button>}{[...filtered].sort((a, b) => a.scheduledAt - b.scheduledAt).map(item => <button type="button" key={item.id} className="platform-post" onClick={() => void open(item.batchId)}><span className="publication-date"><strong>{new Date(item.scheduledAt).toLocaleDateString('fr-FR', { timeZone: zone, day: 'numeric', month: 'short' })}</strong><span>{localDateTime(item.scheduledAt, zone).slice(11)}</span></span><span className="publication-list-content"><span className="platform-muted">{NETWORK_LABELS[item.network]} · {item.accountLabel}</span><strong>{item.text || item.batchTitle}</strong><span className="platform-muted">{item.batchTitle}</span></span><span className="platform-badge" data-status={item.status}>{POST_LABELS[item.status] || 'À vérifier'}</span><ArrowRight size={15} aria-hidden="true"/></button>)}{!filtered.length && <p className="platform-muted">Aucune publication ne correspond aux filtres.</p>}</div>
    </div>}
    {before && <div className="platform-notice"><p>Une partie des publications de la période reste à charger.</p><button type="button" className="platform-button" disabled={loading} onClick={() => void load(true, before)}>Charger la suite</button></div>}
   </>}
  </>}
 </section>;
}
type Comment = {
    id: string;
    accountId: string;
    accountLabel: string;
    network: SocialNetwork;
    author: string;
    text: string;
    status: string;
    syncedAt: number;
    replies: {
        id: string;
        text: string;
        version: number;
        status: string;
        digest: string;
        receipt: {
            externalId?: string;
        } | null;
    }[];
};
function Comments({ accounts, canWrite, canApprove, onAsk, onDecide }: {
    onDecide?: (conversationId: string) => void;
    accounts: SocialAccountDTO[];
    canWrite: boolean;
    canApprove: boolean;
    onAsk: (text: string) => void;
}) {
    const [items, setItems] = useState<Comment[]>([]), [accountId, setAccountId] = useState(''), [query, setQuery] = useState(''), [onlyUnread, setOnlyUnread] = useState(false), [drafts, setDrafts] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const load = useCallback(async () => { try {
        setItems((await api<{
            comments: Comment[];
        }>('/api/social/comments' + (accountId ? '?accountId=' + encodeURIComponent(accountId) : ''))).comments);
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Les commentaires sont indisponibles.');
    } }, [accountId]);
    useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
    const action = async (fn: () => Promise<void>) => { if (busy)
        return; setBusy(true); setError(''); try {
        await fn();
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'L’opération n’a pas abouti. Votre réponse reste conservée.');
    }
    finally {
        setBusy(false);
    } };
    return <section aria-label="Commentaires et réponses"><div className="publication-filters"><label className="platform-field">Compte<select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Tous les comptes</option>{accounts.filter(a => a.capabilities.comments).map(a => <option value={a.id} key={a.id}>{NETWORK_LABELS[a.network]} · {a.label}</option>)}</select></label><label className="platform-field">Rechercher<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Dans les commentaires"/></label></div><div className="platform-actions"><label className="platform-check"><input type="checkbox" checked={onlyUnread} onChange={e => setOnlyUnread(e.target.checked)}/>À traiter uniquement</label><button type="button" className="platform-button" disabled={!accountId || busy || !canWrite} onClick={() => void action(async () => { await api('/api/social/comments/sync', post({ accountId })); })}><RefreshCw size={15}/>Synchroniser ce compte</button></div>{error && <p className="platform-notice error" role="alert">{error}</p>}{!items.length && <div className="platform-empty"><MessageSquare size={28}/><h2>Des réponses avec leur contexte.</h2><p>Les commentaires des comptes compatibles apparaîtront ici après synchronisation. Chaque réponse sera validée individuellement.</p></div>}{items.filter(c => (!onlyUnread || c.status !== 'answered') && (!query || [c.text, c.author].join(' ').toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')))).map(comment => <article className="publication-comment" key={comment.id}><header><strong>{comment.author}</strong><span className="platform-muted">{NETWORK_LABELS[comment.network]} · {comment.accountLabel}</span></header><p>{comment.text}</p><span className="platform-muted">Relevé le {new Date(comment.syncedAt).toLocaleString('fr-FR')}. Le contexte sera vérifié avant l’envoi.</span>{comment.replies.map(reply => <div className="publication-reply" key={reply.id}><p>{reply.text}</p><span className="platform-badge" data-status={reply.status}>{POST_LABELS[reply.status] || 'À valider'}</span>{reply.status === 'draft' && canApprove && <DecideOrConfirm id={reply.id} onDecide={onDecide}><div className="platform-actions"><button type="button" className="platform-button" disabled={busy} onClick={() => void action(async () => { await api('/api/social/replies/' + reply.id + '/decision', post({ version: reply.version, digest: reply.digest, decision: 'approve' })); })}>Approuver cette réponse</button><button type="button" className="platform-button quiet" disabled={busy} onClick={() => void action(async () => { await api('/api/social/replies/' + reply.id + '/decision', post({ version: reply.version, digest: reply.digest, decision: 'reject' })); })}>Refuser</button></div></DecideOrConfirm>}{reply.status === 'uncertain' && <p className="platform-muted">Vérifiez le réseau avant tout nouvel envoi.</p>}</div>)}{canWrite && <><label className="platform-field">Préparer une réponse<textarea value={drafts[comment.id] || ''} maxLength={4000} onChange={e => setDrafts(previous => ({ ...previous, [comment.id]: e.target.value }))} rows={3}/></label><div className="platform-actions"><button type="button" className="platform-button" disabled={busy || !drafts[comment.id]?.trim()} onClick={() => void action(async () => { await api('/api/social/replies', post({ commentId: comment.id, text: drafts[comment.id] })); setDrafts(previous => ({ ...previous, [comment.id]: '' })); })}>Enregistrer pour validation</button><button type="button" className="platform-button quiet" onClick={() => onAsk('Prépare une réponse factuelle et adaptée au contexte de ce commentaire, sans l’envoyer. Référence du commentaire : ' + comment.id + '. S’il s’agit d’une réclamation sensible, indique ce qui doit être repris par une personne.')}>Préparer avec Braand</button></div></>}</article>)}</section>;
}

/** Prepared by Braand in a conversation: decided there. Written by hand here: confirmed here. */
function DecideOrConfirm({ id, onDecide, children }: { id: string; onDecide?: (conversationId: string) => void; children: ReactNode }) {
    const [origin, setOrigin] = useState<{ id: string; conversationId: string | null } | null>(null);
    useEffect(() => { if (!onDecide) return; let stop = false; api<{ conversationId: string | null }>('/api/decisions?origin=' + encodeURIComponent(id)).then(result => { if (!stop) setOrigin({ id, conversationId: result.conversationId }); }).catch(() => { if (!stop) setOrigin({ id, conversationId: null }); }); return () => { stop = true; }; }, [id, onDecide]);
    if (!onDecide) return <>{children}</>;
    if (!origin || origin.id !== id) return null;
    if (!origin.conversationId) return <>{children}</>;
    return <div className="platform-actions"><p className="platform-muted">Braand a préparé cette demande dans une discussion : votre accord se donne là-bas.</p><button type="button" className="platform-button primary" onClick={() => onDecide(origin.conversationId as string)}>Décider dans la discussion</button></div>;
}
