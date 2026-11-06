"use client";
// Warns in the conversation, before it happens, that credits are running out.
// The level comes from the server (balance, pace of the last 7 days, expiry);
// the small cross hides it for the day; a worse level shows it again.
import {useEffect, useState} from "react";
import {AlertTriangle, X} from "lucide-react";
import {api} from "@/lib/client-api";
import {Button} from "./ds";
import "./credit-notice.css";

type Outlook = {level: "ok" | "low" | "critical" | "empty"; summary: string; canTopUp: boolean};
const TITLES = {low: "Vos crédits baissent", critical: "Vos crédits sont presque épuisés", empty: "Vos crédits sont épuisés"} as const;
const hiddenKey = (level: string) => `braand-credit-notice:${level}:${new Date().toISOString().slice(0, 10)}`;
const isHidden = (level: string) => {try {return localStorage.getItem(hiddenKey(level)) === "1";} catch {return false;}};

export function CreditNotice({refreshKey, onTopUp}: {refreshKey: unknown; onTopUp: () => void}) {
 const [outlook, setOutlook] = useState<Outlook | null>(null);
 const [hidden, setHidden] = useState<string | null>(null);
 useEffect(() => {
  let stop = false;
  // Read again after each answer, once its credits are settled.
  const timer = setTimeout(() => {api<Outlook>("/api/billing/outlook").then(next => {if (!stop) setOutlook(next);}).catch(() => undefined);}, 1500);
  return () => {stop = true;clearTimeout(timer);};
 }, [refreshKey]);
 if (!outlook || outlook.level === "ok" || hidden === outlook.level || isHidden(outlook.level)) return null;
 const level = outlook.level;
 return <div className={"credit-notice " + level} role="status" aria-live="polite">
  <AlertTriangle size={16} aria-hidden="true"/>
  <div><strong>{TITLES[level]}</strong><p>{outlook.summary}.{outlook.canTopUp ? "" : " Demandez au propriétaire de l’espace de recharger."}</p></div>
  {outlook.canTopUp && <Button variant={level === "low" ? "secondary" : "primary"} size="sm" onClick={onTopUp}>Recharger</Button>}
  <button type="button" className="credit-notice-close" aria-label="Fermer" title="Masquer pour aujourd’hui" onClick={() => {try {localStorage.setItem(hiddenKey(level), "1");} catch {/* Hidden for this view only. */}setHidden(level);}}><X size={14}/></button>
 </div>;
}
