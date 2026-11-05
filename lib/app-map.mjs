// Braand's own interface, described for the agent: where each screen is, what
// it shows and which real buttons it has. One source for the agent's guide,
// its navigation targets and the client. tests/app-map.test.mjs fails when a
// screen or a settings tab exists in the app without being described here.
import {PLANS} from './billing-core.mjs';

/** Screens reachable with ?view=… */
export const APP_VIEWS = Object.freeze({
  chat: {label: 'Discussion', where: 'Barre latérale → Chat', shows: 'La conversation avec Braand, le compositeur (texte, « + » pour joindre un fichier, bouton écran pour montrer son écran), les cartes de résultats (fichiers, sites, propositions, missions) et la carte « Navigateur » d’une session : mission, statut, étape en cours, dernière image de la page et bouton « Ouvrir le navigateur ». Le panneau Navigateur à droite montre la page en direct, ses onglets (par titre), et les boutons Arrêter, Mettre en pause, Prendre le contrôle (quand la page attend une intervention) et Rendre le contrôle.'},
  library: {label: 'Bibliothèque', where: 'Barre latérale → Bibliothèque (onglet Tout)', shows: 'Tout ce qui a été créé ou importé, rangé par date, avec recherche, tri, vue grille ou liste et épingles. Boutons Importer et Créer.'},
  creations: {label: 'Visuels', where: 'Bibliothèque → onglet Visuels', shows: 'Images, vidéos et affiches créées avec Braand.'},
  documents: {label: 'Documents', where: 'Bibliothèque → onglet Documents', shows: 'Rapports, devis, présentations et livrables préparés par Braand.'},
  files: {label: 'Fichiers', where: 'Bibliothèque → onglet Fichiers', shows: 'Fichiers importés par l’utilisateur (aperçu en cliquant).'},
  pages: {label: 'Pages', where: 'Bibliothèque → onglet Pages', shows: 'Pages et sites web préparés par Braand.'},
  publications: {label: 'Publications', where: 'Bibliothèque → onglet Publications', shows: 'Calendrier et lots de publications pour les réseaux sociaux.'},
  missions: {label: 'Missions', where: 'Barre latérale → Activité → Missions', shows: 'Les tâches que Braand mène en arrière-plan, leurs étapes, livrables et décisions à prendre.'},
  campaigns: {label: 'Campagnes', where: 'Activité → Campagnes', shows: 'Plans de campagnes publicitaires Facebook et Instagram.'},
  analytics: {label: 'Tableau de bord', where: 'Activité → Performances', shows: 'Résultats des publications et campagnes quand Meta est connecté.'},
  suggestions: {label: 'Suggestions', where: 'Barre latérale → Suggestions (quand l’onglet est ouvert)', shows: 'Idées et bugs de tous les membres : voter, proposer (Nouvelle suggestion), répondre, suivre le statut avec la cloche.'},
  projects: {label: 'Projets', where: 'Barre latérale → Projets → Tous les projets', shows: 'Les projets de l’espace ; un projet regroupe ses discussions et ressources.'},
  knowledge: {label: 'Compétences', where: 'Paramètres → Compétences', shows: 'Méthodes de travail de Braand et celles que l’utilisateur lui a apprises.'},
  billing: {label: 'Forfait et crédits', where: 'Paramètres → Facturation', shows: 'Forfaits, recharges de crédits et paiements.'},
});

/** Settings tabs (Paramètres, from the account menu at the bottom left). */
export const SETTINGS_TABS = Object.freeze({
  general: {label: 'Général', shows: 'Profil, apparence (clair, sombre, système), mémoire et préférences, déconnexion.'},
  connections: {label: 'Connecteurs', shows: 'Connecter Google, Meta, LinkedIn et d’autres services ; état de chaque connexion.'},
  skills: {label: 'Compétences', shows: 'Méthodes disponibles, import d’une compétence, méthodes apprises par l’utilisateur.'},
  credits: {label: 'Portefeuille', shows: 'Solde de crédits disponible et réservé, historique.'},
  billing: {label: 'Facturation', shows: 'Onglets Forfait (cartes Essentiel, Pro, Business, Entreprise), Recharger, Paiements.'},
  team: {label: 'Équipe et budgets', shows: 'Membres, invitations, rôles et budgets (forfaits Business et Entreprise).'},
  storage: {label: 'Stockage', shows: 'Espace utilisé par les fichiers et limite du forfait.'},
  permissions: {label: 'Autorisations', shows: 'Ce que Braand peut faire seul, identifiants enregistrés de façon sécurisée, navigateur.'},
  help: {label: 'Aide et raccourcis', shows: 'Centre d’aide et raccourcis clavier.'},
  legal: {label: 'Informations légales', shows: 'Conditions, confidentialité, contact.'},
});

