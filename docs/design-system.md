# Design system Braand

## Identité Relais — 30 octobre 2026

Relais est l’identité officielle de Braand : un signe composé de deux formes et un mot-symbole en tracés vectoriels. `brand/relais.geometry.json` en conserve la géométrie ; `scripts/build-brand-assets.mjs` génère les SVG et `lib/brand.mjs`. Les composants `BrandLogo` et `BrandMark` de `components/brand.tsx` sont utilisés dans l’application, la connexion et les pages publiques. La mascotte animée du chat reste un compagnon distinct.

La charte complète est dans `docs/brand/charte-graphique.md`, avec une édition PDF/HTML de 24 pages sous `public/brand`. Le kit `braand-relais-kit-v1.zip` contient les variantes SVG/PNG, les icônes, Manrope et sa licence, les tokens, les sources des primitives React et les empreintes SHA-256. Les scripts `build-brand-kit.mjs` et `package-brand-kit.mjs` régénèrent ces livrables sans appel fournisseur.

Manrope est auto-hébergée dans `public/fonts/Manrope.ttf` sous SIL Open Font License 1.1. Le bleu de marque est `#4B93FF` ; les couleurs d’action suivent les tokens accessibles du thème. L’attribut technique `data-design-system="muse"` est conservé pour la compatibilité des sélecteurs existants ; il ne désigne pas la marque affichée.

## Essentielle et Atelier — navigation retenue

La sidebar de 248 px présente Chat, Bibliothèque, Missions et Automatisations. Les projets réels et l’historique des discussions sont séparés. La recherche, les discussions épinglées, les archives et leurs menus gardent leurs comportements existants. Plus d’outils donne accès à Studio, Campagnes, Tableau de bord et Publications ; Connecteurs reste dans Paramètres. Le rail réduit reste à 72 px.

Les deux en-têtes partagent une hauteur commune : 72 px, puis 64 px sous 768 px. La sidebar n’ajoute pas de padding supérieur et réserve 8 px avant Chat. Entre 768 et 1023 px, le rail apparaît par défaut et peut être déployé pour la session, sans écraser la préférence desktop. Les cibles des petites actions atteignent 44 × 44 px sur mobile, tablette et pointeur tactile ; les SVG conservent leur taille sans réduction par le padding. Sans projet, une action nommée remplace l’en-tête vide. Le bouton anonyme annonce et ouvre un dialogue de connexion, sans chevrons de menu.

Les sept raccourcis précédents sont regroupés : trois intentions générales et un menu « Autres idées » donnant accès aux quatre demandes de création existantes. La grille dépend de sa largeur de conteneur, avec quatre ou deux colonnes. Les actions préparent un brouillon sans lancer une génération. L’accueil conserve son défilement pour les contenus longs, mais une demande courte ne repousse plus le pied de page dans le cas vérifié 774 × 668 px.

Bibliothèque rassemble les fichiers, médias, demandes de création, livrables et pages dans Galerie. Recherche, filtres par contenu, tri, épingles et vue liste sont regroupés au-dessus des ressources. Les aperçus utilisent les images enregistrées, les miniatures autorisées des fichiers PNG/JPEG/WebP et les extraits des documents ; aucun visuel de résultat n’est inventé. Les miniatures signées sont demandées près du viewport. Une URL d’image doit être HTTP(S) ; une image manquante ou défaillante utilise une icône Lucide. Les épingles restent sur l’appareil dans une clé par utilisateur et espace ; la sélection est réinitialisée au changement de périmètre. La grille passe de trois à deux colonnes selon la largeur du contenu, la liste reste disponible sur mobile. Les fichiers non prêts ne peuvent pas s’ouvrir. Les lecteurs de fichiers et l’Atelier conservent les protections existantes. Les anciennes URLs Créations, Pages et Fichiers restent valides. Automatisations ouvre la section Routines du tableau de missions existant ; la section est reflétée dans l’URL et dans l’état de la navigation.

Campagnes utilise Pilotage pour les plans : une prochaine action réelle, trois filtres compacts et une liste de lignes ouvrables au clavier. Chaque ligne affiche le titre, l’objectif, le marché, les éléments renseignés, les associations réelles et la date. La projection globale de budget est repliée par défaut. Parcours s’ouvre pour un plan : quatre étapes de préparation, le brief et son message, puis les créations et la destination associées. Brief et Créations indiquent uniquement la présence des informations ; Destination reste à vérifier et Validation exige un accord. Le bouton Continuer avec Braand prépare une demande dans le chat. Le formulaire versionné, l’export Markdown, les projections par devise sur 7/14/30 jours et les neuf contrôles restent disponibles ; les contrôles détaillés et autres actions se déplient à la demande. Les conflits conservent la saisie, et le rôle lecteur interdit l’enregistrement. Le retour à la liste restitue le focus au plan ouvert. Aucun lancement ni débit automatique n’est introduit.

