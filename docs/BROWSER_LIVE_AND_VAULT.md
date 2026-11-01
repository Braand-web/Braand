# Navigateur direct et coffre isolé

## Périmètre livré

Le panneau Atelier réutilise le navigateur Cloudflare existant. Le flux est un screencast Chromium CDP, transporté par WebSocket authentifié et limité à dix images par seconde au maximum. Il n'annonce pas un débit garanti : Chromium émet selon les changements et la charge. Les images ne sont ni enregistrées dans R2 ni transmises au modèle. Une nouvelle page active remplace le flux de l'ancienne. Les informations de navigation sont relues et les premières images après navigation sont recapturées pour réduire les incohérences de titre/URL.

Les anciennes captures restent disponibles lorsque le flux n'est pas configuré. Aucun navigateur fictif n'est affiché. Une déconnexion du panneau ferme seulement le canal de vue ; la session bornée conserve son état. La reconnexion vise le même identifiant et ne relance aucune commande. Le transport est réauthentifié au plus tard chaque minute. Un seul spectateur est conservé par session pour borner le débit.

L'entrée humaine utilise un protocole fermé : clic, texte, touches autorisées et défilement. Le serveur vérifie propriétaire, espace, état humain, version et verrou à chaque entrée. Les données de saisie ne sont pas placées dans l'historique, les événements ou les reçus. Une entrée sans accusé de réception n'est pas rejouée à la reconnexion. Le changement de conducteur annule les approbations pendantes, et le retour observe la page avant de réveiller l'agent.

Les blocages constatés sont distincts du contrôle humain. Un champ sensible ne donne plus silencieusement la main : l'agent s'arrête, et l'utilisateur prend explicitement le contrôle. Les sessions marquées `background` sont bloquées sans proposition d'intervention ; elles doivent être relancées en interaction directe. Les nouveaux producteurs de missions navigateur doivent transmettre la provenance serveur en troisième argument de `browserService.create`, jamais depuis un champ contrôlé par le modèle.

## Coffre : frontière de sécurité

`services/credential-vault/worker.ts` est un Worker privé séparé, avec une autre base D1. **Ne pas lier `VAULT_DB` ni `VAULT_MASTER_KEY` au Worker principal.** Le modèle ne possède aucun outil pour lire un secret, un chiffrement, une clé ou une valeur de champ. Le registre expose seulement site HTTPS, libellé, méthode, permission et dates.

Chaque identifiant est chiffré par une clé de données aléatoire AES-256-GCM. Cette clé est enveloppée par la clé maîtresse AES-256-GCM stockée comme secret du Worker coffre. Les données authentifiées lient le chiffrement à l'utilisateur, l'espace et l'identifiant. Cette première version utilise les secrets chiffrés Cloudflare comme gestion de clé ; elle n'est pas une intégration KMS avec rotation automatique. Une rotation exige un plan de ré-enveloppement dans le coffre, sans réutilisation silencieuse d'une autre clé.

Pour un remplissage, le coffre contacte directement le Durable Object propriétaire du navigateur. Celui-ci verrouille la session, contrôle les permissions et prépare un champ réellement visible sur l'origine HTTPS exacte. Il crée une clé privée RSA-OAEP éphémère et un nonce valable trente secondes. Le coffre transmet une enveloppe hybride AES-GCM/RSA destinée uniquement à ce navigateur. Le nonce est consommé avant déchiffrement et dispatch ; aucun rejeu d'une opération incertaine.

Les champs sont remplis dans le cadre principal seulement et le formulaire doit soumettre vers la même origine. Aucun sélecteur, JavaScript ou ordre CDP n'est fourni par le modèle. Le remplissage ne soumet pas le formulaire : les requêtes d'écriture sont fermées pendant cette opération. Le clic ou l'envoi suivant conserve son contrôle distinct. Les captures destinées au modèle masquent les champs et les pages contenant un mot de passe ou un code temporaire. La vue privée de l'utilisateur continue à fonctionner.

Les chaînes JavaScript et les copies TLS/CDP ne permettent pas de promettre une remise à zéro physique de toute mémoire. Les buffers cryptographiques sont effacés, les références applicatives sont libérées, et aucune valeur n'est écrite dans les journaux ou les tables hors coffre. Un site autorisé reçoit nécessairement le secret que l'utilisateur lui destine : l'isolation ne garantit pas qu'un site compromis ou malveillant ne puisse pas l'exfiltrer ou l'afficher. Ne pas assimiler le filtrage des champs à une preuve contre toute injection ou canal visuel adverse.

