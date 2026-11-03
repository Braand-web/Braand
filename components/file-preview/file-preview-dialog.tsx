"use client";

/* eslint-disable @next/next/no-img-element -- The preview uses authenticated, short-lived blob URLs that must not go through Next image optimization. */

import { Suspense, lazy, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, FileText, LoaderCircle, Minus, Plus, RotateCcw, X } from "lucide-react";
import { FILE_POLICY } from "@/lib/file-policy.mjs";
import { useFilePreview } from "./file-preview-provider";
import { formatFileSize, previewKind } from "./types";
import {LoadingSkeleton} from "@/components/ds/loading";

const PdfReader = lazy(() => import("./pdf-reader").then(module => ({ default: module.PdfReader })));
const DocxReader = lazy(() => import("./docx-reader").then(module => ({ default: module.DocxReader })));
const XlsxReader = lazy(() => import("./xlsx-reader").then(module => ({ default: module.XlsxReader })));
const PptxReader = lazy(() => import("./pptx-reader").then(module => ({ default: module.PptxReader })));
type ViewerState = { key: string; status: "idle" | "loading" | "ready" | "error" | "password"; contentUrl: string; text: string; error: string };

function useKeyedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const value = state?.key === key ? state.value : initial;
  const update = useCallback<Dispatch<SetStateAction<T>>>(next => {
    setState(current => {
      const currentValue = current?.key === key ? current.value : initial;
      return { key, value: typeof next === "function" ? (next as (previous: T) => T)(currentValue) : next };
    });
  }, [initial, key]);
  return [value, update];
}

