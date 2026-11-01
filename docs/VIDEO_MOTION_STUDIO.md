# Video & Motion Studio dans Braand

La compétence `video-motion-studio` est disponible au modèle principal et aux spécialistes par `search_skills` / `read_skill`. Elle figure dans le catalogue des compétences avec le titre « Montage vidéo et motion design ». Le catalogue comporte désormais 166 méthodes ; aucun corpus n’est chargé intégralement dans chaque demande ou envoyé au navigateur client.

## Source et adaptation

Archive fournie par l’utilisateur : SHA-256 `43e8544a2b894204e715dc75ff399e009bc627fa39c31fb0041324b7e9d18e7a`.

L’import conserve exactement 14 ressources inertes : `SKILL.md`, dix guides, un storyboard et deux exemples JSON. Le manifeste conserve les empreintes de tous les fichiers et des 22 entrées exclues. Les scripts Python/shell, l’installateur et le projet Remotion ne sont pas exécutés ni présentés comme des outils de l’agent. Aucune licence permissive ou validation de leurs performances n’est supposée.

`skills/integrations/video-motion-studio.md` adapte la méthode aux capacités réelles, aux fichiers privés de l’espace, au budget et aux validations Braand. Son texte fait partie de l’empreinte de la méthode compilée. Les recettes d’effets avancés peuvent servir au storyboard ; elles n’activent pas un moteur manquant.

Import reproductible :

```powershell
python scripts/import-user-video-skill.py 'chemin/video-motion-studio.skill'
node scripts/build-skill-catalog.mjs
```

L’importeur vérifie l’archive exacte, les chemins, tailles et contenus UTF-8/JSON. Le compilateur vérifie ensuite les fichiers conservés contre leur manifeste.

## Outils de production et de contrôle

- `prepare_video_edit` prépare une proposition payante versionnée à partir de fichiers privés identifiés par ID, version et empreinte. Il accepte découpe/assemblage, cadrage entier ou recadré, zoom simple sur images fixes, couleurs prédéfinies, volume, fondus et sous-titres minutés. Il ne rend ni ne publie sans approbation.
- `get_video_edit_result` lit le résultat réel d’une proposition : état, création finale, planche-contact et rapport technique. Il n’envoie et ne relance aucune opération. L’API correspondante est `GET /api/media/:proposalId/status`, protégée par la session et les droits de l’espace.
- `inspect_media` peut relire la planche-contact effectivement enregistrée avec le modèle de revue existant. Cette revue reste facturée dans le budget autorisé et porte sur les images échantillonnées, sans prétendre regarder ou écouter toute la vidéo.
- Les outils existants `media_catalog`, `prepare_media`, `assemble_media` et `save_deliverable` restent utilisables selon leurs capacités et autorisations.

Le devis décrit les paramètres en langage courant ; la demande exacte reste consultable. L’interface distingue « Approuver le montage » et le suivi d’une génération. Les états en file ne sont pas confondus avec un résultat incertain.

## Moteur de rendu

Le service privé `services/media-render` accepte `braand-render-v2` tout en conservant les assemblages v1. Toutes les opérations sont définies par des schémas ; aucun script, filtre libre, URL source ou shell fourni par le modèle n’est exécuté. Les uploads sont vérifiés par empreinte. Les protocoles des entrées sont limités aux fichiers et flux locaux.

Pour un montage v2, le service décode le résultat, vérifie durée, dimensions et cadence, puis extrait six images et une planche-contact. Le Worker vérifie les preuves, conserve les fichiers dans son stockage privé et renseigne le livrable. Le rapport sépare contrôles techniques, échantillonnage, revue sémantique et écoute audio. Un redémarrage pendant le rendu produit un résultat incertain et conserve la réservation pour rapprochement.

Limites : dix plans, 180 secondes au total, 1 920 px par dimension, 2 073 600 pixels, 30 images/s, sources totalisant au plus 150 Mio, sortie d’au plus 50 Mio. Les animations Remotion, parallaxes multicouches, montages sur détection de rythme et effets anime complexes ne sont pas exécutés par ce contrat.

## Activation et vérifications

Le déploiement du Worker installe les méthodes et les interfaces. Le moteur FFmpeg est un service conteneurisé distinct : il doit être hébergé et configuré avant d’activer les rendus. Les drapeaux de production existants ne sont pas modifiés par cette installation.

`MEDIA_RENDER_ENABLED`, `MEDIA_RENDER_STAGING_VERIFIED`, une URL privée, son jeton et un tarif frais restent requis. `MEDIA_RENDER_VIDEO_EDIT_VERIFIED=true` ne doit être ajouté qu’après un test distant du contrat v2, de son prix, du téléchargement, du contrôle et de la reprise. Ce drapeau est fermé par défaut et n’est pas activé par une lecture de skill.

Les tests couvrent la découverte par le harness, les références et templates réellement lisibles, l’isolation du corpus, les schémas, devis modifiés, empreintes, droits et capacités fermées. Six contrôles Python de contrat et un rendu local synthétique avec FFmpeg/ffprobe ont été exécutés. Ce test produit réellement vidéo, sous-titres, zoom, rapport et planche-contact. Il ne prouve pas un déploiement du conteneur, une génération IA payante, une revue audio ou une publication sociale.

```powershell
python services/media-render/test_contract.py
# Nécessite ffmpeg et ffprobe disponibles dans PATH.
python services/media-render/test_render.py
npm run typecheck
npm run lint
npm run build
npm test
```