Atelier utilise un sélecteur de contenu unique à la place des onglets permanents. Il conserve l’aperçu, les fichiers et le navigateur existants ; le code d’une page est le HTML réellement chargé, affiché comme texte. Un changement de page ignore les réponses périmées, et un livrable reçu en streaming ne remplace pas un contexte de navigateur choisi manuellement. Agrandissement, fermeture, retour du focus, clavier et vue mobile sont conservés.

Le navigateur affiche son état serveur réel. Son intégration Atelier ne crée ni session, ni permission, ni approbation automatiquement. Ses plafonds, confirmations, contrôles humains, saisies privées et rapprochements de coûts restent appliqués par le runtime existant. Browserbase est une intégration future, indépendante de cette évolution visuelle. Les lecteurs de fichiers spécialisés restent disponibles.

Les contrôles navigateur couvrent les routes, la recherche et le repli, la bibliothèque, les routines, le sélecteur du panneau, les réponses de pages concurrentes, l’affichage du code, la continuité pendant le streaming, le clavier et le mobile. Ils utilisent des fournisseurs simulés, sans dépense ni publication réelle.

## Origine des mesures d’interface

L’intégration utilise les mesures authentifiées de la v3 du kit Muse fourni par le client : `muse.tokens.css`, `components.authenticated.css`, `INTERFACE-PRIVEE.md` et leurs observations. Les proportions v2 relevées dans des captures ne sont pas utilisées comme dimensions CSS.

## Organisation

- `app/design-tokens.css` centralise couleurs, géométrie, typographie et mouvement. Les alias `--bg`, `--surface`, `--braand-sidebar-*` assurent la compatibilité des composants existants.
- `app/design-system.css`, importé par Studio, adapte les composants sous `html[data-design-system="muse"]` : navigation, chat, compositeur, paramètres, recherche, bibliothèque, compétences, connecteurs, panneau droit et barre de l’aperçu de fichier.
- Les modules CSS de facturation utilisent les mêmes tokens, sans changer tarifs, montants, droits ni calculs.
- Le layout de production, l’adaptateur local et les fixtures navigateur activent le même attribut racine.

## Adaptations assumées

Manrope reste la police de Braand : aucun logo ou fichier de police propriétaire d’un concurrent n’est importé. L’identité Relais et sa géométrie sont propres au projet. Aucune dépendance d’exécution nouvelle.

Le kit décrit plusieurs colonnes propres à Muse. Braand conserve sa navigation et son panneau existants : sidebar 248 px déployée, rail 72 px replié, panneau redimensionnable. Le sélecteur de mode et les envois de fichiers restent présents dans le compositeur compact ; sur mobile, les actions passent sous le texte.

Les petits textes secondaires sont plus clairs que les alpha tertiaires de la référence pour conserver un contraste lisible. Le fond des menus est plus opaque pour qu’un texte derrière ne gêne pas leur lecture. La teinte bleue des messages utilisateur, les surfaces translucides et le focus bleu reprennent la v3.

La bibliothèque de compétences adopte le même thème sombre. Les contenus Office/PDF ne sont pas recolorés ; seule l’interface du lecteur reprend le thème.

Le responsive est une adaptation à Braand, pas une validation du comportement mobile de Muse. Les fonctions non présentes dans Braand, telles que ses discussions parallèles, ne sont pas ajoutées comme faux contrôles.

## Paramètres et connecteurs

`components/settings-panel.tsx` compose la fenêtre native (880 × 680 px au maximum) : navigation de 224 px sur ordinateur, navigation horizontale sur mobile, corps indépendant défilant. Dix rubriques utilisent les parcours existants : Général, Connecteurs, Compétences, Portefeuille, Facturation, Équipe et budgets, Stockage, Autorisations, Aide et raccourcis, Informations légales. La navigation défile indépendamment et garde la déconnexion accessible. À l’ouverture, le focus rejoint l’onglet actif, y compris un lien direct sur mobile. Les résumés financiers sont invalidés si l’utilisateur, l’espace, les crédits ou les réservations changent. Un changement d’espace dans un autre onglet recharge l’application pour garder les requêtes et l’écran sur le même périmètre.

