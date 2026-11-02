export const HELP_CATEGORIES = [
  { id: "start", label: "Bien démarrer" },
  { id: "workspace", label: "Discussions et fichiers" },
  { id: "creation", label: "Création et campagnes" },
  { id: "connectors", label: "Connecteurs" },
  { id: "billing", label: "Crédits et facturation" },
  { id: "privacy", label: "Confidentialité" },
  { id: "shortcuts", label: "Raccourcis clavier" },
] as const;

export type HelpCategoryId = (typeof HELP_CATEGORIES)[number]["id"];
export type HelpDestination = "files" | "connectors" | "billing";

export interface HelpQuestion {
  id: string;
  question: string;
  answer: string;
  keywords?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  paragraphs: string[];
  steps?: string[];
  items?: string[];
}

export interface HelpArticle {
  slug: string;
  title: string;
  category: HelpCategoryId;
  summary: string;
  excerpt: string;
  keywords: string[];
  questions: HelpQuestion[];
  sections: HelpSection[];
  related: string[];
  action?: { label: string; href: string };
}

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "bien-demarrer",
    title: "Bien démarrer avec Braand",
    category: "start",
    summary: "Formulez une demande claire et retrouvez les outils essentiels de votre espace.",
    excerpt: "Commencez une discussion, donnez le bon contexte et avancez étape par étape.",
    keywords: ["débuter", "premiers pas", "demande", "prompt", "espace", "projet"],
    questions: [
      { id: "start-chat", question: "Comment commencer une discussion ?", answer: "Ouvrez Chat, décrivez votre objectif et envoyez votre demande. Vous pouvez préciser le public, le résultat attendu et les contraintes importantes.", keywords: ["nouveau chat", "message"] },
      { id: "start-context", question: "Que dois-je préciser dans ma demande ?", answer: "Indiquez ce que vous voulez obtenir, pour qui, dans quel contexte et sous quelles contraintes. Ajoutez un fichier si son contenu est nécessaire à la réponse.", keywords: ["contexte", "brief"] },
      { id: "start-tools", question: "Où retrouver les fonctions de Braand ?", answer: "Utilisez la barre latérale pour ouvrir vos discussions, créations, fichiers, pages, campagnes et paramètres.", keywords: ["navigation", "menu"] },
    ],
    sections: [
      { id: "une-demande-claire", title: "Faire une demande utile", paragraphs: ["Une demande précise aide Braand à proposer un résultat adapté. Vous pouvez commencer simplement, puis demander des ajustements dans la même discussion."], steps: ["Décrivez le résultat recherché.", "Ajoutez le public, l’offre ou le marché concerné.", "Précisez le format, le ton, le budget ou les limites utiles.", "Relisez la proposition et indiquez ce que vous souhaitez modifier."] },
      { id: "ajouter-contexte", title: "Ajouter du contexte", paragraphs: ["Les fichiers importés et les informations partagées dans une discussion peuvent apporter du contexte. Vérifiez que vous pouvez transmettre ces éléments avant de les ajouter."] },
    ],
    related: ["discussions-et-fichiers", "creer-avec-braand", "raccourcis-clavier"],
    action: { label: "Ouvrir une discussion", href: "/?view=chat" },
  },
  {
    slug: "discussions-et-fichiers",
    title: "Gérer les discussions et les fichiers",
    category: "workspace",
    summary: "Retrouvez vos échanges, organisez-les et ajoutez des fichiers utiles à votre travail.",
    excerpt: "Rechercher, renommer, épingler, archiver ou supprimer une discussion et gérer vos fichiers.",
    keywords: ["chat", "conversation", "historique", "archive", "supprimer", "importer", "télécharger", "fichier"],
    questions: [
      { id: "chat-actions", question: "Comment organiser une discussion ?", answer: "Ouvrez le menu de la discussion pour accéder aux actions disponibles, comme la renommer, l’épingler, l’archiver, la partager ou la supprimer.", keywords: ["renommer", "épingler", "archiver", "partager"] },
      { id: "chat-search", question: "Comment retrouver une discussion ?", answer: "Utilisez la recherche de l’espace avec ⌘ K sur Mac ou Ctrl K sur Windows, puis recherchez son titre.", keywords: ["rechercher", "historique"] },
      { id: "workspace-files", question: "Comment ajouter un fichier ?", answer: "Ouvrez Fichiers et choisissez l’action d’import. Vérifiez le nom et le contenu du fichier avant de le partager dans une demande.", keywords: ["joindre", "importer"] },
    ],
    sections: [
      { id: "organiser-discussions", title: "Organiser vos discussions", paragraphs: ["Les actions proposées dans le menu d’une discussion dépendent de son état. L’archivage la retire de la liste active; la suppression est une action définitive et demande confirmation."], items: ["Recherchez un titre avec le raccourci clavier.", "Épinglez les discussions que vous souhaitez garder à portée de main.", "Partagez un lien seulement si son contenu peut être communiqué."] },
      { id: "fichiers-espace", title: "Travailler avec des fichiers", paragraphs: ["La vue Fichiers regroupe les éléments disponibles dans votre espace. Une discussion peut aussi recevoir les pièces jointes prises en charge par le sélecteur de fichiers."], steps: ["Ouvrez Fichiers ou le bouton d’ajout du composeur.", "Choisissez un fichier pris en charge et attendez la fin de l’import.", "Dans votre demande, expliquez ce que Braand doit examiner."] },
    ],
    related: ["bien-demarrer", "confidentialite", "raccourcis-clavier"],
    action: { label: "Ouvrir mes fichiers", href: "/?view=files" },
  },
  {
    slug: "creer-avec-braand",
    title: "Créer avec Braand",
    category: "creation",
    summary: "Préparer des contenus, des pages et des plans de campagne à partir de votre offre.",
    excerpt: "Comprendre les créations disponibles et ce qui doit être vérifié avant publication.",
    keywords: ["image", "vidéo", "page", "campagne", "publicité", "publication", "création"],
    questions: [
      { id: "create-types", question: "Quels contenus puis-je préparer ?", answer: "Braand peut vous aider à préparer des idées de créations, des textes, des pages et des plans de campagne selon les fonctions disponibles dans votre espace.", keywords: ["formats", "visuel"] },
      { id: "campaign-publish", question: "Une campagne est-elle publiée automatiquement ?", answer: "Non. Un plan enregistré dans Braand ne lance pas une campagne publicitaire et n’engage pas de dépense. Vérifiez la destination, le budget et le suivi avant toute action sur une plateforme.", keywords: ["diffusion", "budget", "publicité"] },
      { id: "create-review", question: "Puis-je modifier une proposition ?", answer: "Oui. Relisez la proposition et demandez les ajustements nécessaires dans la discussion avant de l’utiliser ou de la publier.", keywords: ["modifier", "ajuster"] },
    ],
    sections: [
      { id: "preparer-creation", title: "Préparer une création", paragraphs: ["Donnez le produit, le public, le canal et le résultat souhaité. Mentionnez les preuves vérifiables et les contraintes de format pour éviter les affirmations inventées."], steps: ["Choisissez une action comme créer un visuel, une vidéo ou une page.", "Décrivez votre offre et le public visé.", "Précisez le format et le ton.", "Vérifiez le résultat avant toute utilisation externe."] },
      { id: "plans-campagne", title: "Préparer une campagne", paragraphs: ["Les campagnes enregistrées dans Braand servent à préparer et examiner un plan. Les dépenses publicitaires restent distinctes des crédits Braand. Un plan n’est pas une preuve de diffusion ni de résultat."] },
    ],
    related: ["bien-demarrer", "connecteurs-et-autorisations", "credits-et-facturation"],
    action: { label: "Voir mes créations", href: "/?view=creations" },
  },
  {
    slug: "connecteurs-et-autorisations",
    title: "Connecteurs et autorisations",
    category: "connectors",
    summary: "Connecter une application et comprendre les autorisations demandées avant une action.",
    excerpt: "Gérer vos connexions et examiner les accès de lecture, d’écriture ou de suppression.",
    keywords: ["connexion", "application", "intégration", "permission", "autorisation", "accès"],
    questions: [
      { id: "connector-connect", question: "Où gérer mes connecteurs ?", answer: "Ouvrez Paramètres puis Connecteurs pour consulter les applications disponibles et celles déjà connectées.", keywords: ["application", "intégration"] },
      { id: "connector-permission", question: "Que signifie une autorisation ?", answer: "Elle décrit les accès demandés à l’application. Lisez leur portée avant d’autoriser une connexion ou une action.", keywords: ["lecture", "écriture", "suppression"] },
      { id: "connector-action", question: "Une modification externe est-elle automatique ?", answer: "Les actions qui modifient une application peuvent demander une validation. Vérifiez le détail et la destination avant de confirmer.", keywords: ["confirmer", "validation"] },
    ],
    sections: [
      { id: "connecter-app", title: "Connecter une application", paragraphs: ["Une connexion se gère dans Paramètres → Connecteurs. Vous devez suivre le parcours de consentement de l’application et examiner les accès affichés."], steps: ["Ouvrez Paramètres puis Connecteurs.", "Choisissez l’application souhaitée.", "Lisez les autorisations demandées.", "Confirmez uniquement si elles correspondent à votre besoin."] },
      { id: "examiner-action", title: "Vérifier une action", paragraphs: ["Avant une action externe, examinez l’application, l’opération et les données concernées. N’approuvez pas une proposition dont le résultat ou la portée vous paraît incertain."] },
    ],
    related: ["confidentialite", "creer-avec-braand", "bien-demarrer"],
    action: { label: "Ouvrir mes connecteurs", href: "/?settings=connections" },
  },
  {
    slug: "credits-et-facturation",
    title: "Crédits et facturation",
    category: "billing",
    summary: "Consulter vos crédits et comprendre les informations affichées dans Facturation.",
    excerpt: "Voir le solde, la consommation et la disponibilité des paiements.",
    keywords: ["solde", "crédit", "crédits", "paiement", "facture", "forfait", "recharge"],
    questions: [
      { id: "credits-view", question: "Où consulter mes crédits ?", answer: "Ouvrez Facturation pour consulter les crédits disponibles et les mouvements affichés dans votre espace.", keywords: ["solde", "historique"] },
      { id: "credits-reserved", question: "Quand mes crédits sont-ils déduits ?", answer: "Les nouvelles demandes ne bloquent pas de crédits à l’avance. Une ancienne opération peut encore être en cours de régularisation.", keywords: ["réservation", "consommation", "en cours"] },
      { id: "billing-status", question: "Un paiement affiché est-il forcément confirmé ?", answer: "Consultez son statut dans Facturation. Une redirection ou une demande en attente ne constitue pas à elle seule une confirmation de paiement.", keywords: ["transaction", "statut"] },
      { id: "billing-checkout", question: "Comment acheter des crédits ou un forfait ?", answer: "Dans Facturation, choisissez votre recharge ou votre forfait. Le checkout s’ouvre pour confirmer le montant et le moyen de paiement. Vos crédits ou votre forfait deviennent disponibles après confirmation du paiement.", keywords: ["acheter", "recharger", "abonnement"] },
      { id: "billing-receipt", question: "Où retrouver mon reçu et comment renouveler ?", answer: "Les documents de paiement se téléchargent dans Facturation, rubrique Paiements. Le renouvellement est volontaire : choisissez une nouvelle période lorsque vous souhaitez poursuivre. Une conversion éventuelle est affichée dans le checkout avant de payer.", keywords: ["reçu", "conversion", "renouvellement"] },
    ],
    sections: [
      { id: "consulter-solde", title: "Consulter le solde", paragraphs: ["La page Facturation rassemble les informations de forfait, de crédits et d’opérations disponibles pour votre rôle. Les crédits Braand et les dépenses publicitaires sont deux éléments distincts."] },
      { id: "verifier-paiement", title: "Vérifier une opération", paragraphs: ["Le statut affiché dans Facturation fait foi dans l’application. Si une opération reste en attente ou nécessite une vérification, suivez l’action proposée avant de réessayer.", "Les options de paiement ne sont présentées que lorsqu’elles sont effectivement disponibles pour votre espace."] },
    ],
    related: ["creer-avec-braand", "bien-demarrer", "confidentialite"],
    action: { label: "Ouvrir la facturation", href: "/?settings=billing" },
  },
  {
    slug: "confidentialite",
    title: "Confidentialité et contrôle de vos données",
    category: "privacy",
    summary: "Retrouver les informations officielles et vérifier les données avant de les partager.",
    excerpt: "Comprendre les bons réflexes de confidentialité et consulter la politique de Braand.",
    keywords: ["données", "privé", "sécurité", "confidentiel", "politique", "protection"],
    questions: [
      { id: "privacy-policy", question: "Où consulter la politique de confidentialité ?", answer: "Consultez la page Confidentialité de Braand pour les informations officielles sur le traitement des données.", keywords: ["politique", "données personnelles"] },
      { id: "privacy-files", question: "Que vérifier avant de partager un fichier ?", answer: "Vérifiez son contenu, les informations personnelles qu’il contient et votre droit à le transmettre avant de l’ajouter à une discussion.", keywords: ["document", "données personnelles"] },
      { id: "privacy-connectors", question: "Comment limiter l’accès d’un connecteur ?", answer: "N’accordez que les autorisations nécessaires et déconnectez l’application depuis Paramètres lorsque vous ne souhaitez plus l’utiliser.", keywords: ["révoquer", "connecteur"] },
    ],
    sections: [
      { id: "bons-reflexes", title: "Garder le contrôle", paragraphs: ["Évitez de partager des informations dont Braand n’a pas besoin pour répondre. Vérifiez le contenu des fichiers, les autorisations des connecteurs et les destinataires avant toute action."], items: ["Ne partagez pas de mots de passe ou de codes de connexion dans une demande.", "Relisez les autorisations affichées avant de connecter une application.", "Consultez les pages légales pour les engagements officiels."] },
      { id: "documents-officiels", title: "Documents officiels", paragraphs: ["Les réponses de ce centre d’aide résument des usages pratiques. Pour les engagements officiels, consultez la politique de confidentialité et les conditions d’utilisation."] },
    ],
    related: ["connecteurs-et-autorisations", "discussions-et-fichiers", "credits-et-facturation"],
    action: { label: "Lire la politique de confidentialité", href: "/confidentialite" },
  },
  {
    slug: "raccourcis-clavier",
    title: "Raccourcis clavier",
    category: "shortcuts",
    summary: "Retrouver les commandes clavier disponibles dans l’application.",
    excerpt: "Recherche, ouverture de l’aide, envoi d’une demande, nouvelle ligne et fermeture.",
    keywords: ["clavier", "raccourci", "entrée", "escape", "commande", "rechercher"],
    questions: [
      { id: "shortcut-search", question: "Quel raccourci ouvre la recherche ?", answer: "Utilisez ⌘ K sur Mac ou Ctrl K sur Windows pour ouvrir la recherche de votre espace." },
      { id: "shortcut-help", question: "Quel raccourci ouvre cette aide ?", answer: "Utilisez ⌘ / sur Mac ou Ctrl / sur Windows pour ouvrir Aide et raccourcis." },
      { id: "shortcut-compose", question: "Comment envoyer ou continuer sur une nouvelle ligne ?", answer: "Dans le composeur, Entrée envoie la demande et Maj + Entrée ajoute une nouvelle ligne." },
      { id: "shortcut-close", question: "Comment fermer une fenêtre ?", answer: "Appuyez sur Échap pour fermer le dialogue ou le menu actif." },
    ],
    sections: [
      { id: "raccourcis-principaux", title: "Commandes principales", paragraphs: ["Les raccourcis de recherche et d’aide fonctionnent depuis l’application. Dans le composeur, Entrée envoie le texte et Maj + Entrée insère un saut de ligne."], items: ["Rechercher : ⌘ K sur Mac · Ctrl K sur Windows", "Ouvrir Aide et raccourcis : ⌘ / sur Mac · Ctrl / sur Windows", "Envoyer : Entrée", "Ajouter une ligne : Maj + Entrée", "Fermer un dialogue ou un menu : Échap"] },
    ],
    related: ["bien-demarrer", "discussions-et-fichiers"],
  },
] as const satisfies readonly HelpArticle[];

export const HELP_FAQS = HELP_ARTICLES.flatMap((article) =>
  article.questions.map((question) => ({
    ...question,
    articleSlug: article.slug,
    articleTitle: article.title,
    category: article.category,
  })),
);

export function helpCategoryLabel(id: HelpCategoryId): string {
  return HELP_CATEGORIES.find((category) => category.id === id)?.label ?? "Aide";
}

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

export function searchHelpArticles(query: string, category: HelpCategoryId | "all" = "all"): readonly HelpArticle[] {
  const terms = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  return HELP_ARTICLES.filter((article) => {
    if (category !== "all" && article.category !== category) return false;
    const searchable = normalizeSearchText([
      article.title,
      article.summary,
      article.excerpt,
      ...article.keywords,
      ...article.questions.flatMap((question) => [question.question, question.answer, ...(question.keywords ?? [])]),
      ...article.sections.flatMap((section) => [section.title, ...section.paragraphs, ...(section.steps ?? []), ...(section.items ?? [])]),
    ].join(" "));
    return terms.every((term) => searchable.includes(term));
  });
}