export function FilePreviewDialog() {
  const { activeId, file, loading, unavailable, contextFileIds, contextIndex, goToFile, closePreview, addToConversation, getSignedUrl, fetchContent } = useFilePreview();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement>(null);
  const pendingMediaPosition = useRef<{ time: number; playing: boolean } | null>(null);
  const swipeStart = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const kind = file ? previewKind(file.mime) : "unsupported";
  const isOpen = activeId !== null;
  const viewerKey = `${file?.id || activeId || ""}:${retryKey}`;
  const [page, setPage] = useKeyedState(viewerKey, 1);
  const [pageCount, setPageCount] = useKeyedState(viewerKey, 0);
  const [zoom, setZoom] = useKeyedState(viewerKey, 1);
  const currentViewerState = viewerState?.key === viewerKey ? viewerState : null;
  const tooLargeForPreview = file?.status === "ready" && file.size > FILE_POLICY.maxFileBytes;
  const status = tooLargeForPreview ? "error" : currentViewerState?.status || (file?.status === "ready" && kind !== "unsupported" ? "loading" : "idle");
  const contentUrl = currentViewerState?.contentUrl || "";
  const textContent = currentViewerState?.text || "";
  const errorMessage = tooLargeForPreview ? "Ce fichier dépasse la limite autorisée pour l’aperçu. Vous pouvez le télécharger." : currentViewerState?.error || "";
  const updateViewer = useCallback((patch: Partial<Omit<ViewerState, "key">>) => {
    setViewerState(current => {
      const base = current?.key === viewerKey ? current : { key: viewerKey, status: "loading" as const, contentUrl: "", text: "", error: "" };
      return { ...base, ...patch };
    });
  }, [viewerKey]);
  const handleOfficeError = useCallback((message: string) => updateViewer({ status: "error", error: message }), [updateViewer]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-preview-close]")?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
      requestAnimationFrame(() => focusReturn.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    if (!file || file.status !== "ready" || kind === "unsupported" || file.size > FILE_POLICY.maxFileBytes || kind === "pdf") return () => { cancelled = true; };
    if (kind === "audio" || kind === "video") {
      void getSignedUrl(file.id, "content").then(url => {
        if (!cancelled) updateViewer({ contentUrl: url, status: "ready" });
      }).catch(error => {
        if (!cancelled) updateViewer({ status: "error", error: error instanceof Error ? error.message : "Impossible de préparer la lecture." });
      });
      return () => { cancelled = true; };
    }
    void fetchContent(file.id).then(async response => {
      if (kind === "text") {
        const text = await response.text();
        if (!cancelled) updateViewer({ text, status: "ready" });
      } else {
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) updateViewer({ contentUrl: objectUrl, status: "ready" });
      }
    }).catch(error => {
      if (!cancelled) updateViewer({ status: "error", error: error instanceof Error ? error.message : "Impossible de lire ce fichier." });
    });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, fetchContent, getSignedUrl, kind, updateViewer]);

  const loadPdfData = useCallback(async () => {
    if (!file) throw new Error("Fichier indisponible.");
    const response = await fetchContent(file.id);
    const bytes = new Uint8Array(await response.arrayBuffer());
    updateViewer({ status: "ready" });
    return bytes;
  }, [fetchContent, file, updateViewer]);

  const handlePdfPageCount = useCallback((count: number) => setPageCount(count), [setPageCount]);
  const handlePdfPassword = useCallback(() => updateViewer({ status: "password" }), [updateViewer]);
  const handlePdfError = useCallback((message: string) => updateViewer({ status: "error", error: message }), [updateViewer]);

  const retry = useCallback(() => {
    setRetryKey(value => value + 1);
  }, []);

  const download = useCallback(async () => {
    if (!file) return;
    try {
      const url = await getSignedUrl(file.id, "download");
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      updateViewer({ error: error instanceof Error ? error.message : "Le téléchargement est indisponible.", status: "error" });
    }
  }, [file, getSignedUrl, updateViewer]);

  const refreshMedia = useCallback(async () => {
    if (!file || (kind !== "audio" && kind !== "video")) return;
    const media = mediaRef.current;
    pendingMediaPosition.current = media ? { time: media.currentTime, playing: !media.paused } : null;
    try {
      updateViewer({ contentUrl: await getSignedUrl(file.id, "content"), status: "ready", error: "" });
    } catch (error) {
      updateViewer({ error: error instanceof Error ? error.message : "La lecture a été interrompue.", status: "error" });
    }
  }, [file, getSignedUrl, kind, updateViewer]);

  useEffect(() => {
    if (!contentUrl || (kind !== "audio" && kind !== "video")) return;
    const timeout = window.setTimeout(() => { void refreshMedia(); }, Math.max(1000, FILE_POLICY.signedUrlTtlMs - 45_000));
    return () => window.clearTimeout(timeout);
  }, [contentUrl, kind, refreshMedia]);

  const handleMediaLoaded = () => {
    const pending = pendingMediaPosition.current;
    const media = mediaRef.current;
    if (!pending || !media) return;
    media.currentTime = pending.time;
    if (pending.playing) void media.play().catch(() => undefined);
    pendingMediaPosition.current = null;
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === "ArrowLeft" && contextIndex > 0) { event.preventDefault(); goToFile(contextIndex - 1); }
      if (event.key === "ArrowRight" && contextIndex < contextFileIds.length - 1) { event.preventDefault(); goToFile(contextIndex + 1); }
      if ((event.key === "+" || event.key === "=") && (kind === "image" || kind === "pdf")) setZoom(value => Math.min(3, value + 0.25));
      if (event.key === "-" && (kind === "image" || kind === "pdf")) setZoom(value => Math.max(0.25, value - 0.25));
      if (event.key === "0" && (kind === "image" || kind === "pdf")) setZoom(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextFileIds.length, contextIndex, goToFile, isOpen, kind, setZoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    swipeStart.current = { x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" };
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start?.touch) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) goToFile(contextIndex + (dx < 0 ? 1 : -1));
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) closePreview();
  };

  return <dialog ref={dialogRef} className="file-preview-dialog" aria-label="Aperçu du fichier" onCancel={event => { event.preventDefault(); closePreview(); }} onClick={event => { if (event.target === dialogRef.current) closePreview(); }}>
    <div className="file-preview-shell" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <header className="file-preview-toolbar">
        <div className="file-preview-identity">
          <span className="file-preview-mark"><FileText size={17}/></span>
          <span><strong title={file?.name || "Fichier"}>{file?.name || (loading ? "Chargement du fichier…" : "Fichier indisponible")}</strong><small>{file ? `${formatFileSize(file.size)} · ${file.mime}` : ""}</small></span>
        </div>
        <div className="file-preview-actions">
          {(kind === "image" || kind === "pdf") && <div className="file-preview-zoom" aria-label="Zoom">
            <button type="button" className="file-preview-icon-button" onClick={() => setZoom(value => Math.max(0.25, value - 0.25))} aria-label="Réduire le zoom" disabled={zoom <= 0.25}><Minus size={17}/></button>
            <button type="button" className="file-preview-zoom-value" onClick={() => setZoom(1)} aria-label="Réinitialiser le zoom">{Math.round(zoom * 100)} %</button>
            <button type="button" className="file-preview-icon-button" onClick={() => setZoom(value => Math.min(3, value + 0.25))} aria-label="Agrandir le zoom" disabled={zoom >= 3}><Plus size={17}/></button>
          </div>}
          {contextFileIds.length > 1 && <div className="file-preview-navigation" aria-label="Naviguer parmi les fichiers">
            <button type="button" className="file-preview-icon-button" onClick={() => goToFile(contextIndex - 1)} aria-label="Fichier précédent" disabled={contextIndex <= 0}><ArrowLeft size={18}/></button>
            <span aria-live="polite">{contextIndex + 1} / {contextFileIds.length}</span>
            <button type="button" className="file-preview-icon-button" onClick={() => goToFile(contextIndex + 1)} aria-label="Fichier suivant" disabled={contextIndex >= contextFileIds.length - 1}><ArrowRight size={18}/></button>
          </div>}
          {file?.status === "ready" && !unavailable && <button type="button" className="file-preview-icon-button" onClick={() => void download()} aria-label="Télécharger le fichier"><ArrowDownToLine size={18}/></button>}
          <button type="button" data-preview-close className="file-preview-icon-button" onClick={closePreview} aria-label="Fermer l’aperçu"><X size={19}/></button>
        </div>
      </header>
      <main className="file-preview-stage" aria-live="polite">
        {(loading || status === "loading" || (file?.status === "ready" && kind === "pdf" && !pageCount)) && <div className="file-preview-state"><LoaderCircle className="spin" size={24}/><p>{loading ? "Ouverture du fichier…" : "Préparation de l’aperçu…"}</p></div>}
        {(!loading && (unavailable || file?.status === "deleted" || file?.status === "rejected")) && <div className="file-preview-state"><AlertCircle size={26}/><h2>{file?.status === "deleted" ? "Fichier supprimé" : "Fichier indisponible"}</h2><p>Ce fichier n’est pas accessible dans cet espace.</p></div>}
        {file?.status === "ready" && !unavailable && status === "error" && <div className="file-preview-state"><AlertCircle size={26}/><h2>Impossible d’ouvrir l’aperçu</h2><p>{errorMessage || "Une erreur est survenue lors du chargement du fichier."}</p><div className="file-preview-state-actions"><button type="button" className="button secondary" onClick={retry}><RotateCcw size={15}/>Réessayer</button><button type="button" className="button primary" onClick={() => void download()}><ArrowDownToLine size={15}/>Télécharger</button></div></div>}
        {file?.status === "ready" && !unavailable && status === "password" && <div className="file-preview-state"><AlertCircle size={26}/><h2>PDF protégé par mot de passe</h2><p>Le document est protégé. Téléchargez-le pour l’ouvrir avec un mot de passe.</p><button type="button" className="button primary" onClick={() => void download()}><ArrowDownToLine size={15}/>Télécharger</button></div>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "image" && contentUrl && <div className="file-preview-image-scroll"><img className="file-preview-image" src={contentUrl} alt={file.name} style={{ transform: `scale(${zoom})` }} draggable={false}/></div>}
        {file?.status === "ready" && !unavailable && kind === "pdf" && status !== "error" && status !== "password" && <div className="file-preview-pdf-wrap">
          <div className="file-preview-pdf-controls"><button type="button" className="file-preview-icon-button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1} aria-label="Page précédente"><ArrowLeft size={16}/></button><label>Page <input aria-label="Numéro de page PDF" type="number" min={1} max={pageCount || undefined} value={page} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) setPage(Math.min(pageCount || value, value)); }}/></label><span>sur {pageCount || "…"}</span><button type="button" className="file-preview-icon-button" onClick={() => setPage(value => Math.min(pageCount || value, value + 1))} disabled={!pageCount || page >= pageCount} aria-label="Page suivante"><ArrowRight size={16}/></button></div>
          <div className="file-preview-pdf-page"><Suspense fallback={<LoadingSkeleton label="Chargement du lecteur PDF…" shape="document"/>}><PdfReader key={`${activeId}-${retryKey}`} loadData={loadPdfData} page={page} zoom={zoom} onPageCount={handlePdfPageCount} onPassword={handlePdfPassword} onError={handlePdfError}/></Suspense></div>
        </div>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "text" && <div className="file-preview-text"><pre>{textContent}</pre></div>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "docx" && contentUrl && <Suspense fallback={<LoadingSkeleton label="Chargement du lecteur Word…" shape="document"/>}><DocxReader key={`${activeId}-${retryKey}`} mime={file.mime} contentUrl={contentUrl} onError={handleOfficeError}/></Suspense>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "xlsx" && contentUrl && <Suspense fallback={<LoadingSkeleton label="Chargement du lecteur Excel…" shape="document"/>}><XlsxReader key={`${activeId}-${retryKey}`} mime={file.mime} contentUrl={contentUrl} onError={handleOfficeError}/></Suspense>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "pptx" && contentUrl && <Suspense fallback={<LoadingSkeleton label="Chargement du lecteur PowerPoint…" shape="document"/>}><PptxReader key={`${activeId}-${retryKey}`} mime={file.mime} contentUrl={contentUrl} onError={handleOfficeError}/></Suspense>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "audio" && contentUrl && <div className="file-preview-media"><div className="file-preview-media-inner"><FileText size={36}/><h2>{file.name}</h2><p>{formatFileSize(file.size)}</p><audio ref={mediaRef as React.RefObject<HTMLAudioElement>} controls src={contentUrl} onLoadedMetadata={handleMediaLoaded} onError={() => void refreshMedia()} aria-label={`Lecture audio : ${file.name}`}/></div></div>}
        {file?.status === "ready" && !unavailable && status === "ready" && kind === "video" && contentUrl && <div className="file-preview-media"><video ref={mediaRef as React.RefObject<HTMLVideoElement>} controls playsInline src={contentUrl} onLoadedMetadata={handleMediaLoaded} onError={() => void refreshMedia()} aria-label={`Lecture vidéo : ${file.name}`}/></div>}
        {file?.status === "ready" && !unavailable && kind === "unsupported" && <div className="file-preview-state"><FileText size={26}/><h2>Aperçu non disponible</h2><p>Ce format ne peut pas être affiché ici. Vous pouvez télécharger le fichier.</p><button type="button" className="button primary" onClick={() => void download()}><ArrowDownToLine size={15}/>Télécharger</button></div>}
      </main>
      <footer className="file-preview-footer">
        <span>{file?.status === "ready" && kind === "text" ? "Texte affiché en lecture seule." : kind === "pdf" ? "Les numéros correspondent aux pages physiques du PDF." : kind === "docx" || kind === "xlsx" || kind === "pptx" ? "Document Office affiché en lecture seule." : ""}</span>
        {file?.status === "ready" && !unavailable && <button type="button" className="file-preview-add" onClick={addToConversation}>Ajouter à la conversation</button>}
      </footer>
    </div>
  </dialog>;
}
