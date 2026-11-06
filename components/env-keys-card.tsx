"use client";
// Secure form for the keys a project needs to run in Braand's sandbox. The
// values go straight to the server (sealed, written only to this
// conversation's sandbox); they never appear in the chat or reach the AI.
import {useRef, useState, type FormEvent} from "react";
import {KeyRound} from "lucide-react";
import {api, post} from "@/lib/client-api";
import {Button} from "./ds";
import "./env-keys-card.css";

export type EnvRequest = {keys: string[]; known: string[]; reason: string; conversationId: string};

export function EnvKeysCard({request, onSaved}: {request: EnvRequest; onSaved: (text: string) => void}) {
 const [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState<string[] | null>(null);
 const lock = useRef(false);
 const filled = Object.entries(values).filter(([, v]) => v.trim());
 const submit = async (event: FormEvent) => {
  event.preventDefault();if (lock.current || !filled.length) return;lock.current = true;setBusy(true);setError("");
  try {
   const result = await api<{saved: string[]}>("/api/code/env", post({conversationId: request.conversationId, values: Object.fromEntries(filled.map(([k, v]) => [k, v.trim()]))}));
   setSaved(result.saved);setValues({});
   onSaved(`J’ai enregistré ${result.saved.length} clé${result.saved.length > 1 ? "s" : ""} (${result.saved.join(", ")}) dans le formulaire sécurisé. Relance l’aperçu du projet avec ces clés.`);
  } catch (e) {setError(e instanceof Error ? e.message : "Les clés n’ont pas pu être enregistrées.");lock.current = false;} finally {setBusy(false);}
 };
 if (saved) return <p className="env-keys-done" role="status"><KeyRound size={14} aria-hidden="true"/>{saved.length} clé{saved.length > 1 ? "s" : ""} enregistrée{saved.length > 1 ? "s" : ""} en sécurité : {saved.join(", ")}.</p>;
 return <form className="env-keys" onSubmit={submit} aria-label="Clés du projet">
  <div className="env-keys-head"><KeyRound size={16} aria-hidden="true"/><div><strong>Clés nécessaires au projet</strong><p>{request.reason || "Le projet en a besoin pour démarrer."} Elles sont chiffrées, utilisées seulement dans l’environnement de cette discussion, et ne passent jamais par la discussion ni par l’IA.</p></div></div>
  {request.keys.map(key => <label key={key} className="env-keys-field"><span>{key}{request.known.includes(key) ? <em> · déjà enregistrée</em> : null}</span>
   <input type="password" autoComplete="off" spellCheck={false} value={values[key] || ""} placeholder={request.known.includes(key) ? "Laisser vide pour garder la valeur" : "Valeur"} onChange={e => setValues(current => ({...current, [key]: e.target.value}))} disabled={busy}/></label>)}
  {error && <p className="env-keys-error" role="alert">{error}</p>}
  <div className="env-keys-actions"><Button type="submit" variant="primary" size="sm" disabled={!filled.length} loading={busy}>Enregistrer en sécurité</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => onSaved("Lance le projet sans ces clés si c’est possible, et dis-moi ce qui ne fonctionnera pas.")}>Lancer sans ces clés</Button></div>
 </form>;
}
