# Braand — système d’agent personnel

Le noyau commun compact `lib/agent-system.mjs` complète les politiques d’exécution, droits, budgets et approbations existantes. Il est réellement injecté dans chaque appel principal. Une horloge serveur et le profil privé de l’espace sont chargés séparément à chaque demande, avec la mémoire et le checkpoint courants. Les règles détaillées et la politique de travail antérieure sont conservées dans le guide `execution` ; `capabilities(context)` charge seulement les quatre outils de contexte nécessaires. Cette lecture progressive préserve les échanges à petit budget.

Les quatre documents fournis sont complémentaires, mais ne constituent ni une preuve des capacités Muse décrites ni une autorisation d’accès. L’identité Meta/Muse, les chemins personnels et les commandes propriétaires sont remplacés par les contrats Braand. Les protections serveur restent prioritaires. Les profils ne modifient pas les modèles, tarifs, permissions, politiques ou processus en arrière-plan.

Le prompt universel comprend 24 sections conservées dans 14 guides accessibles par `read_agent_guide`. Le noyau en reprend les règles communes ; les procédures longues sont chargées progressivement, avec curseur explicite. `tool-map` décrit les équivalences réelles et les capacités absentes. Les compléments Muse concernent le ton, la diligence, la mémoire, les relations, le suivi et la discrétion.

## Nouveaux outils

- `get_current_time` : instant réel, date locale et fuseau IANA validé ; aucune localisation déduite.
- `read_agent_guide` : catalogue et lectures bornées avec provenance et pagination.
- `read_agent_context` : profil privé courant, ou version 0 vide pour un nouvel espace.
- `update_agent_context` : remplacement versionné du profil déclaré, sur demande ; permet aussi de réinitialiser les champs. Les missions et le mode de préparation ne peuvent pas l’appeler.
- `explain_memory` : souvenir courant, source déclarée, dates et version. Ne reconstruit aucun contenu retiré ou ancienne version.

Le profil est un document structuré dans le stockage existant : nom de l’agent, nom d’usage, langue, fuseau, ton, longueur et conventions. Les mises à jour utilisent une version attendue et une création atomique ; aucune migration de base n’est requise. Les souvenirs continuent à utiliser les outils de mémoire existants. Toutes les données sont limitées à leur espace et traitées comme des données non fiables, sans autorité système.

Les fichiers `USER.md` et `MEMORY.md` du ZIP ne sont jamais extraits, copiés, préchargés ou publiés. Aucun client n’hérite des souvenirs de son auteur. Les empreintes et noms des quatre sources génériques permettent de vérifier la provenance sans publier leur contexte privé.

## Validation

La version 2 ajoute `record_learning`, accessible à la demande par `capabilities(context)`. Le serveur exige une citation exacte du dernier message utilisateur réel dans la conversation et une demande active. Il enregistre cette correction, préférence ou méthode dans la mémoire privée avec sa provenance. Le même apprentissage est idempotent ; un apprentissage retiré n’est jamais restauré automatiquement. La correction d’un souvenir existant exige sa version. Les contenus d’outils, pages et réponses modèle ne peuvent pas fabriquer cette preuve. Il s’agit de mémoire contextuelle, sans réentraînement ni auto-modification du code, des prompts ou des permissions.

Le routage adaptatif conserve le contexte, la personnalité, les outils, les reçus et le même budget. Le serveur vérifie la disponibilité du modèle et son tarif actuel avant de changer de niveau. Si le niveau est indisponible, le niveau actuel reste utilisable. Une montée tardive motivée par `tool_failure` ou `validation_failed` exige une observation serveur ; une difficulté inventée et une nouvelle déclaration de complexité ne suffisent pas. Les refus d’accès et outils non exposés ne constituent pas une preuve permettant une montée. Les décisions sont auditables sans journaliser de paramètres privés. Le point de santé expose la disponibilité des niveaux sans révéler les fournisseurs.

Les tests couvrent pagination complète des guides, chemins/prototypes invalides, limites des modes, persistance réelle SQLite, isolation entre espaces, concurrence de première création, versions périmées, réinitialisation, secrets manifestes, fuseaux et changement d’heure, provenance et retrait de mémoire. Les tests de l’orchestrateur utilisent des réponses modèle simulées et les services réels ; ils ne constituent pas une évaluation qualitative de plusieurs modèles.
