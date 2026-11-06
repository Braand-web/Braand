"use client";
// Settings › Connexions: the user's own GitHub account, so Braand can open
// private repositories and propose changes as pull requests (always with the
// user's approval). The token stays on the server.
import {useEffect, useState} from "react";
import {GitBranch} from "lucide-react";
import {api} from "@/lib/client-api";
import {Button} from "./ds";
import "./github-connection.css";

type Status = {available: boolean; connected: boolean; login: string | null};
const NOTICES: Record<string, string> = {connected: "Votre compte GitHub est connecté.", cancelled: "Connexion GitHub annulée.", invalid: "Le lien de connexion a expiré. Recommencez.", failed: "La connexion GitHub n’a pas abouti. Réessayez.", unavailable: "La connexion GitHub n’est pas encore activée sur Braand."};

export function GithubConnection() {
 const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false);
 const [notice] = useState(() => {try {return NOTICES[new URL(window.location.href).searchParams.get("github") || ""] || "";} catch {return "";}});
 useEffect(() => {let stop = false;api<Status>("/api/github").then(next => {if (!stop) setStatus(next);}).catch(() => undefined);return () => {stop = true;};}, []);
 if (!status) return null;
 const disconnect = async () => {setBusy(true);try {await api("/api/github", {method: "DELETE"});setStatus({...status, connected: false, login: null});} finally {setBusy(false);}};
 return <section className="github-connection" aria-label="GitHub">
  <GitBranch size={20} aria-hidden="true"/>
  <div>
   <strong>GitHub</strong>
   <p>{status.connected ? <>Connecté en tant que <b>@{status.login}</b>. Braand peut ouvrir vos dépôts privés et vous proposer ses modifications en pull request, toujours avec votre accord.</> : "Les dépôts publics s’ouvrent sans connexion. Connectez votre compte pour vos dépôts privés et pour recevoir les modifications de Braand en pull request."}</p>
   {notice && <p className="github-connection-notice" role="status">{notice}</p>}
  </div>
  {status.connected
   ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => void disconnect()}>Déconnecter</Button>
   : status.available ? <a className="ds-btn ds-btn-primary ds-btn-sm" href="/api/github/connect">Connecter GitHub</a> : <span className="github-connection-soon">Bientôt disponible</span>}
 </section>;
}
