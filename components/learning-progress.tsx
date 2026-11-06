"use client";
// "Braand apprend votre façon de faire": corrections needed per 10 answers,
// before and now, and the last things it learned from the user's own words.
import {useEffect, useState} from "react";
import {GraduationCap} from "lucide-react";
import {api} from "@/lib/client-api";
import "./learning-progress.css";

type Progress = {correctionsPer10: {before: number | null; after: number | null; trend: string}; totals: {answers: number; corrections: number; preferences: number; methodChanges: number}; recentLessons: {kind: string; text: string; at: number}[]; recentMethodChanges: {method: string; reason: string; at: number}[]; note: string};
const num = (v: number | null) => v === null ? "—" : v.toLocaleString("fr-FR", {maximumFractionDigits: 1});

export function LearningProgress() {
 const [data, setData] = useState<Progress | null>(null);
 useEffect(() => {let stop = false;api<Progress>("/api/learning").then(next => {if (!stop) setData(next);}).catch(() => undefined);return () => {stop = true;};}, []);
 if (!data) return null;
 const {before, after, trend} = data.correctionsPer10;
 const lessons = [...data.recentLessons.map(l => ({key: "l" + l.at, text: (l.kind === "correction" ? "Correction retenue : " : "Préférence retenue : ") + "« " + l.text + " »"})), ...data.recentMethodChanges.map(c => ({key: "m" + c.at, text: `Méthode « ${c.method} » améliorée : ${c.reason}`}))].slice(0, 4);
 return <section className="learning-progress" aria-label="Braand apprend votre façon de faire">
  <div className="learning-progress-head"><GraduationCap size={18} aria-hidden="true"/><div><strong>Braand apprend votre façon de faire</strong><p>Chaque correction que vous faites est retenue et ajoutée à vos méthodes, pour ne plus avoir à la refaire.</p></div></div>
  <dl className="learning-progress-figures">
   <div><dt>Corrections pour 10 réponses</dt><dd aria-label={`Avant ${num(before)}, maintenant ${num(after)}`}>{num(before)} <span aria-hidden="true">→</span> {num(after)}{trend === "improving" ? <em className="good"> en baisse</em> : trend === "worse" ? <em className="bad"> en hausse</em> : null}</dd></div>
   <div><dt>Ce que Braand a retenu</dt><dd>{data.totals.corrections + data.totals.preferences}</dd></div>
   <div><dt>Méthodes améliorées</dt><dd>{data.totals.methodChanges}</dd></div>
  </dl>
  {lessons.length ? <ul className="learning-progress-list">{lessons.map(item => <li key={item.key}>{item.text}</li>)}</ul> : null}
  <p className="learning-progress-note">{data.note}</p>
 </section>;
}
