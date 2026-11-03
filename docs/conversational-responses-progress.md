# Réponses enrichies — état de travail du 3 novembre 2026

Cette branche contient une intégration en cours. Ce document ne constitue pas une attestation de déploiement ni de disponibilité de toutes les capacités demandées.

## Base intégrée
- Contrat `version: 1` dans lib/rich-response.ts. Blocs bornés, identifiants stables, validation stricte et repli par composant.
- Découverte progressive `response_formats`, puis `present_response` : pas de contrat complet injecté dans chaque réponse simple.
- Cartes de ressources hydratées côté serveur, versions vérifiées, fichiers via le lecteur existant.
- Tableaux filtrables/triables, export CSV, graphiques SVG avec valeurs nulles distinctes de zéro, formulaires et choix.
- Persistance dans le message assistant, événement SSE rich_response, relecture par GET chat.
- Interactions POST/GET /api/chat/interaction : rattachement message/bloc, espace explicite, permissions actuelles et enregistrement idempotent. Les réponses aux formulaires préparent un message; elles ne publient rien.
- Actualisation explicite des objets sans écraser l'instantané historique.
- Contexte de recherche limité au projet actif. Référence interprojet ponctuelle via référence choisie, méthode explicitement réutilisable seulement, provenance incluse.
- Changer de projet crée un nouveau slot sans effacer le brouillon ou les pièces jointes du précédent.

## Extension
1. Ajouter un type strict à richBlockSchema, avec limites et test négatif.
2. Ajouter son rendu dans RichBlockView; ne jamais injecter du HTML/code arbitraire.
3. Pour une référence métier, hydrater dans prepareRichResponse après contrôle de projet et de version.
4. Une mutation doit appeler une opération métier existante; ne pas accepter une URL ou un nom d'opération arbitraire du modèle.
5. Ajouter tests serveur/persistance et navigateur, puis documenter la compatibilité.

## Modèles
- Le catalogue public OpenRouter confirme openai/gpt-6.1-sol-pro, openai/gpt-6.1-terra et anthropic/claude-fable-5.1. Vérification du 3 novembre 2026 : https://openrouter.ai/api/v1/models
- Le routeur reconnaît ces identifiants exacts et refuse une sélection manuelle accompagnée d'une escalade cachée. Il exige clé, entrée activée et tarif frais; leur présence dans le code n'active pas le compte.
- Les références Fal demandées disposent de documentation : https://fal.ai/models/bytedance/seedance-2.5/us/image-to-video/api et https://fal.ai/models/blackforestlabs/flux-3-max/image-to-video/api. Leur adaptation de paramètres, tarification bornée et essai sur le compte restent à terminer.
- anthropic/ est incomplet et reste non activé.
- Aucune génération fournisseur payante exécutée dans cette série de tests.

## Vérifications et travail restant
- Tests unitaires: 260 réussis avant les derniers ajouts de routage.
- Intégration orchestrateur: 56 scénarios réussis, dont rendu persistant, rejet de bloc, double soumission et référence interprojet.
- Suite intégration complète: réussie avant le dernier test supplémentaire de sélection des modèles.
- Build production: réussi; vérification finale après derniers changements encore requise.
- Tests navigateur: suite agent-ui réussie; rich-response réussi (mobile, clavier, filtre, repli, double clic, restauration). Capture locale .tmp/rich-response-browser/mobile.png.
- À terminer avant une livraison complète: actions métier inline spécialisées (campagnes/publications/routines), contrats et confirmations versionnées associés; mémoire personnelle indépendante; garde de projet pour l'ensemble des outils de plateforme; résolution de références de projet en langage naturel; choix de modèle persistant dans l'UI; registre de capacités complet; configuration et tests de compte Fal/OpenRouter.
- Le sélecteur ponctuel de référence ne remplace pas encore la résolution automatique du nom ALPHA.
- Les graphiques reposent sur les données soumises au contrat; validation numérique et instructions ne prouvent pas leur exactitude métier.
- Les retouches fidèles ne sont pas garanties par cette interface; elles dépendent du moteur utilisé.
- Ne pas présenter cette branche comme totalement validée ni déployer en prétendant satisfaire le périmètre complet.

## Déploiement progressif
Le contexte par projet est protégé par PROJECT_CONTEXT_V1 (désactivé sans valeur true). Les sélecteurs restent masqués et l’API refuse les nouveaux projets/références tant que ce flag est absent. Ne pas activer avant validation de tous les outils de plateforme. Les réponses enrichies sont indépendantes et peuvent être livrées. Aucune migration destructrice; les anciens messages restent compatibles. Les nouveaux modèles restent inactifs sans catalogue et tarifs vérifiés.
