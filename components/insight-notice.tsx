"use client";
// "Braand a remarqué…": what the proactive watch found on the user's sites
// (visits dropping, contact requests stopping). One click asks Braand to find
// the cause and prepare a fix in the conversation; the cross dismisses it.
import {useEffect, useRef, useState} from "react";
import {Radar, X} from "lucide-react";
import {api, post} from "@/lib/client-api";
import {Button} from "./ds";
import "./credit-notice.css";

type Insight = {id: string; type: string; slug: string; title: string; status: string; detectedAt: number};

export function InsightNotice({refreshKey, onAnalyze}: {refreshKey: unknown; onAnalyze: (prompt: string) => void}) {
 const [insights, setInsights] = useState<Insight[]>([]);
 const [busy, setBusy] = useState(false);
 const lock = useRef(false);
 useEffect(() => {
  let stop = false;
  const timer = setTimeout(() => {api<{insights: Insight[]}>("/api/insights").then(next => {if (!stop) setInsights(next.insights || []);}).catch(() => undefined);}, 1200);
  return () => {stop = true;clearTimeout(timer);};
 }, [refreshKey]);
 const insight = insights.find(item => item.status === "open");
 if (!insight) return null;
 const decide = async (action: "investigate" | "dismiss") => {
  if (lock.current) return;lock.current = true;setBusy(true);
  try {
   await api("/api/insights", {...post({id: insight.id, action}), method: "PATCH"});
   setInsights(current => current.map(item => item.id === insight.id ? {...item, status: action === "dismiss" ? "dismissed" : "investigating"} : item));
   if (action === "investigate") onAnalyze(`Braand a remarqué : ${insight.title} (signal ${insight.id}). Analyse la cause avec list_insights et site_traffic, puis propose-moi un correctif précis à autoriser.`);
  } catch {/* The notice stays; the user can try again. */} finally {lock.current = false;setBusy(false);}
 };
 return <div className="credit-notice insight" role="status" aria-live="polite">
  <Radar size={16} aria-hidden="true"/>
  <div><strong>Braand a remarqué</strong><p>{insight.title}.</p></div>
  <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide("investigate")}>Analyser et corriger</Button>
  <button type="button" className="credit-notice-close" aria-label="Fermer" title="Ignorer ce signal" disabled={busy} onClick={() => void decide("dismiss")}><X size={14}/></button>
 </div>;
}
