"use client";
// "Autoriser Braand à ouvrir cette pull request ?": the exact files Braand
// changed in a GitHub project, approved or refused in the conversation.
// Nothing is pushed before approval; the push is bound to these changes.
import {useEffect, useRef, useState} from "react";
import {GitPullRequest} from "lucide-react";
import {api, post} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import {ApprovalCard} from "./approval-card";
import "./github-pr-card.css";

type Change = {path: string; status: string; added: number; removed: number};
const STATUS: Record<string, string> = {A: "ajouté", "??": "ajouté", D: "supprimé", M: "modifié", R: "renommé"};

export function GithubPrCard({resource: initial, onUpdated}: {resource: Resource; onUpdated?: () => void}) {
 const [local, setResource] = useState(initial), [busy, setBusy] = useState<"approve"|"reject"|null>(null), [error, setError] = useState("");
 const resource=local.id!==initial.id||initial.version>local.version?initial:local;
 const lock = useRef(false);
 useEffect(() => {let stop = false;api<Resource>("/api/resources/" + encodeURIComponent(initial.id)).then(next => {if (!stop) setResource(current=>current.id!==next.id||next.version>=current.version?next:current);}).catch(() => undefined);return () => {stop = true;};}, [initial.id]);
 const data = resource.data as {repo?: string; title?: string; description?: string; branch?: string; files?: Change[]; prUrl?: string};
 const files = data.files || [];
 const decide = async (decision: "approve" | "reject") => {
  if (lock.current) return;lock.current = true;setBusy(decision);setError("");
  try {setResource(await api<Resource>("/api/github/pr/" + encodeURIComponent(resource.id), post({decision, version: resource.version})));onUpdated?.();}
  catch (e) {setError(e instanceof Error ? e.message : "La décision n’a pas pu être enregistrée.");} finally {lock.current=false;setBusy(null);}
 };
 const outcome=resource.status==='awaiting_approval'?null:resource.status==='completed'?{tone:'done' as const,label:'Pull request ouverte'}:resource.status==='rejected'?{tone:'refused' as const,label:'Refusé'}:{tone:'warning' as const,label:resource.status==='stale'?'Proposition à actualiser':'Résultat à vérifier'};
 const prUrl=typeof data.prUrl==='string'&&data.prUrl.startsWith('https://github.com/')?data.prUrl:undefined;
 return <ApprovalCard className="github-pr-card" icon={<GitPullRequest size={18}/>} title={`Autoriser Braand à ouvrir cette pull request sur ${data.repo} ?`} compactTitle={data.title||resource.title} summary={data.description}
  essentials={[{label:'Dépôt',value:data.repo||'Indisponible'}]} fields={[{label:'Dépôt',value:data.repo||'Indisponible'},{label:'Branche',value:data.branch||'Indisponible'},{label:'Fichiers',value:String(files.length)}]}
  outcome={outcome} busy={busy} error={error} onApprove={()=>void decide('approve')} onReject={()=>void decide('reject')}
  resultAction={resource.status==='completed'&&prUrl?<a href={prUrl} target="_blank" rel="noopener noreferrer">Voir la pull request</a>:undefined}>
  <ul className="github-pr-files" aria-label="Fichiers modifiés">{files.slice(0, 30).map(file => <li key={file.path}><code>{file.path}</code><span>{STATUS[file.status] || STATUS[file.status?.[0]] || "modifié"}</span><span className="github-pr-lines"><b>+{file.added}</b> <i>−{file.removed}</i></span></li>)}{files.length > 30 ? <li className="github-pr-more">et {files.length - 30} autre(s) fichier(s)</li> : null}</ul>
  {resource.status==='stale'&&<p className="approval-note">Le projet a changé depuis : demandez une nouvelle proposition.</p>}
 </ApprovalCard>;
}