La barre principale n’affiche plus les raccourcis Intégrations et Compétences. Les compétences conservent recherche, filtres, import et ajout d’une méthode au brouillon depuis leur onglet. La facturation utilise `BillingPanel embedded` : trois sous-rubriques compactes Forfait / Recharger / Paiements, sans grand titre commercial ni cadran décoratif. Tarifs, devis, confirmation de règlement, factures et demandes de remboursement réutilisent les contrôles existants. Équipe et budgets réutilise les membres, espaces et plafonds autorisés ; Stockage présente les mesures réelles ; Autorisations explique le rôle et les protections effectivement appliquées, en lecture seule.

Les liens `/?settings=billing`, `/?settings=team` et les autres identifiants d’onglet ouvrent les paramètres au-dessus de la conversation. Les anciennes entrées `?view=billing`, `/pricing`, `?view=knowledge` et les retours `billingOrder` restent compatibles. Fermer nettoie ces paramètres sans remplacer la conversation, son brouillon ou le panneau droit. La vérification d’un paiement de retour conserve son parcours serveur existant ; aucun nouveau paiement n’est lancé par l’ouverture des paramètres.

`app/connectors-panel.tsx` affiche le catalogue réel, une sélection « À découvrir », la recherche et les vues Disponible / Connecté. `GET /api/connectors/toolkits?connected=true&search=…&cursor=…` transmet le filtre natif au SDK avant pagination ; aucune liste d’applications n’est codée en dur. Sans configuration Composio, le panneau affiche son indisponibilité. Les invités sont orientés vers la connexion Braand sans appeler les routes privées.

La fiche d’application explique l’accès avant de préparer un lien OAuth. Ouvrir une fiche n’autorise rien ; « Connecter » prépare un lien Composio validé, puis l’utilisateur ouvre lui-même « Autoriser ». « Actualiser après la connexion » ferme la fiche et recherche l’application dans un catalogue rechargé, y compris si elle provenait d’une page suivante. La déconnexion exige une confirmation distincte. Les contrôles serveur des actions et dépenses ne changent pas. Les logos et descriptions apparaissent uniquement quand le catalogue les fournit ; aucun statut ou abonnement de la référence Muse n’est simulé en production.

Les réglages non disponibles dans Braand ne sont pas ajoutés sous forme de contrôles factices. L’apparence existante propose les thèmes sombre, clair et système ainsi que les accents configurables. Les écrans de facturation conservent leurs véritables tarifs.

## Vérification

```sh
npm run typecheck
npm run lint
npm run build
npm test
node tests/agent-ui.browser.mjs
```

La suite navigateur utilise une identité, des réponses et des catalogues de test sur loopback, bloque le réseau externe et ne fait aucun achat ni appel modèle réel. Elle vérifie notamment : tokens calculés, rail 72 px, compositeur qui grandit uniquement en hauteur jusqu’à 192 px, défilement interne, paramètres desktop/mobile, compétences, facturation, états de streaming, copie, avis, sources et reprise de demande.

Les tests des connecteurs vérifient aussi l’autorisation explicite, la recherche et la pagination des comptes connectés, la confirmation de révocation, la fermeture indépendante des deux dialogues et le retour du focus. Les tests d’intégration vérifient les filtres invalides et l’isolation entre utilisateurs et espaces avec le SDK simulé ; ils ne prouvent pas une connexion OAuth à un compte réel.

Les captures se trouvent dans `.tmp/agent-ui-browser/design-*.png`, ignoré par Git. Si Playwright vient d’un runtime externe, définir `BRAAND_PLAYWRIGHT_MODULE` vers son module avant la commande.

La prévisualisation complète utilise `PORT=4200 node scripts/dev-local.mjs` (PowerShell : `$env:PORT='4200'` puis `node scripts/dev-local.mjs`). Elle reste sur `127.0.0.1`, utilise l’authentification locale de développement et ne publie rien en production.

Les compétences intégrées sont chargées comme métadonnées authentifiées dans les paramètres. Le catalogue de 166 entrées conserve une seule entrée par identifiant ; les variantes et ressources sont consultées progressivement par le serveur. Les cinq documents de contexte personnel importés restent séparés dans le seul espace propriétaire. Voir `docs/skill-packs.md`.
