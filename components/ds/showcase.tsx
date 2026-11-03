"use client";
import {useState} from "react";
import {ArrowUpRight, FolderOpen, Plus, Sparkles} from "lucide-react";
import {Avatar, Badge, Button, Card, Checkbox, Drawer, EmptyState, Input, Modal, Select, Skeleton, Spinner, Switch, Tabs, Textarea, ToastProvider, Tooltip, useToast} from "./index";
import "./showcase.css";

function Section({title, children}: {title: string; children: React.ReactNode}) {
 return <section className="dss-section"><h2>{title}</h2><div className="dss-row">{children}</div></section>;
}
function Demo() {
 const toast = useToast();
 const [tab, setTab] = useState("apercu"), [modal, setModal] = useState(false), [drawer, setDrawer] = useState(false), [loading, setLoading] = useState(false), [email, setEmail] = useState("");
 return <main className="dss" id="contenu">
  <header className="dss-hero ds-stagger"><Badge tone="accent">Braand · v2</Badge><h1>Design system</h1><p>Une seule source de vérité : tokens, composants et mouvements.</p></header>
  <Section title="Boutons"><Button variant="primary" icon={<Plus size={16} aria-hidden="true"/>}>Créer</Button><Button>Secondaire</Button><Button variant="ghost">Discret</Button><Button variant="danger">Supprimer</Button><Button variant="primary" loading={loading} onClick={() => {setLoading(true); setTimeout(() => setLoading(false), 1500);}}>Enregistrer</Button><Button disabled>Désactivé</Button><Button variant="primary" size="lg" icon={<Sparkles size={18} aria-hidden="true"/>}>Lancer</Button><Button size="sm">Petit</Button><Tooltip content="Ajouter"><Button iconOnly icon={<Plus size={18} aria-hidden="true"/>}>Ajouter</Button></Tooltip></Section>
  <Section title="Champs"><div className="dss-grid"><Input label="Adresse e-mail" type="email" placeholder="vous@exemple.com" hint="Nous ne la partageons jamais." value={email} onChange={event => setEmail(event.target.value)} error={email && !email.includes("@") ? "Ajoutez un @ pour une adresse valide." : undefined}/><Select label="Objectif" defaultValue="ventes"><option value="ventes">Plus de ventes</option><option value="prospects">Plus de prospects</option></Select><Input label="Désactivé" disabled placeholder="Indisponible"/><Textarea label="Votre idée" placeholder="Décrivez votre produit en une phrase…"/></div></Section>
  <Section title="Choix"><Checkbox label="Recevoir le récapitulatif" defaultChecked/><Checkbox label="Option désactivée" disabled/><Switch label="Publication automatique"/><Switch label="Mode sombre" defaultChecked/></Section>
  <Section title="Onglets"><div className="dss-stack"><Tabs label="Démonstration" value={tab} onChange={setTab} items={[{id: "apercu", label: "Aperçu"}, {id: "fichiers", label: "Fichiers"}, {id: "historique", label: "Historique"}]}/><div className="ds-tabpanel" key={tab} role="tabpanel">Onglet actif : {tab}</div></div></Section>
  <Section title="Cartes et badges"><div className="dss-cards ds-stagger">{["Campagne de Noël", "Lancement produit", "Newsletter"].map((title, index) => <Card key={title} interactive><div className="dss-card-head"><Avatar name={title}/><Badge tone={index === 0 ? "success" : index === 1 ? "warning" : "neutral"}>{index === 0 ? "Active" : index === 1 ? "À valider" : "Brouillon"}</Badge></div><h3>{title}</h3><p>3 créations · mis à jour aujourd’hui</p></Card>)}</div></Section>
  <Section title="Chargement"><div className="dss-stack"><Skeleton variant="title"/><Skeleton/><Skeleton width="70%"/><div className="dss-row"><Skeleton variant="circle" width={40} height={40}/><Spinner/><Spinner size="lg"/></div></div></Section>
  <Section title="État vide"><Card><EmptyState icon={<FolderOpen/>} title="Aucun fichier pour l’instant" description="Ajoutez une photo de produit pour commencer." actions={<><Button variant="primary" icon={<Plus size={16} aria-hidden="true"/>}>Importer</Button><Button variant="ghost" icon={<ArrowUpRight size={16} aria-hidden="true"/>}>Demander à Braand</Button></>}/></Card></Section>
  <Section title="Fenêtres et notifications"><Button onClick={() => setModal(true)}>Ouvrir une fenêtre</Button><Button onClick={() => setDrawer(true)}>Ouvrir un panneau</Button><Button onClick={() => toast("Brouillon enregistré.", "success")}>Notification</Button><Button onClick={() => toast("La connexion a échoué. Réessayez.", "danger")}>Erreur</Button></Section>
  <Modal open={modal} onClose={() => setModal(false)} title="Publier cette campagne ?" footer={<><Button variant="ghost" onClick={() => setModal(false)}>Annuler</Button><Button variant="primary" onClick={() => {setModal(false); toast("Campagne prête à publier.", "success");}}>Publier</Button></>}>Elle sera visible par votre audience dès validation.</Modal>
  <Drawer open={drawer} onClose={() => setDrawer(false)} title="Détails">Les vues détaillées s’ouvrent ici, à côté de la conversation.</Drawer>
 </main>;
}
export function DesignSystemShowcase() {return <ToastProvider><Demo/></ToastProvider>;}
