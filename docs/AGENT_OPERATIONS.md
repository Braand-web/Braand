# Outils opérationnels et mémoire — 10 novembre 2026

Cette extension réutilise les ressources, discussions, permissions, reçus d’outils, budgets, tâches persistantes et composants de Braand. Elle ne crée pas un autre orchestrateur.

## Capacités livrées

- `list_agent_operations` : retrouve les profils personnels, workflows et résultats du projet actif.
- `save_agent_profile` : conserve un rôle, objectif, règles, exclusions et références. Huit profils au maximum par personne et projet. Un profil n’accorde aucun droit.
- `delegate_specialist` accepte `profileId` et `profileVersion`, vérifie la version, le rôle et les références avant la délégation existante.
- `handoff_task` prépare un travail durable versionné, avec budget et profil précis. Le résultat est **un brouillon**, lancé depuis la carte de travail existante. Les sous-agents ne créent pas d’autres sous-agents.
- `get_action_inbox` retrouve les décisions et blocages du projet. Il ne les approuve pas. Les cartes d’origine conservent leurs contrôles serveur.
- `get_agent_playbook` charge une méthode parmi : alignement, coordination, recherche, opérations clients, programmation, création, organisation quotidienne et amélioration. Les méthodes ne sont ni des outils ni des autorisations.
- `propose_workflow`, `test_workflow`, `execute_workflow` gèrent des traitements déterministes de tableaux. Six opérations fermées : sélection, filtre, tri, renommage, agrégation, remplacement de texte littéral. Aucun script, réseau, publication ou appel de modèle.
- `subscribe_event` prépare un webhook inactif, lié à la version exacte d’un workflow déjà actif. Activation explicite, échéance de 30 jours maximum, plafond de 500 événements maximum.

## Cycle des workflows

1. Une proposition stocke les étapes et un cas de test avec résultat attendu.
2. Le test compare exactement le résultat obtenu. Une réussite sur cet exemple ne prouve pas tous les cas métier.
3. L’utilisateur active depuis la carte la version testée et son empreinte SHA-256.
4. L’exécution conserve les données calculées dans un nouveau `workflow_run`. La source n’est pas modifiée.
5. Toute modification du workflow ou de son skill source invalide le droit d’exécuter cette ancienne version.

Limites : 12 étapes, 500 lignes, 40 colonnes par ligne, 2 000 caractères par cellule, 200 000 caractères de données, 120 000 caractères par définition. Les agrégations réutilisent le moteur décimal existant (six décimales, grands entiers exacts sous forme de texte, colonnes de calcul limitées à 1 000 caractères). Les données absentes ne sont jamais converties silencieusement en zéro. Les secrets reconnaissables sont refusés avant l’enregistrement des entrées réelles.

Le même `requestId` avec les mêmes entrées retrouve le résultat. Un autre contenu avec cet identifiant est refusé. Un état en cours, échoué ou incertain n’est pas rejoué automatiquement. Les aperçus ne transportent que cinq lignes ; le CSV autorisé permet de récupérer le résultat complet et neutralise les formules injectées.

## API et composants

`GET /api/agent-operations?conversationId=…` liste les éléments personnels du projet de cette discussion. Ajouter `id=…&format=csv` exporte un résultat terminé après nouvelle vérification des droits.

`POST /api/agent-operations` reçoit `conversationId`, `kind`, `id`, `version`, `action`. Pour un workflow, `digest` et `confirmed` sont requis. Actions : `test`, `activate`, `disable`. Pour une souscription : `activate`, `disable`, `signing_key`. Le serveur vérifie à nouveau l’identité, le rôle, le propriétaire, le projet et la version.

`AgentOperationCard` affiche les états confirmés, le test, l’activation, la désactivation, les détails et la modification ciblée. Une erreur conserve l’ancien état. Les nouveaux éléments s’affichent dans la conversation sans nouvel onglet de navigation. Les clés de signature passent uniquement par le presse-papiers, jamais par les messages ou le DOM.

Pour ajouter une opération, étendre le schéma fermé et l’interpréteur de `lib/workflow-contract.ts`, puis ajouter une vérification avec entrées, sortie exacte et entrée invalide. Ne jamais transformer une instruction du modèle en `eval`, commande système ou URL arbitraire.

## Événements signés

`POST /api/webhooks/agent-events/{subscriptionId}` n’accepte que `{ "rows": […] }`. Un événement ne choisit ni compte, ni projet, ni outil, ni instruction. L’identité et le workflow sont ceux de la souscription approuvée et restent revérifiés à chaque réception, y compris après suspension du compte.

En-têtes :

- `x-braand-event-id` : identifiant stable, 8 à 100 caractères autorisés (`A-Za-z0-9_.:-`).
- `x-braand-timestamp` : heure Unix en millisecondes, tolérance de cinq minutes.
- `x-braand-signature` : `sha256=` suivi de la signature hexadécimale.

Exemple émetteur Node.js, avec une clé issue du gestionnaire de secrets de l’émetteur :

```js
import {createHmac} from 'node:crypto';
const body = JSON.stringify({rows: [{category: 'Services', amount: 12}]});
const timestamp = String(Date.now());
const eventId = 'import-2026-11-10-001'; // réutiliser pour une nouvelle livraison du même événement
const signature = createHmac('sha256', process.env.BRAAND_EVENT_SIGNING_KEY)
  .update(timestamp + '.' + eventId + '.' + body).digest('hex');
await fetch(process.env.BRAAND_EVENT_URL, {
  method: 'POST',
  headers: {'content-type':'application/json', 'x-braand-event-id':eventId,
    'x-braand-timestamp':timestamp, 'x-braand-signature':'sha256='+signature},
  body
});
```