## Saisie et contrôle utilisateur

Paramètres → Autorisations contient les cinq permissions, les entrées du coffre, leur suppression et l'historique de remplissage. Les téléversements proposent uniquement Demander ou Refuser. Les valeurs par défaut conservent les confirmations existantes. Autoriser une catégorie ne supprime jamais une approbation métier nécessaire pour une dépense, une publication ou un changement externe sensible.

La saisie de mot de passe est un formulaire protégé, séparé du message et de la sauvegarde des brouillons. Un jeton de capture utilisateur/espace est à usage unique et expire après cinq minutes. Sans la case Enregistrer, la valeur sert au remplissage courant sans entrée dans le registre ni dans la base coffre. Les messages explicitement étiquetés comme mots de passe ou codes sont interceptés au collage/saisie et avant la persistance serveur. Cela ne détecte pas un secret arbitraire non étiqueté, un fichier qui en contient ou toutes les langues ; l'agent doit toujours orienter vers la saisie sécurisée.

Les codes restent dans une saisie protégée intégrée au panneau, jamais dans un message au modèle. L'interface n'affiche cette saisie qu'après confirmation que le champ `autocomplete=one-time-code` est présent et prêt. Les codes ne sont stockés dans aucune base. Deux transmissions sont permises par session, conservées sous forme de compteur sans valeur. Cette borne est volontairement conservatrice : elle ne prétend pas détecter un succès 2FA à partir du simple remplissage. Le site et la page doivent ensuite confirmer l'authentification. Les autres dispositions de champs, les codes séparés en plusieurs cases et les renvois de code exigent l'intervention manuelle ; aucun bouton Renvoyer n'est cliqué automatiquement.

## Déploiement progressif

1. Exécuter les tests isolés et la compilation. Appliquer `drizzle/0018_browser_permissions.sql` sur le staging principal.
2. Créer une D1 distincte pour le coffre staging et y appliquer `services/credential-vault/migrations/0001_vault.sql`. Le Worker principal ne reçoit pas ce binding.
3. Définir les variables de préparation `BRAAND_STAGING_VAULT_D1_ID`, `BRAAND_STAGING_D1_ID` et `BRAAND_STAGING_BROWSER_WORKER`, puis `node services/credential-vault/prepare-config.mjs staging`. Le manifeste généré reste fermé.
4. Créer des secrets aléatoires indépendants : `VAULT_MASTER_KEY` (32 octets, base64) dans le coffre seulement ; `VAULT_CALL_TOKEN` (au moins 32 caractères) dans coffre et principal ; `VAULT_BROWSER_TOKEN` (au moins 32 caractères) dans coffre et propriétaire navigateur. Ne pas mettre de valeurs dans Git, un prompt ou un journal.
5. Déployer le coffre privé, le lier au principal via `CREDENTIAL_VAULT`. Le générateur principal accepte `BRAAND_STAGING_VAULT_SERVICE`. Configurer `VAULT_ENABLED=true` seulement après validation des clés et de la séparation des bases.
6. Ouvrir le navigateur existant uniquement après ses vérifications de prix, droits, budgets, propriétaire et staging. `BROWSER_LIVE_ENABLED=true` ouvre le transport de vue sans remplacer ces vérifications.
7. Tester réellement : deux comptes isolés, prise de main pendant un calcul, verrou pendant une commande, reconnexion, refus de domaine, faux domaine, stockage unique, suppression, 2FA, fermeture et coût réel. Vérifier le passage HTTP 101 du WebSocket à travers Vinext/Cloudflare. Les fixtures locales ne prouvent pas ce passage en production.
8. Répéter avec des ressources et clés séparées pour la production. Conserver les autres interrupteurs. Un déploiement de code ne vaut pas validation des fournisseurs ni autorisation de dépenses supplémentaires.

Le modèle Cloudflare est utilisé ici. Aucun service Steel ou Browserbase n'est revendiqué comme intégré ; ajouter un autre fournisseur nécessite un driver respectant ces mêmes contrats et preuves.

## Limites à lever avant ouverture large

Pas de nouveau paiement, de compte tiers, de test fournisseur payant ou d'activation en production automatique. Les permissions des API connectées restent séparées. La restauration du coffre doit être éprouvée dans son périmètre propre. La rotation des clés, la rétention du journal et les scénarios de site hostile doivent faire partie de l'exploitation. Les réinitialisations et créations de comptes ne sont jamais effectuées par le simple formulaire de capture : elles exigent encore les actions exactes et les accords applicables sur le site concerné.