/** Everything navigate_ui may open. Pure navigation: never changes data. */
export const NAV_TARGETS = Object.freeze([
  ...Object.keys(APP_VIEWS).map(id => `view:${id}`),
  'view:routines',
  ...Object.keys(SETTINGS_TABS).map(id => `settings:${id}`),
  'resource', 'suggestion', 'new_chat', 'search', 'admin',
]);
export const ADMIN_TARGETS = Object.freeze(['admin']);

export function targetLabel(target) {
  if (target.startsWith('view:')) return target === 'view:routines' ? 'Automatisations' : APP_VIEWS[target.slice(5)]?.label || 'Braand';
  if (target.startsWith('settings:')) return 'Paramètres → ' + (SETTINGS_TABS[target.slice(9)]?.label || '');
  return {resource: 'l’élément demandé', suggestion: 'la suggestion', new_chat: 'une nouvelle discussion', search: 'la recherche', admin: 'l’administration'}[target] || 'Braand';
}

const number = value => new Intl.NumberFormat('fr-FR').format(value);
/** The interface guide the agent reads (read_agent_guide topic « interface »). */
export function appMapGuide() {
  const plans = Object.values(PLANS).map(p => `- ${p.name} : ${number(p.periodPrice)} FCFA / 30 jours, ${number(p.credits)} crédits, ${p.members === 1 ? '1 personne' : p.members + ' membres'}, ${p.sites} sites en ligne`).join('\n');
  return [
    'Interface de Braand : où se trouve chaque chose',
    '',
    'Disposition : barre latérale à gauche (Chat, Bibliothèque, Activité, Suggestions quand l’onglet est ouvert, puis Projets et Discussions récentes) ; menu du compte en bas à gauche (Paramètres, Aide, Administration pour les admins) ; panneau à droite pour l’aperçu d’un fichier, d’une page ou du navigateur. Sur mobile, la barre latérale s’ouvre avec le bouton menu en haut à gauche.',
    'Raccourcis : Ctrl+K (ou Cmd+K) pour rechercher dans l’espace ; Entrée pour envoyer ; Maj+Entrée pour aller à la ligne.',
    '',
    'Écrans :',
    ...Object.entries(APP_VIEWS).map(([id, v]) => `- ${v.label} (navigate_ui « view:${id} ») : ${v.where}. ${v.shows}`),
    '- Automatisations (navigate_ui « view:routines ») : Activité → Automatisations. Tâches qui reviennent selon un calendrier approuvé.',
    '',
    'Paramètres (menu du compte → Paramètres) :',
    ...Object.entries(SETTINGS_TABS).map(([id, t]) => `- ${t.label} (navigate_ui « settings:${id} ») : ${t.shows}`),
    '',
    'Forfaits actuels :',
    plans,
    '',
    'Autres cibles : « resource » avec resourceId (ouvre un fichier, une page, un site ou un document dans le panneau), « suggestion » avec resourceId (ouvre une suggestion), « new_chat », « search », « admin » (administrateurs seulement).',
    '',
    'Règles : décris uniquement les écrans et boutons listés ici ; si quelque chose n’y figure pas, dis que tu ne le vois pas plutôt que de l’inventer. Quand l’utilisateur demande où se trouve quelque chose ou dit « montre-moi », ouvre directement avec navigate_ui ; sinon propose avec open_view. Pour comprendre un problème d’affichage, demande une capture avec request_screen_capture.',
  ].join('\n');
}
