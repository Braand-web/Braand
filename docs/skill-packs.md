# Packs de compétences fournis — 31 octobre 2026

Tous les contenus des dix-huit pièces jointes sont conservés. L’import n’applique aucun tri par utilité ou popularité. Les archives imbriquées `.skill` sont ouvertes comme ZIP, sans exécuter de code. Les fichiers, références, scripts, exemples, modèles, polices et licences sont des ressources inertes.

Le catalogue compte 166 entrées : les 42 méthodes existantes, 122 nouvelles compétences nommées, un guide des instructions et prompts importés et un guide des inventaires d’outils. `frontend-design` reçoit sa variante fournie sous la même entrée. Les deux versions distinctes de `skill-creator` restent consultables sous une entrée. Les deux ZIP Codex Cloud identiques partagent un seul contenu. Toutes les occurrences sources sont traçables, mais chaque suite d’octets n’occupe qu’un objet.

`skills/packs/sources.json` épingle les SHA-256 des pièces jointes. `manifest.json` décrit chaque fichier source, ses objets et les versions des compétences. `scripts/import-skill-packs.py --source-dir <dossier>` reproduit l’import sans extraire de chemin fourni vers le système de fichiers. Les nouveaux objets locaux ont une extension `.blob` ; les octets déjà présents dans les méthodes existantes sont réutilisés.

Le build vérifie les empreintes, les chemins, les limites et l’absence du contexte personnel dans les objets partagés. Le contenu des packs est stocké dans le bucket R2 privé déjà relié à Braand, sous `skills/packs/v1/<sha256>`. Seuls les métadonnées et index se compilent dans le Worker. Cela conserve une taille de déploiement limitée, tout en donnant accès à tous les textes par lecture progressive. Les plafonds de lecture restent appliqués par demande.

`scripts/publish-skill-packs.mjs --apply --worker aira-production` vérifie le bucket, les octets locaux et les objets distants. Il réutilise les objets identiques et ne remplace jamais un objet différent portant la même clé. Le reçu privé indique le nombre d’objets vérifiés. La publication des objets précède le déploiement du catalogue qui les référence.

`read_skill` lit l’entrée puis ses références exactes. Les scripts sont consultables comme texte ; les ressources binaires renvoient un lien de téléchargement privé. La route `/api/skills/[id]/asset?reference=...` exige l’identité et l’accès à l’espace, vérifie l’empreinte et sert exclusivement une pièce jointe avec `nosniff`, sandbox et absence de cache public. Aucun chemin libre ni nom de bucket fourni par le client n’est accepté.

Les cinq fichiers AGENTS, SOUL, IDENTITY, USER et MEMORY du pack de contexte restent hors du dépôt et du catalogue partagé. Ils sont importés avec des identifiants déterministes dans le seul espace du propriétaire vérifié, avec leurs sources et leur statut de contexte importé. Un index privé permet de les retrouver. Leurs affirmations ne deviennent pas des faits vérifiés ni des instructions système.

Le prompt fourni est une référence consultable. Il ne remplace pas l’identité Braand, ses protections, ses mandats ou ses outils. De même, l’inventaire des 338 outils décrit des interfaces : il ne contient ni implémentations, ni accès authentifiés. L’agent découvre les capacités actives avant d’agir. Cette installation n’active pas de moteur payant, de connexion ou d’abonnement supplémentaire.

## Complément des kits agent et vidéo

Le second import ajoute les huit fichiers et archives fournis ensuite. Les deux ZIP vidéo sont identiques ; les deux copies du skill de création d’artifacts et les deux copies du skill de montage partagent chacune une méthode. Les skills autonomes sont reconnus par leur frontmatter, quel que soit leur nom de fichier de téléchargement. Leurs noms fournis restent dans la provenance. Les archives `.skill` et les dossiers `sources/` du pack de 19 originaux sont fusionnés quand leurs octets et leurs ressources sont identiques.

Quand deux versions possèdent exactement le même SKILL.md et des ressources compatibles, l’import réunit ces ressources sous une seule version. Des corps ou des fichiers portant le même nom avec des octets différents conservent des versions distinctes. Les moteurs Python, chartes et exemples vidéo sont aussi référencés directement par les méthodes vidéo ; les prototypes de navigateur le sont par les méthodes de navigation. Ils restent inspectables sans être exécutés à l’installation.

La préférence de montage et motion design est Opus 5.5, via la sélection sémantique avancée `video_motion`. Le serveur conserve la même conversation, les mêmes outils, le même plafond et la tarification vérifiée du modèle exact. Les moteurs de rendu et leurs connexions restent distincts du modèle de raisonnement. Voir `ADAPTIVE_MODEL_ROUTING.md`.
