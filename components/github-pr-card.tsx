"use client";
// "Autoriser Braand à ouvrir cette pull request ?": the exact files Braand
// changed in a GitHub project, approved or refused in the conversation.
// Nothing is pushed before approval; the push is bound to these changes.
import {useEffect, useRef, useState} from "react";
import {GitPullRequest} from "lucide-react";
import {api, post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import {Button} from "./ds";
import "./github-pr-card.css";

type Change = {path: string; status: string; added: number; removed: number};
const STATUS: Record<string, string> = {A: "ajouté", "??": "ajouté", D: "supprimé", M: "modifié", R: "renommé"};

export function GithubPrCard({resource: initial, onUpdated}: {resource: Resource; onUpdated?: () => void}) {
 const [resource, setResource] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
 const lock = useRef(false);
 useEffect(() => {let stop = false;api<Resource>("/api/resources/" + encodeURIComponent(initial.id)).then(next => {if (!stop) setResource(next);}).catch(() => undefined);return () => {stop = true;};}, [initial.id]);
 const data = resource.data as {repo?: string; title?: string; description?: string; branch?: string; files?: Change[]; prUrl?: string};
 const files = data.files || [];
 const decide = async (decision: "approve" | "reject") => {
  if (lock.current) return;lock.current = true;setBusy(true);setError("");
  try {setResource(await api<Resource>("/api/github/pr/" + encodeURIComponent(resource.id), post({decision, version: resource.version})));onUpdated?.();}
  catch (e) {setError(e instanceof Error ? e.message : "La décision n’a pas pu être enregistrée.");lock.current = false;} finally {setBusy(false);}
 };
 const done = resource.status !== "awaiting_approval";
 return <section className="approval-card github-pr-card" aria-label={`Autoriser Braand à ouvrir cette pull request sur ${data.repo} ?`}>
  <div className="github-pr-head"><GitPullRequest size={18} aria-hidden="true"/><div><strong>{done ? data.title : `Autoriser Braand à ouvrir cette pull request sur ${data.repo} ?`}</strong>{!done && <p>{data.title}</p>}</div></div>
  {data.description && !done ? <p className="github-pr-description">{data.description}</p> : null}
  <ul className="github-pr-files" aria-label="Fichiers modifiés">{files.slice(0, 30).map(file => <li key={file.path}><code>{file.path}</code><span>{STATUS[file.status] || STATUS[file.status?.[0]] || "modifié"}</span><span className="github-pr-lines"><b>+{file.added}</b> <i>−{file.removed}</i></span></li>)}{files.length > 30 ? <li className="github-pr-more">et {files.length - 30} autre(s) fichier(s)</li> : null}</ul>
  {error && <p className="github-pr-error" role="alert">{error}</p>}
  {resource.status === "awaiting_approval" ? <div className="github-pr-actions"><Button variant="primary" size="sm" disabled={busy} loading={busy} onClick={() => void decide("approve")}>Autoriser</Button><Button variant="secondary" size="sm" disabled={busy} onClick={() => void decide("reject")}>Refuser</Button><small>Branche {data.branch} · rien n’est envoyé avant votre accord.</small></div>
   : resource.status === "completed" && data.prUrl ? <p className="github-pr-result" role="status">Autorisé · <a href={data.prUrl} target="_blank" rel="noopener noreferrer">Voir la pull request</a></p>
   : <p className="github-pr-result" role="status">{resource.status === "rejected" ? "Refusé" : resource.status === "stale" ? "Le projet a changé depuis : demandez une nouvelle proposition." : "Traité"}</p>}
 </section>;
}
