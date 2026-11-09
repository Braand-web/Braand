"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, post } from "@/lib/client-api";
import { FilePreviewDialog } from "./file-preview-dialog";
import type { PreviewFile, PreviewScope } from "./types";

type OpenPreviewOptions = { contextFileIds?: string[] };
type PreviewContextValue = {
  resetPreview: () => void;
  registerPreviewPanel: (handler: (fileId: string) => void) => () => void;
  openPreview: (fileId: string, options?: OpenPreviewOptions) => void;
  registerAddToConversation: (handler: (file: PreviewFile) => void) => () => void;
  getSignedUrl: (fileId: string, scope: PreviewScope) => Promise<string>;
  fetchContent: (fileId: string, scope?: "content" | "download") => Promise<Response>;
  closePreview: () => void;
  addToConversation: () => void;
  file: PreviewFile | null;
  loading: boolean;
  unavailable: boolean;
  contextFileIds: string[];
  contextIndex: number;
  activeId: string | null;
  goToFile: (index: number) => void;
};

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function useFilePreview() {
  const context = useContext(PreviewContext);
  if (!context) throw new Error("useFilePreview doit être utilisé dans FilePreviewProvider.");
  return context;
}

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const [panelHandler, setPanelHandler] = useState<((fileId: string) => void) | null>(null);
  const registerPreviewPanel = useCallback((handler: (fileId: string) => void) => {
    setPanelHandler(() => handler);
    return () => setPanelHandler((current: ((fileId: string) => void) | null) => current === handler ? null : current);
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => { if (activeId) panelHandler?.(activeId); }, [activeId, panelHandler]);
  const [contextFileIds, setContextFileIds] = useState<string[]>([]);
  const [metadataResult, setMetadataResult] = useState<{ id: string; file: PreviewFile | null } | null>(null);
  const addHandler = useRef<((file: PreviewFile) => void) | null>(null);
  const fileCache = useRef(new Map<string, PreviewFile>());
  const file = activeId && metadataResult?.id === activeId ? metadataResult.file : null;
  const loading = !!activeId && !file && metadataResult?.id !== activeId;
  const unavailable = !!activeId && !file && metadataResult?.id === activeId;
  const contextIndex = Math.max(0, contextFileIds.indexOf(activeId || ""));

  const updateUrl = useCallback((id: string | null, mode: "push" | "replace") => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("apercu", id);
    else url.searchParams.delete("apercu");
    const state = { ...(history.state || {}), braandFilePreview: mode === "push" || history.state?.braandFilePreview === true };
    if (!id) delete state.braandFilePreview;
    history[mode === "push" ? "pushState" : "replaceState"](state, "", url);
  }, []);
  const resetPreview=useCallback(()=>{setActiveId(null);setMetadataResult(null);setContextFileIds([]);fileCache.current.clear();updateUrl(null,'replace');},[updateUrl]);

  const openPreview = useCallback((fileId: string, options: OpenPreviewOptions = {}) => {
    if (!fileId) return;
    const ids = Array.from(new Set([...(options.contextFileIds || []), fileId]));
    setContextFileIds(ids);
    setActiveId(fileId);
    const cached = fileCache.current.get(fileId);
    if (cached) setMetadataResult({ id: fileId, file: cached });
    updateUrl(fileId, "push");
  }, [updateUrl]);

  const closePreview = useCallback(() => {
    setActiveId(null);
    if (history.state?.braandFilePreview === true) {
      history.back();
    } else {
      updateUrl(null, "replace");
    }
  }, [updateUrl]);

  const loadMetadata = useCallback(async (id: string) => {
    const result = await api<PreviewFile>(`/api/files/${encodeURIComponent(id)}/metadata`);
    fileCache.current.set(id, result);
    return result;
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void loadMetadata(activeId).then(result => {
      if (!cancelled) setMetadataResult({ id: activeId, file: result });
    }).catch(() => {
      if (!cancelled) setMetadataResult({ id: activeId, file: null });
    });
    return () => { cancelled = true; };
  }, [activeId, loadMetadata]);

  useEffect(() => {
    const onPopState = () => {
      const id = new URL(window.location.href).searchParams.get("apercu");
      if (!id) {
        setActiveId(null);
        return;
      }
      setActiveId(id);
      setContextFileIds(previous => previous.includes(id) ? previous : [id]);
    };
    window.addEventListener("popstate", onPopState);
    const initialId = new URL(window.location.href).searchParams.get("apercu");
    if (initialId) queueMicrotask(() => { setActiveId(initialId); setContextFileIds([initialId]); });
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const getSignedUrl = useCallback(async (fileId: string, scope: PreviewScope) => {
    const result = await api<{ url: string }>(`/api/files/${encodeURIComponent(fileId)}/url`, post({ scope }));
    return result.url;
  }, []);

  const fetchContent = useCallback(async (fileId: string, scope: "content" | "download" = "content") => {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = await getSignedUrl(fileId, scope);
      response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (response.ok || response.status !== 404 || attempt > 0) break;
    }
    if (!response?.ok) throw new Error(response?.status === 404 ? "Le lien temporaire a expiré. Réessayez." : "Impossible de charger ce fichier.");
    return response;
  }, [getSignedUrl]);

  const registerAddToConversation = useCallback((handler: (file: PreviewFile) => void) => {
    addHandler.current = handler;
    return () => { if (addHandler.current === handler) addHandler.current = null; };
  }, []);

  const addToConversation = useCallback(() => {
    if (!file || unavailable || file.status !== "ready" || !addHandler.current) return;
    addHandler.current(file);
    closePreview();
  }, [closePreview, file, unavailable]);

  const goToFile = useCallback((index: number) => {
    const nextId = contextFileIds[index];
    if (!nextId || nextId === activeId) return;
    setActiveId(nextId);
    const cached = fileCache.current.get(nextId);
    setMetadataResult(cached ? { id: nextId, file: cached } : null);
    updateUrl(nextId, "replace");
  }, [activeId, contextFileIds, updateUrl]);

  const value = useMemo(() => ({ resetPreview, registerPreviewPanel, openPreview, registerAddToConversation, getSignedUrl, fetchContent, closePreview, addToConversation, file, loading, unavailable, contextFileIds, contextIndex, activeId, goToFile }), [resetPreview, registerPreviewPanel, openPreview, registerAddToConversation, getSignedUrl, fetchContent, closePreview, addToConversation, file, loading, unavailable, contextFileIds, contextIndex, activeId, goToFile]);
  return <PreviewContext.Provider value={value}>{children}{!panelHandler&&<FilePreviewDialog/>}</PreviewContext.Provider>;
}
