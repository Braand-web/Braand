"use client";

import {useEffect, useRef, useState, type ReactNode} from "react";
import {ArrowUpRight, BookOpen, ChevronRight, CircleHelp, CreditCard, FolderClosed, HardDrive, LoaderCircle, LogOut, Plug, RefreshCw, Settings2, ShieldCheck, UsersRound, Wallet, X} from "lucide-react";
import ConnectorsPanel from "@/app/connectors-panel";
import {api} from "@/lib/client-api";
import "./settings-panel.css";
import {LEGAL_LINKS} from '@/lib/legal-links.mjs';
import {BrowserSecuritySettings} from './browser-security-settings';
import {MemoryPanel} from './memory-panel';
import {AppearanceSettings} from '@/components/appearance-settings';

export type SettingsTab = "general" | "connections" | "skills" | "credits" | "billing" | "team" | "storage" | "permissions" | "help" | "legal";

type BillingSummary = {
 wallet?: {available?: number; reserved?: number};
 creditAllowance?: number;
 subscription?: {plan: string; cycle: string; start_at: number; end_at: number} | null;
 meters?: {storage?: number; transfer?: number} | null;
 asOf?: number;
};
type OrganizationSummary = {role?: string; rights?: {plan?: string; limits?: {storage?: number; transfer?: number}}};
const sections = [
 {id: "general", label: "Général", icon: Settings2},
 {id: "connections", label: "Connecteurs", icon: Plug},
 {id: "skills", label: "Compétences", icon: BookOpen},
 {id: "credits", label: "Portefeuille", icon: Wallet},
 {id: "billing", label: "Facturation", icon: CreditCard},
 {id: "team", label: "Équipe et budgets", icon: UsersRound},
 {id: "storage", label: "Stockage", icon: HardDrive},
 {id: "permissions", label: "Autorisations", icon: ShieldCheck},
 {id: "help", label: "Aide et raccourcis", icon: CircleHelp},
 {id: "legal", label: "Informations légales", icon: ShieldCheck},
] as const;
export function isSettingsTab(value: string | null): value is SettingsTab { return sections.some(section => section.id === value); }
const number = (value: number) => new Intl.NumberFormat("fr-FR", {maximumFractionDigits: 2}).format(value);
const quantity = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const bytes = (value: number) => {
 if (value < 1024) return `${number(value)} o`;
 if (value < 1024 ** 2) return `${number(value / 1024)} Ko`;
 if (value < 1024 ** 3) return `${number(value / 1024 ** 2)} Mo`;
 return `${number(value / 1024 ** 3)} Go`;
};
const planLabel = (value?: string) => value === "essential" ? "Essentiel" : value === "pro" ? "Pro" : value === "business" ? "Business" : value === "free" ? "Découverte" : undefined;
const roleLabel = (value?: string) => value === "owner" ? "Propriétaire" : value === "admin" ? "Administrateur" : value === "editor" ? "Éditeur" : value === "approver" ? "Approbateur" : value === "reader" ? "Lecteur" : undefined;

function Value({value, loading}: {value?: string; loading: boolean}) {
 return value !== undefined ? <>{value}</> : loading ? <><span className="settings-value-skeleton" aria-hidden="true"/><span className="settings-sr-only">Chargement…</span></> : <>Indisponible</>;
}