La clé est dérivée côté serveur du secret d’authentification existant et de la version de la souscription. Désactiver/réactiver révoque l’ancienne clé. Aucun secret fournisseur supplémentaire n’est ajouté. Les reçus portent une clé primaire `(subscription_id,event_id)` et une empreinte du contenu. Une livraison identique réutilise le reçu ; un contenu différent est refusé. Un échec conserve un état incertain nécessitant un contrôle, sans rejeu sensible.

Ce mécanisme exécute uniquement des tableaux privés. Il ne constitue pas un déclencheur universel de modèles, un connecteur Slack/Gmail ou une tâche publicitaire autonome. Les workflows existants de Braand continuent de gérer les autres travaux selon leur configuration.

## Mémoire et stockage

La migration additive `drizzle/0022_agent_context_search.sql` crée un index FTS5 et ses triggers, un index de projet, le registre des événements et la table historique de suspension si nécessaire. Le contenu indexé reste privé. Les requêtes filtrent l’espace, le projet, le propriétaire et l’état courant ; les résultats d’index sont revérifiés avant restitution. Modification et suppression mettent l’index à jour.

Les corrections apprises depuis un message restent dans le projet actif par défaut ; les préférences personnelles restent liées à l’utilisateur. La recherche interprojet conserve le mécanisme d’autorisation par demande et l’extraction de méthodes existants. Un contenu externe ne peut pas accorder cette autorisation.

`ensureContextSearchSchema` applique la migration idempotente dans le scheduler existant, hors authentification. Les instructions générées sont dans `agent-context-schema.generated.mjs`. Les garder synchronisées avec le SQL source. Une erreur de stockage espace les nouvelles tentatives ; elle n’empêche pas l’accueil de s’afficher. Seule l’absence de l’index autorise la recherche de compatibilité : un quota épuisé ne déclenche pas une seconde recherche coûteuse.

Vérification déployée : `GET /api/health?check=agent-operations` doit retourner `status:ok`, `schemaVersion:1`, `indexedProjectSearch:true`, `signedEvents:true`. Cet indicateur vérifie le marqueur de migration ; les tests ci-dessous vérifient le comportement.

Retour arrière : redéployer l’ancienne version. Les tables et ressources additives peuvent rester stockées ; aucun effacement n’est requis. Ne pas supprimer l’index tant qu’une version l’utilise.

## Conseil expert facultatif

`consult_expert` consulte `anthropic/claude-fable-5.2` via l’adaptateur OpenRouter et la comptabilisation existants. Une consultation au maximum par réponse, 2 048 tokens de sortie, 90 secondes, sans outils ni délégation. Motifs admis : validation en échec, preuves contradictoires, décision d’architecture. Les références privées et les projets sont revérifiés.

Le modèle principal reste inchangé. Le conseil est enregistré comme `advisor_report`, avec sa provenance ; ce n’est jamais une preuve d’exécution. Un résultat tronqué ou interrompu est refusé, sans nouvel appel automatique. Le tarif frais et le budget existant sont obligatoires. L’absence de métadonnées Fable ne bloque pas les trois modèles principaux.

Identifiant et modalités vérifiés dans le catalogue public OpenRouter le 10 novembre 2026 : texte/image/fichier en entrée, texte en sortie, outils et sorties structurées, contexte annoncé de 1 M et sortie de 128 k. Braand applique ses limites plus basses. L’accès payant du compte n’est pas démontré par ce catalogue ; aucune consultation réelle facturable n’a été lancée pendant ces vérifications.

Sources : https://openrouter.ai/api/v1/models ; https://www.anthropic.com/claude-fable-and-mythos-5-2. Il s’agit d’un conseil applicatif explicite, sans prétendre utiliser le protocole Advisor natif d’Anthropic.

## Vérifications et limites d’activation

- `node tests/agent-operations.integration.mjs` : vraie SQLite/FTS, scopes, versions, fixtures, déduplication, signatures, plafonds, révocation, exports et migration.
- `node tests/agent-operations.browser.mjs` : vrai composant React dans Chromium, API de test, clavier, mobile, rechargement, refus et contenu malveillant.
- `node tests/agent-routing.integration.mjs` : orchestrateur réel avec fournisseurs isolés, conseil partagé/borné, traitement des interruptions, délégation et outils existants.
- `node tests/model-rate-refresh.integration.mjs` : tarifs officiels simulés dans un test hors réseau, expert facultatif isolé des modèles principaux.

Les traces de tests utilisent uniquement des données explicitement fictives. Aucune publication, campagne, génération média ou consultation payante n’est exécutée par ces tests.

Restent dépendants de services et droits distincts : exécution Linux et rendu vidéo sur Workers Paid (l’utilisateur conserve Free), solde FAL, disponibilité réelle des modèles par compte, voix en temps réel, numéro/adresse de messagerie dédiée et enregistrement interactif d’une démonstration navigateur. Ils ne sont pas présentés comme activés par cette livraison. L’apprentissage par instructions/fichiers et les autres intégrations existantes sont préservés.
