# Corrections de l’audit du 2 novembre 2026

Base : production d4342fa1e01d341147a9c4e13807e0857d531332, conservant l’authentification Google, Browserbase, Firecrawl et le coffre d’identifiants.

## Correctifs livrés dans cette révision

- B01 : admission atomique des budgets concurrents. Le plafond interne engagé est soustrait de la capacité à accepter une autre tâche, sans débiter ni réserver visiblement le portefeuille. Les anciennes allocations ne sont pas comptées deux fois. Une consommation historique insuffisamment couverte reste `needs_reconciliation` ; elle n’est plus marquée soldée avec un coût tronqué.
- B02/B13 : les consommations non rapprochées de plus d’une heure entrent dans la surveillance existante. Les erreurs du chat conservent un code et un identifiant d’exécution, y compris après déconnexion, sans contenu utilisateur dans le log.
- B10 : le mode autonome peut rechercher, analyser, créer, réviser et exporter des livrables privés. Les actions connectées passent toujours par les contrôles et propositions côté serveur. Les générations et publications ne sont pas autorisées par un skill ou par le choix du mode. Les missions durables restent distinctes du chat.
- B07 : adaptation MCP Node 2.1.2, SDK MCP 2.4.0 et Hono Node 2.1.5 verrouillés. Tous les corps JSON des routes qui utilisaient directement `request.json()` sont maintenant bornés avant validation : 1 Mio maximum, 80 000 octets pour l’envoi d’un message. Profondeur maximale 64, collection maximale 10 000 éléments, structure maximale 50 000 nœuds. Les uploads binaires conservent leur protocole distinct.
- B17 : en-têtes HTTP globaux nosniff, HSTS sur HTTPS, politique de référent, permissions et protections contre l’encapsulation. Les politiques plus strictes des routes et les flux SSE sont préservés.

## Limites maintenues explicitement

Cette révision ne constitue pas une résolution de l’ensemble des 18 constats. Zod 3 nécessite encore une migration vers l’API v4 : les bornes des entrées réduisent le risque sans prétendre supprimer l’avis de dépendance. Les sauvegardes/restaurations de production, l’historique paginé, la continuité durable d’un chat interrompu et les quotas par espace restent à traiter.

Les moteurs vidéo/Fal, l’exécution Linux, les déploiements de code généré et les publications sociales ne deviennent pas opérationnels en modifiant un drapeau. Leurs financements, configurations et autorisations doivent être réellement présents puis testés. Aucun abonnement payant nouveau, aucune annonce publicitaire ni envoi client n’est déclenché par cette livraison. Les informations fiscales et l’identité légale manquantes ne sont pas inventées.

## Validation

Régressions spécifiques : deux budgets en concurrence, réduction au solde encore engageable, solde visible inchangé avant consommation, règlement idempotent, coût historique non couvert, outils autonomes contrôlés, limites JSON et conservation des flux/cookies/politiques HTTP.

Les 255 tests unitaires et les vérifications locales sont complétés par la CI Linux (typecheck, lint, build, intégrations, moteur Cloudflare et parcours navigateur). La publication ne doit utiliser que l’artefact de la même révision validée et conserver les secrets, routes et bindings en production.
