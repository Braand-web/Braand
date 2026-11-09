# Atelier

Les fichiers passent par le même FilePreviewProvider et les mêmes lecteurs, intégrés dans le panneau quand Studio est monté. Les consommateurs autonomes du provider conservent le dialogue. Les liens signés et la vérification des permissions sont inchangés.

Le sélecteur recherche les ressources du projet actif et celles explicitement liées aux messages ou pièces jointes de la discussion. Les nouveaux uploads gardent leur projet après une validation serveur. Les fichiers dédupliqués gardent leur provenance initiale.

Les cartes de navigateur transmettent sessionId. Une session introuvable ne déclenche pas la sélection d’une autre session. Les listes embarquées restent limitées à la discussion. Les profils se gèrent également dans Paramètres → Autorisations.

L’état du panneau est conservé par utilisateur, espace, projet et discussion. Les ressources sont relues par une route authentifiée avant restauration. Une nouvelle version est proposée explicitement. Les documents texte proposent une comparaison avec leurs versions enregistrées. Les pages gardent leur restauration versionnée existante.

Les demandes de retouche contiennent resourceId, version et sélection. Le contexte UI valide ces champs et les traite comme des données non fiables. Le pont d’annotation de page est le seul script autorisé dans l’iframe statique. Le parent contrôle sa fenêtre source et son jeton. Les scripts générés, formulaires et appels réseau sont bloqués par CSP.

Les applications lancées par start_preview produisent une ressource application_preview persistante. L’Atelier ouvre son URL signée sur une origine distincte avec une session partitionnée. Le Worker d’exécution doit être redéployé pour ce mode embarqué. L’expiration propose une nouvelle demande à l’agent. Le lancement, la disponibilité du conteneur et le rendu nécessitent leur configuration existante.

Vérifications spécifiques dans tests/atelier.integration.mjs, tests/atelier-ui.browser.mjs, tests/agent-ui.browser.mjs et tests/code-preview.integration.mjs. Les tests navigateur utilisent des réponses locales, sans génération payante ni accès à un compte externe.
