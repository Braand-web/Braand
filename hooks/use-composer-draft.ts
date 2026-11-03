"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, workspaceHeaders } from '@/lib/client-api';
type Draft = {
    content: string;
    version: number;
    updatedAt: number;
    attachments: string[];
};
export type DraftState = 'loading' | 'saving' | 'saved' | 'local' | 'error' | 'conflict';
const TTL = 7 * 86400000, PREFIX = 'braand.draft.v1.';
function local(key: string): Draft | null { try {
    const raw = localStorage.getItem(key);
    if (!raw)
        return null;
    const value = JSON.parse(raw);
    if (typeof value.content !== 'string' || typeof value.updatedAt !== 'number' || value.updatedAt < Date.now() - TTL) {
        localStorage.removeItem(key);
        return null;
    }
    return { ...value, version: 0, attachments: Array.isArray(value.attachments) ? value.attachments : [] };
}
catch {
    return null;
} }
function persist(key: string, content: string, attachments: string[]) { try {
    localStorage.setItem(key, JSON.stringify({ content, attachments, updatedAt: Date.now() }));
    return true;
}
catch {
    return false;
} }
export function clearLocalDrafts() { try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(PREFIX) || key === 'aira.draft' || key === 'braand.draft')
            localStorage.removeItem(key);
    }
}
catch { } }
export function useComposerDraft({ userId, workspaceId, context, content, onRestore, attachments = [], onRestoreAttachments, enabled = true, instanceKey=context, hasLocalState=false }: {
    instanceKey?:string;
    hasLocalState?:boolean;
    enabled?: boolean;
    userId?: string;
    workspaceId?: string;
    context: string;
    content: string;
    onRestore: (value: string) => void;
    attachments?: string[];
    onRestoreAttachments?: (ids: string[]) => void;
}) {
    const [guestKey, setGuestKey] = useState<string | null>(null), [state, setState] = useState<DraftState>('loading'), [remote, setRemote] = useState<Draft | null>(null), [revision, setRevision] = useState(0);
    const authenticated = enabled && !!userId && !!workspaceId, key = !enabled ? null : authenticated ? PREFIX + JSON.stringify([userId, workspaceId, context]) : guestKey;
    const current = useRef({ key, context, instanceKey, hasLocalState, content, attachments, onRestore, onRestoreAttachments }), version = useRef(0), ready = useRef<string | null>(null), saved = useRef(''), pending = useRef<Promise<void> | null>(null), cleared = useRef<string | null>(null), migratedGuest = useRef(false);
    useEffect(() => { current.current = { key, context, instanceKey, hasLocalState, content, attachments, onRestore, onRestoreAttachments }; }, [key, context, instanceKey, hasLocalState, content, attachments, onRestore, onRestoreAttachments]);
    useEffect(() => { const timer = setTimeout(() => { try {
        let id = sessionStorage.getItem('braand.guest.session');
        if (!id) {
            id = crypto.randomUUID();
            sessionStorage.setItem('braand.guest.session', id);
        }
        setGuestKey(PREFIX + 'guest.' + id);
    }
    catch {
        setState('error');
    } }, 0); return () => clearTimeout(timer); }, []);
    useEffect(() => {
        if (!enabled)
            return;
        ready.current = null;
        version.current = 0;
        cleared.current = null;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setRemote(null);
            if (!key) {
                setState('error');
                return;
            }
            const guest = authenticated && !migratedGuest.current && context === 'new' && guestKey ? local(guestKey) : null, memory=current.current.hasLocalState?{content:current.current.content,attachments:current.current.attachments,version:0,updatedAt:Date.now()}:null,cached = memory || local(key) || guest;
            setState('loading');
            current.current.onRestore(cached?.content || '');
            current.current.onRestoreAttachments?.(cached?.attachments || []);
            if (guest && guestKey) {
                migratedGuest.current = true;
                try {
                    localStorage.removeItem(guestKey);
                }
                catch { }
            }
            if (!authenticated) {
                ready.current = key;
                saved.current = JSON.stringify([cached?.content || '', cached?.attachments || []]);
                setState(persist(key, cached?.content || '', cached?.attachments || []) ? 'local' : 'error');
                return;
            }
            void api<Draft>('/api/drafts?context=' + encodeURIComponent(context), { signal: controller.signal }).then(value => {
                if (controller.signal.aborted || current.current.key !== key || current.current.instanceKey!==instanceKey)
                    return;
                version.current = value.version;
                saved.current = JSON.stringify([value.content, value.attachments]);
                ready.current = key;
                if (current.current.content && current.current.content !== (cached?.content || '') && current.current.content !== value.content) {
                    // What the person is typing always wins: adopt the server version
                    // number silently and save their text over it. No dialog.
                    setState('local');
                    setRevision(n => n + 1);
                    return;
                }
                if (cached && cached.updatedAt > value.updatedAt && JSON.stringify([cached.content, cached.attachments]) !== saved.current) {
                    current.current.onRestore(cached.content);
                    current.current.onRestoreAttachments?.(cached.attachments);
                    setState('local');
                    setRevision(n => n + 1);
                    return;
                }
                current.current.onRestore(value.content);
                current.current.onRestoreAttachments?.(value.attachments);
                setState('saved');
            }).catch(() => { if (controller.signal.aborted)
                return; ready.current = key; saved.current = ''; setState(cached ? 'local' : 'error'); });
        }, 0);
        return () => { clearTimeout(timer); controller.abort(); };
        // Restoration is scoped to identity and context; callbacks are read through current.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, context, instanceKey, authenticated, enabled]);
    const save = useCallback(async () => {
        const value = current.current, serialized = JSON.stringify([value.content, value.attachments]);
        if (!authenticated || !value.key || ready.current !== value.key || saved.current === serialized || state === 'conflict' || cleared.current === value.key)
            return;
        if (pending.current) {
            await pending.current;
            setRevision(n => n + 1);
            return;
        }
        const requestKey = value.key, body = { context: value.context, version: version.current, content: value.content, attachments: value.attachments };
        setState('saving');
        const request = (async () => {
            try {
                const response = await fetch('/api/drafts', { method: 'PUT', headers: workspaceHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
                if (current.current.key !== requestKey)
                    return;
                if (response.status === 409) {
                    const fresh = await api<Draft>('/api/drafts?context=' + encodeURIComponent(value.context));
                    if (current.current.key === requestKey) {
                        // Another tab saved meanwhile: keep the current text and retry on the fresh version.
                        version.current = fresh.version;
                        setState('local');
                        setRevision(n => n + 1);
                    }
                    return;
                }
                if (!response.ok)
                    throw Error('draft_save_failed');
                const result = await response.json() as {
                    version: number;
                };
                version.current = result.version;
                saved.current = serialized;
                if (cleared.current !== requestKey)
                    setState('saved');
            }
            catch {
                if (current.current.key === requestKey && cleared.current !== requestKey)
                    setState('error');
            }
        })();
        pending.current = request;
        try {
            await request;
        }
        finally {
            if (pending.current === request)
                pending.current = null;
        }
    }, [state, authenticated]);
    const attachmentKey = JSON.stringify(attachments);
    useEffect(() => {
        if (!key || ready.current !== key || state === 'loading' || state === 'conflict')
            return;
        if (cleared.current === key) {
            if (!content && !attachments.length)
                return;
            cleared.current = null;
        }
        persist(key, content, attachments);
        const timer = setTimeout(() => void save(), 650);
        return () => clearTimeout(timer);
        // The serialized attachment list prevents rescheduling on an identical array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, attachmentKey, key, save, revision, state]);
    useEffect(() => { const flush = () => { const value = current.current; if (!authenticated || pending.current || !value.key || cleared.current === value.key || ready.current !== value.key || saved.current === JSON.stringify([value.content, value.attachments]) || state === 'conflict')
        return; void fetch('/api/drafts', { method: 'PUT', headers: workspaceHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ context: value.context, version: version.current, content: value.content, attachments: value.attachments }), keepalive: true }); }; window.addEventListener('pagehide', flush); return () => window.removeEventListener('pagehide', flush); }, [authenticated, state]);
    const useRemote = () => { if (!remote)
        return; version.current = remote.version; saved.current = JSON.stringify([remote.content, remote.attachments]); current.current.onRestore(remote.content); current.current.onRestoreAttachments?.(remote.attachments); setRemote(null); setState('saved'); };
    const keepLocal = () => { if (!remote)
        return; version.current = remote.version; setRemote(null); setState('local'); setRevision(n => n + 1); };
    const clear = useCallback(async () => {
        const value = current.current;
        if (!value.key)
            return;
        cleared.current = value.key;
        try {
            localStorage.removeItem(value.key);
        }
        catch { }
        await pending.current;
        if (authenticated) {
            try {
                const snapshot=await api<Draft>('/api/drafts?context='+encodeURIComponent(value.context));
                if(!snapshot.version||snapshot.content!==value.content||JSON.stringify(snapshot.attachments)!==JSON.stringify(value.attachments))return;
                const deletingVersion=snapshot.version;
                await api('/api/drafts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: value.context, version: deletingVersion }) });
                if (current.current.key===value.key&&version.current === deletingVersion) {
                    version.current = 0;
                    saved.current = JSON.stringify(['', []]);
                }
            }
            catch { /* Preserve a concurrent version rather than deleting it. */ }
        }
    }, [authenticated]);
    return { state, remote, save, useRemote, keepLocal, clear };
}