export function SettingsPanel({tab, onTabChange, user, workspace, capabilities, skillsContent, billingContent, teamContent, sessionState, onSignIn, onClose, onFiles, onRefresh}: {
 sessionState?: "loading" | "authenticated" | "anonymous" | "error";
 onSignIn?: () => void;
 tab: SettingsTab;
 onTabChange: (tab: SettingsTab) => void;
 user?: {id?: string; name: string; email: string};
 workspace?: {id?: string; name: string; credits: number; reserved: number};
 capabilities?: {modelProvider?: string; modelReady?: boolean; model?: boolean; modelStatus?: string; media?: boolean; metaConnected?: boolean};
 skillsContent?: ReactNode;
 billingContent?: ReactNode;
 teamContent?: ReactNode;
 onClose: () => void;
 /** @deprecated La facturation s’ouvre maintenant avec onTabChange("billing"). */
 onBilling?: () => void;
 onFiles: () => void;
 onRefresh?: () => void;
}) {
 const identity = user?.id?.trim() || user?.email?.trim() || "";
 const signedIn = Boolean(identity) && (!sessionState || sessionState === "authenticated");
 const pendingSession = sessionState === "loading";
 const sessionError = sessionState === "error";
 const accountSection = tab !== "help" && tab !== "legal";
 const navigation = useRef<HTMLElement>(null);
 const cacheKey = JSON.stringify([identity, workspace?.id ?? null, workspace?.credits ?? null, workspace?.reserved ?? null]);
 const [result, setResult] = useState<{cacheKey: string; revision: number; summary: BillingSummary | null; organization: OrganizationSummary | null; summaryError: boolean; organizationError: boolean} | null>(null);
 const [revision, setRevision] = useState(0);
 const currentResult = result?.cacheKey === cacheKey && result.revision === revision ? result : null;
 const summary = currentResult?.summary;
 const organization = currentResult?.organization;
 const loading = signedIn && currentResult === null;
 const summaryError = currentResult?.summaryError;
 const organizationError = currentResult?.organizationError;

 useEffect(() => {
  navigation.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.scrollIntoView({block: "nearest", inline: "nearest"});
 }, [tab]);

 useEffect(() => {
  if (!signedIn) return;
  const controller = new AbortController();
  void Promise.allSettled([
   api<BillingSummary>("/api/billing/summary", {signal: controller.signal}),
   api<OrganizationSummary>("/api/billing/organization", {signal: controller.signal}),
  ]).then(([billingResult, organizationResult]) => {
   if (controller.signal.aborted) return;
   const summary = billingResult.status === "fulfilled" && billingResult.value && typeof billingResult.value === "object" ? billingResult.value : null;
   const organization = organizationResult.status === "fulfilled" && organizationResult.value && typeof organizationResult.value === "object" ? organizationResult.value : null;
   setResult({cacheKey, revision, summary, organization, summaryError: summary === null, organizationError: organization === null});
  });
  return () => controller.abort();
 }, [cacheKey, revision, signedIn]);

 const workspaceReserved = quantity(signedIn ? workspace?.reserved : undefined);
 const reserved = quantity(summary?.wallet?.reserved) ?? workspaceReserved;
 const workspaceCredits = quantity(signedIn ? workspace?.credits : undefined);
 const workspaceAvailable = workspaceCredits !== undefined && workspaceReserved !== undefined && workspaceCredits >= workspaceReserved ? workspaceCredits - workspaceReserved : undefined;
 const available = quantity(summary?.wallet?.available) ?? workspaceAvailable;
 const allowance = quantity(summary?.creditAllowance);
 const storage = quantity(summary?.meters?.storage);
 const storageLimit = quantity(organization?.rights?.limits?.storage);
 const transfer = quantity(summary?.meters?.transfer);
 const transferLimit = quantity(organization?.rights?.limits?.transfer);
 const subscription = summary?.subscription;
 const plan = planLabel(subscription?.plan ?? organization?.rights?.plan);
 const storageText = storage !== undefined && storageLimit !== undefined ? `${bytes(storage)} sur ${bytes(storageLimit)}` : storage !== undefined ? `${bytes(storage)} utilisés` : undefined;
 const heading = sections.find(section => section.id === tab)?.label ?? "Général";
 const dataTab = tab === "general" || tab === "credits" || tab === "storage" || tab === "permissions";
 const visibleSummaryError = summaryError && (tab === "general" || tab === "credits" || tab === "storage");
 const visibleOrganizationError = organizationError && (tab === "general" || tab === "storage" || tab === "permissions");
 const modelState = capabilities?.modelReady ? "Disponible" : "Indisponible";
 const signIn = <a onClick={event=>{if(onSignIn){event.preventDefault();onSignIn();}}} className="settings-button settings-primary" href="/auth/sign-in?return_to=/" target="_top">Se connecter<ArrowUpRight size={15} aria-hidden="true"/></a>;
 const privateTab = tab === "skills" || tab === "credits" || tab === "billing" || tab === "team" || tab === "storage" || tab === "permissions";
 const slots: Partial<Record<SettingsTab, ReactNode>> = {skills: skillsContent, billing: billingContent, team: teamContent};

 const storageUsage = <div className="settings-storage">
  <span><Value value={storageText} loading={loading}/></span>
  {storage !== undefined && storageLimit !== undefined && storageLimit > 0 && <div className="settings-meter" role="progressbar" aria-label="Stockage utilisé" aria-valuemin={0} aria-valuemax={storageLimit} aria-valuenow={Math.min(storage, storageLimit)} aria-valuetext={storageText}><span style={{width: `${Math.min(100, storage / storageLimit * 100)}%`}}/></div>}
 </div>;

 return <div className="settings-shell">
  <aside className="settings-sidebar">
   <h2 id="braand-dialog-title">Paramètres</h2>
   <nav ref={navigation} className="settings-navigation" aria-label="Catégories des paramètres">
    {sections.map(({id, label, icon: Icon}) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => onTabChange(id)}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>)}
   </nav>
   {!pendingSession && !sessionError && (signedIn?<form method="post" action="/auth/sign-out" target="_top" style={{display:'contents'}}><input type="hidden" name="confirm" value="yes"/><button type="submit" className="settings-signout"><LogOut size={18} aria-hidden="true"/><span>Se déconnecter</span></button></form>:<a onClick={event=>{if(onSignIn){event.preventDefault();onSignIn();}}} className="settings-signout" href="/auth/sign-in?return_to=/" target="_top"><LogOut size={18} aria-hidden="true"/><span>Se connecter</span></a>)}
  </aside>
  <section className="settings-main" aria-labelledby="settings-section-title">
   <header className="settings-header"><h3 id="settings-section-title">{heading}</h3><button className="settings-close" type="button" onClick={onClose} aria-label="Fermer les paramètres" title="Fermer les paramètres"><X size={18} aria-hidden="true"/></button></header>
   <div className="settings-content" data-settings-section={tab} aria-busy={pendingSession || (dataTab && loading)}>
    {accountSection && pendingSession && <p className="settings-intro" role="status"><LoaderCircle size={16} className="spin" aria-hidden="true"/> Vérification de votre session…</p>}
    {accountSection && sessionError && <div className="settings-error" role="alert"><p>Votre compte n’a pas pu être chargé. Réessayez pour vérifier votre session.</p><button type="button" className="settings-button" onClick={onRefresh}>Réessayer</button></div>}
    {(!accountSection || (!pendingSession && !sessionError)) && <>
    {dataTab && (visibleSummaryError || visibleOrganizationError) && <div className="settings-error" role="alert"><p>{visibleSummaryError && visibleOrganizationError ? "Le portefeuille et les droits de l’organisation n’ont pas pu être chargés." : visibleSummaryError ? "Le portefeuille n’a pas pu être chargé." : "Les droits de l’organisation n’ont pas pu être chargés."}</p><button type="button" className="settings-button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true"/>Réessayer</button></div>}
    {tab === "general" && <>
     {signedIn&&<MemoryPanel/>}
     <section className="settings-section" aria-labelledby="settings-account-title">
      <h4 id="settings-account-title">Mon compte</h4>
      {signedIn ? <dl className="settings-card settings-details"><div className="settings-row"><dt>Nom</dt><dd>{user?.name || "Indisponible"}</dd></div><div className="settings-row"><dt>Adresse e-mail</dt><dd>{user?.email || "Indisponible"}</dd></div></dl> : <div className="settings-card settings-guest"><p>Connectez-vous pour retrouver votre compte et votre espace.</p>{signIn}</div>}
     </section>
     {signedIn && <section className="settings-section" aria-labelledby="settings-security-title"><h4 id="settings-security-title">Sécurité</h4><div className="settings-card"><div className="settings-row settings-row-action"><div className="settings-row-copy"><span>Sessions</span><small>Votre session reste active tant que vous utilisez Braand, 90 jours au maximum.</small></div><form method="post" action="/auth/sign-out" target="_top" style={{display:'contents'}}><input type="hidden" name="confirm" value="yes"/><input type="hidden" name="scope" value="all"/><button type="submit" className="settings-button">Se déconnecter de tous les appareils</button></form></div></div></section>}
     {signedIn && <section className="settings-section" aria-labelledby="settings-workspace-title">
      <h4 id="settings-workspace-title">Mon espace</h4>
      <div className="settings-card">
       <dl className="settings-details"><div className="settings-row"><dt>Espace de travail</dt><dd>{workspace?.name || "Indisponible"}</dd></div></dl>
       <div className="settings-row settings-row-action"><div className="settings-row-copy"><span>Crédits disponibles</span><strong><Value value={available !== undefined ? `${number(available)} crédits` : undefined} loading={loading}/></strong><small>{reserved !== undefined ? `${number(reserved)} réservés` : loading ? "Chargement des réservations…" : "Réservations indisponibles"}</small></div><button type="button" className="settings-button" onClick={() => onTabChange("credits")}>Voir le portefeuille<ChevronRight size={14} aria-hidden="true"/></button></div>
       <div className="settings-row settings-row-action"><div className="settings-row-copy"><span>Forfait</span><small><Value value={plan ?? (subscription === null ? "Aucun abonnement actif" : undefined)} loading={loading}/></small></div><button type="button" className="settings-button" onClick={() => onTabChange("billing")}>Facturation<ChevronRight size={14} aria-hidden="true"/></button></div>
      </div>
     </section>}
     <section className="settings-section" aria-labelledby="settings-services-title"><h4 id="settings-services-title">Services de l’assistant</h4><div className="settings-card"><div className="settings-row"><div className="settings-row-copy"><span>Assistant Braand</span><small>Discussions et aide à la création</small></div><span className={"settings-service-state" + (capabilities?.modelReady ? " settings-service-ready" : "")}>{modelState}</span></div><div className="settings-row"><div className="settings-row-copy"><span>Création multimédia</span><small>Images, vidéos et audio</small></div><span className={"settings-service-state" + (capabilities?.media ? " settings-service-ready" : "")}>{capabilities?.media ? "Disponible" : "Indisponible"}</span></div></div>{(!capabilities?.modelReady || !capabilities?.media) && <p className="settings-service-note">Si un service reste indisponible, contactez le support Braand.</p>}{capabilities?.metaConnected && <p className="settings-service-note">Votre connexion Meta reste accessible dans Résultats.</p>}</section>
     <section className="settings-section" aria-labelledby="settings-preferences-title">
      <h4 id="settings-preferences-title">Préférences</h4>
      <div className="settings-card"><dl className="settings-details"><div className="settings-row"><dt>Langue de l’interface</dt><dd>Français</dd></div></dl><button type="button" className="settings-row settings-row-link" onClick={() => onTabChange("help")}><span>Aide et raccourcis</span><ChevronRight size={16} aria-hidden="true"/></button></div>
     </section>
     <AppearanceSettings/>
    </>}
    {tab === "connections" && (signedIn ? <ConnectorsPanel embedded onChange={onRefresh}/> : <div className="settings-card settings-guest"><h4>Connectez vos applications</h4><p>Connectez-vous à Braand pour accéder aux intégrations de votre espace.</p>{signIn}</div>)}
    {privateTab && !signedIn && <div className="settings-card settings-guest"><p>Connectez-vous pour accéder à la rubrique {heading.toLocaleLowerCase("fr")} de votre espace.</p>{signIn}</div>}
    {signedIn && (tab === "skills" || tab === "billing" || tab === "team") && <div className={"settings-slot settings-slot-" + tab}>{slots[tab] ?? <p className="settings-intro">Cette rubrique est indisponible pour le moment.</p>}</div>}
    {tab === "credits" && signedIn && <>
     <p className="settings-intro">Les crédits sont partagés par votre organisation.</p>
     <section className="settings-section" aria-labelledby="settings-credits-title"><h4 id="settings-credits-title">Crédits</h4><dl className="settings-card settings-details"><div className="settings-row"><dt>Disponibles</dt><dd className="settings-strong"><Value value={available !== undefined ? `${number(available)} crédits` : undefined} loading={loading}/></dd></div><div className="settings-row"><dt>Réservés</dt><dd><Value value={reserved !== undefined ? `${number(reserved)} crédits` : undefined} loading={loading}/></dd></div><div className="settings-row"><dt>Allocation par période</dt><dd><Value value={allowance !== undefined ? `${number(allowance)} crédits` : undefined} loading={loading}/></dd></div></dl></section>
     <div className="settings-billing-footer"><button type="button" className="settings-button settings-primary" onClick={() => onTabChange("billing")}>Voir la facturation<ChevronRight size={15} aria-hidden="true"/></button><p>Retrouvez les offres et les opérations de votre organisation.</p></div>
    </>}
    {tab === "storage" && signedIn && <>
     <p className="settings-intro">Le stockage est partagé par votre organisation. Le transfert couvre les 30 derniers jours.</p>
     <section className="settings-section" aria-labelledby="settings-storage-title"><h4 id="settings-storage-title">Utilisation</h4><div className="settings-card"><div className="settings-row"><span>Stockage</span>{storageUsage}</div><dl className="settings-details"><div className="settings-row"><dt>Transfert sur 30 jours</dt><dd><Value value={transfer !== undefined && transferLimit !== undefined ? `${bytes(transfer)} sur ${bytes(transferLimit)}` : transfer !== undefined ? bytes(transfer) : undefined} loading={loading}/></dd></div></dl></div></section>
     <div className="settings-billing-footer"><button type="button" className="settings-button" onClick={onFiles}><FolderClosed size={16} aria-hidden="true"/>Ouvrir mes fichiers</button><p>Les limites de stockage et de transfert dépendent du forfait actif.</p></div>
    </>}
    {tab === "permissions" && signedIn && <>
     <BrowserSecuritySettings/>
     <p className="settings-intro">Ces règles s’appliquent à votre compte et aux actions de l’assistant.</p>
     <section className="settings-section" aria-labelledby="settings-rights-title"><h4 id="settings-rights-title">Votre accès</h4><dl className="settings-card settings-details"><div className="settings-row"><dt>Rôle dans l’organisation</dt><dd><Value value={roleLabel(organization?.role)} loading={loading}/></dd></div><div className="settings-row"><dt>Forfait actif</dt><dd><Value value={plan} loading={loading}/></dd></div></dl></section>
     <section className="settings-section" aria-labelledby="settings-approval-title"><h4 id="settings-approval-title">Validation et budgets</h4><div className="settings-card settings-policy-list"><div><h5>Actions dans les applications</h5><p>Les actions qui modifient une application demandent une validation dans Braand avant exécution. Cette validation est aussi requise lorsqu’une action n’est pas reconnue comme une simple consultation.</p></div><div><h5>Outils Instant payants</h5><p>Chaque appel demande une validation. Un tarif vérifié, un plafond compatible, des crédits et un budget disponible sont requis. L’accès dépend aussi du forfait actif et de la configuration de l’espace.</p></div><div><h5>Équipe et paiements</h5><p>Les paiements sont réservés au propriétaire. La gestion de l’équipe et des budgets dépend du rôle et d’un forfait Business actif.</p></div></div></section>
     <div className="settings-inline-actions"><button type="button" className="settings-button" onClick={() => onTabChange("connections")}>Voir les connecteurs<ChevronRight size={14} aria-hidden="true"/></button><button type="button" className="settings-button" onClick={() => onTabChange("team")}>Équipe et budgets<ChevronRight size={14} aria-hidden="true"/></button></div>
    </>}
    {tab === "help" && <>
     <section className="settings-section" aria-labelledby="settings-shortcuts-title"><h4 id="settings-shortcuts-title">Raccourcis clavier</h4><dl className="settings-card settings-details settings-shortcuts"><div className="settings-row"><dt>Rechercher</dt><dd><kbd>Ctrl</kbd><span className="settings-key-alternative">ou</span><kbd>⌘</kbd><kbd>K</kbd></dd></div><div className="settings-row"><dt>Envoyer un message</dt><dd><kbd>Entrée</kbd></dd></div><div className="settings-row"><dt>Ajouter une ligne</dt><dd><kbd>Maj</kbd><kbd>Entrée</kbd></dd></div><div className="settings-row"><dt>Fermer une fenêtre</dt><dd><kbd>Échap</kbd></dd></div></dl></section>
     <section className="settings-section" aria-labelledby="settings-access-title"><h4 id="settings-access-title">Accès utiles</h4><div className="settings-card"><button type="button" className="settings-row settings-row-link" onClick={onFiles}><span><FolderClosed size={17} aria-hidden="true"/>Mes fichiers</span><ChevronRight size={16} aria-hidden="true"/></button><button type="button" className="settings-row settings-row-link" onClick={() => onTabChange("connections")}><span><Plug size={17} aria-hidden="true"/>Mes connecteurs</span><ChevronRight size={16} aria-hidden="true"/></button><button type="button" className="settings-row settings-row-link" onClick={() => onTabChange("billing")}><span><CreditCard size={17} aria-hidden="true"/>Facturation</span><ChevronRight size={16} aria-hidden="true"/></button></div></section>
    </>}
    {tab === "legal" && <>
     <p className="settings-intro">Documents de Braand et adresse de contact.</p>
     <div className="settings-card">{LEGAL_LINKS.map(link=><a key={link.href} className="settings-row settings-row-link settings-external-link" href={link.href} target="_blank" rel="noopener noreferrer"><span>{link.label}<span className="settings-sr-only"> — nouvel onglet</span></span><ArrowUpRight size={16} aria-hidden="true"/></a>)}</div>
     <p className="settings-service-note">Versions provisoires : l’identité complète de l’exploitant et les modalités juridiques restent à compléter.</p>
     <p className="settings-service-note">Contact : <a href="mailto:novacore629@gmail.com">novacore629@gmail.com</a></p>
    </>}
    </>}
   </div>
  </section>
 </div>;
}
