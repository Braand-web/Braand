"use client";
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Plus, RefreshCw } from 'lucide-react';
import { api, post } from '@/lib/client-api';
import type { Resource } from '@/lib/contracts';
import './platform.css';
type Profile = {
    name: string;
    activity: string;
    offer: string;
    audience: string;
    voice: string;
    constraints: string;
    references: string[];
};
const blank: Profile = { name: '', activity: '', offer: '', audience: '', voice: '', constraints: '', references: [] };
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function MemoryPanel() {
    const [items, setItems] = useState<Resource[]>([]), [brands, setBrands] = useState<Resource[]>([]), [canWrite, setCanWrite] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [editing, setEditing] = useState<Resource | null>(null), [adding, setAdding] = useState<'brand' | 'knowledge' | null>(null), [profile, setProfile] = useState<Profile>(blank), [fact, setFact] = useState({ title: '', content: '', source: '', memoryType: 'fact', scope: 'workspace' }), [tab, setTab] = useState<'brands' | 'memory'>('brands');
    const load = useCallback(async () => { try {
        const result = await api<{
            items: Resource[];
            brands: Resource[];
            canWrite: boolean;
        }>('/api/memory');
        setItems(result.items);
        setBrands(result.brands);
        setCanWrite(result.canWrite);
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Les informations de l’espace sont indisponibles.');
    }
    finally {
        setLoading(false);
    } }, []);
    useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
    const begin = (kind: 'brand' | 'knowledge', resource?: Resource) => { setEditing(resource || null); setAdding(kind); if (kind === 'brand')
        setProfile(resource ? { name: resource.title, activity: text(resource.data.activity), offer: text(resource.data.offer), audience: text(resource.data.audience), voice: text(resource.data.voice), constraints: text(resource.data.constraints), references: Array.isArray(resource.data.references) ? resource.data.references.filter((value): value is string => typeof value === 'string') : [] } : blank);
    else
        setFact({ title: resource?.title || '', content: text(resource?.data.content), source: text(resource?.data.source), memoryType: text(resource?.data.memoryType) || 'fact', scope: resource ? (resource.data.scope === 'user' ? 'user' : typeof resource.data.projectId === 'string' ? 'project' : 'workspace') : 'workspace' }); };
    const save = (event: FormEvent) => { event.preventDefault(); if (busy)
        return; setBusy(true); setError(''); const body = adding === 'brand' ? { action: editing ? 'revise_brand' : 'create_brand', ...(editing ? { id: editing.id, version: editing.version } : {}), brand: profile } : { action: editing ? 'revise' : 'create', ...(editing ? { id: editing.id, version: editing.version } : {}), memory: fact }; void api('/api/memory', post(body)).then(async () => { setAdding(null); setEditing(null); await load(); }).catch(e => setError(e instanceof Error ? e.message : 'Votre saisie est conservée.')).finally(() => setBusy(false)); };
    const forget = async (resource: Resource) => { if (busy)
        return; setBusy(true); try {
        await api('/api/memory', post({ action: 'forget', id: resource.id, version: resource.version }));
        await load();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Cette information ne peut pas être retirée.');
    }
    finally {
        setBusy(false);
    } };
    return <section className="settings-section memory-panel" aria-labelledby="settings-memory-title"><h4 id="settings-memory-title">Ce que Braand connaît de votre entreprise</h4><p className="settings-intro">Trois niveaux : vos préférences personnelles (visibles par vous seul, utilisées dans tous les projets), la mémoire de chaque projet et les informations partagées avec l’équipe. Vous pouvez consulter, corriger ou retirer chaque information.</p>
  {error && <p className="platform-notice error" role="alert">{error}</p>}
  {adding ? <form className="platform-form" onSubmit={save}><button type="button" className="platform-button quiet" onClick={() => { setAdding(null); setEditing(null); }}><ArrowLeft size={14}/>Retour aux informations</button>{adding === 'brand' ? <>{[['name', 'Nom de la marque'], ['activity', 'Activité'], ['offer', 'Offres et produits'], ['audience', 'Publics et marchés'], ['voice', 'Ton et voix de marque'], ['constraints', 'Éléments à respecter']].map(([key, label]) => <label className="platform-field" key={key}>{label}{key === 'name' ? <input required maxLength={160} value={profile.name} onChange={e => setProfile(previous => ({ ...previous, name: e.target.value }))}/> : <textarea rows={2} maxLength={key === 'offer' ? 3000 : 2000} value={profile[key as keyof Omit<Profile, 'references'>]} onChange={e => setProfile(previous => ({ ...previous, [key]: e.target.value }))}/>}</label>)}<label className="platform-field">Références visuelles et site — une URL par ligne<textarea rows={2} value={profile.references.join('\n')} onChange={e => setProfile(previous => ({ ...previous, references: e.target.value.split('\n') }))} onBlur={() => setProfile(previous => ({ ...previous, references: previous.references.map(value => value.trim()).filter(Boolean) }))}/></label></> : <><label className="platform-field">Titre<input required maxLength={160} value={fact.title} onChange={e => setFact(previous => ({ ...previous, title: e.target.value }))}/></label><label className="platform-field">Type d’information<select value={fact.memoryType} onChange={e => setFact(previous => ({ ...previous, memoryType: e.target.value }))}><option value="fact">Fait fourni</option><option value="preference">Préférence</option><option value="decision">Décision</option><option value="hypothesis">Hypothèse à vérifier</option></select></label>{!editing && <label className="platform-field">Portée<select value={fact.scope} onChange={e => setFact(previous => ({ ...previous, scope: e.target.value }))}><option value="workspace">Partagée avec l’équipe (tout l’espace)</option><option value="user">Personnelle (vos préférences, visibles par vous seul)</option></select></label>}<label className="platform-field">Information<textarea required rows={4} maxLength={12000} value={fact.content} onChange={e => setFact(previous => ({ ...previous, content: e.target.value }))}/></label><label className="platform-field">Source<input required maxLength={2000} value={fact.source} onChange={e => setFact(previous => ({ ...previous, source: e.target.value }))} placeholder="Ex. Information fournie par l’équipe commerciale"/></label></>}<button type="submit" className="platform-button primary" disabled={busy}><Check size={15}/>Enregistrer les informations</button></form> : <>
   <div className="platform-tabs"><button type="button" className="platform-tab" aria-pressed={tab === 'brands'} onClick={() => setTab('brands')}>Marques</button><button type="button" className="platform-tab" aria-pressed={tab === 'memory'} onClick={() => setTab('memory')}>Mémoire</button><button type="button" className="platform-button quiet" aria-label="Actualiser les informations" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={15}/></button></div>
   {loading ? <p className="platform-muted" role="status">Chargement des informations…</p> : tab === 'brands' ? <>{!brands.length && <p className="platform-muted">Aucune marque renseignée. Vous pouvez commencer une demande et compléter son profil plus tard.</p>}{brands.map(resource => <div className="settings-card memory-entry" key={resource.id}><strong>{resource.title}</strong><p>{text(resource.data.activity) || 'Profil à compléter'}</p>{text(resource.data.voice) && <p className="platform-muted">Voix : {text(resource.data.voice)}</p>}{canWrite && <button type="button" className="platform-button quiet" onClick={() => begin('brand', resource)}>Consulter et modifier</button>}</div>)}{canWrite && <button type="button" className="platform-button" onClick={() => begin('brand')}><Plus size={15}/>Ajouter une marque</button>}</> : <>{!items.length && <p className="platform-muted">Aucune information durable enregistrée.</p>}{items.map(resource => <div className="settings-card memory-entry" key={resource.id}><strong>{resource.title}</strong><span className="platform-badge">{resource.data.scope === 'user' ? 'Personnelle' : typeof resource.data.projectId === 'string' ? 'Projet' : 'Espace'}</span><span className="platform-badge">{resource.data.memoryType === 'preference' ? 'Préférence' : resource.data.memoryType === 'decision' ? 'Décision' : resource.data.memoryType === 'hypothesis' ? 'Hypothèse à vérifier' : 'Fait fourni'}</span><p>{text(resource.data.content)}</p><p className="platform-muted">Source : {text(resource.data.source) || 'Non précisée'} · {new Date(resource.updated_at).toLocaleDateString('fr-FR')}</p>{canWrite && <div className="platform-actions"><button type="button" className="platform-button quiet" disabled={busy} onClick={() => begin('knowledge', resource)}>Corriger</button><button type="button" className="platform-button quiet" disabled={busy} onClick={() => void forget(resource)}>Oublier cette information</button></div>}</div>)}{canWrite && <button type="button" className="platform-button" onClick={() => begin('knowledge')}><Plus size={15}/>Ajouter une information</button>}</>}
  </>}
 </section>;
}
