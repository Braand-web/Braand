---
name: braand-motion-studio
description: Produire un film de motion design de niveau studio (lancement produit, démo d'interface, showreel, typographie animée, histoire de données) - brief de production, référence visuelle, liste d'états, ressorts et son sur la même horloge, rendu image par image avec __braandSeek, critique sur planche-contact et portes de validation. Utile pour toute vidéo motion qui doit vraiment impressionner.
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Studio motion design

Méthode originale Braand. Un modèle ne « sort » pas une vidéo : il écrit un programme qui peint chaque image, et le moteur `render_motion` le transforme en MP4. La qualité vient moins de la consigne que de tout ce qui l'entoure : un brief précis, une grammaire visuelle choisie, une histoire construite en états, un mouvement qui a du poids, et une critique honnête des images rendues.

## 0. Ce que le code fait bien, et ce qu'il ne fait pas

- **Excellent** : films produit, démos d'interface, typographie animée, données qui se dessinent, explications de lancement, logos animés.
- **À éviter en code** : scènes photoréalistes, personnages complexes, mouvement organique. Pour cela, générer la base en vidéo IA (`plan_media`), puis éventuellement redessiner textes et éléments graphiques par-dessus en code.
- **Sans bac à sable de rendu** (`render_motion` indisponible) : livrer le brief, le guide de style, la liste des plans, la composition et une planche d'images fixes rendue avec `render_visual` ; dire clairement qu'aucune vidéo n'a été rendue et proposer la vidéo IA.

## 1. Le contrat de rendu (non négociable)

- La page expose `window.__braandSeek(t)` : elle peint **exactement** l'image de la seconde `t`, et rien d'autre ne pilote l'image.
- `window.__braandReady` est une promesse résolue quand polices et médias sont chargés.
- Interdits en rendu : transitions CSS, `setTimeout`, `setInterval`, animations lancées par minuteur, `Math.random`. Utiliser un bruit à graine.
- Toute image doit pouvoir être rendue seule, sans rejouer les précédentes, et deux rendus du même instant doivent être identiques.
- Partir de [seek-skeleton.md](references/seek-skeleton.md) : tailles exprimées en fraction du format, une seule timeline pour tous les formats.

## 2. Le brief de production avant tout code

Une consigne vague laisse chaque décision ouverte, et le modèle choisit alors le défaut le plus sûr (titre centré sur dégradé, tout en fondu). Remplir [brief-template.md](references/brief-template.md) :
- la phrase que le spectateur doit retenir, le public, la durée, les formats ;
- les **ressources réelles** : logo, captures de l'interface, couleurs, police, son (bibliothèque de l'utilisateur, site lu avec `read_page`) ;
- la ligne rouge : **ne jamais inventer un écran produit, un chiffre ou un témoignage**. S'il manque une capture, s'arrêter et la demander plutôt que de dessiner un faux convaincant ;
- les livrables : storyboard, planche-contact, vidéo, image d'affiche, source.
Ne poser que les questions dont la réponse change le film. Une même marque garde un même dossier de travail : le moteur, le son et les réglages servent aux films suivants.

## 3. La référence visuelle

Nommer ou montrer un style marche mieux que le décrire. À partir d'une image, d'un extrait vidéo fourni (images extraites toutes les 0,5 s avec ffmpeg) ou des anciens travaux de l'utilisateur, écrire :
- `style_guide` : palette en hexadécimal, police d'affichage et police d'interface, une seule couleur d'accent, durée des plans, transitions, mouvements de caméra, grain ;
- `shotlist` : les plans pour la durée demandée, dans ce style.
Reprendre la **grammaire**, jamais les sujets, logos ou textes de la référence. Faire valider ces deux fichiers avant d'écrire le code.

Défauts interdits par défaut : titre centré sur dégradé, tout qui apparaît en fondu, étiquettes dans les coins, halos sur l'interface, plus de deux polices. Quelque chose de nouveau à l'écran toutes les 2 à 4 secondes.

## 4. Une histoire en états

Une liste d'effets (« zoom, morphing, particules ») n'est pas une histoire. Le storyboard dit ce que le spectateur sait à chaque seconde :

| Temps | Rôle | Contenu |
|---|---|---|
| 0–2 s | Accroche | une image qui mérite l'attention |
| 2–5 s | Problème | la friction, montrée à l'écran |
| 5–9 s | Révélation | le produit entre par une vraie interaction |
| 9–13 s | Preuve | un écran ou un chiffre réel soutient la promesse |
| 13–16 s | Conclusion | un état final net et un appel à l'action lisible |

Chaque plan a un **état d'entrée**, un **état de sortie** et une **raison d'exister** ; un plan qu'on ne sait pas justifier est coupé. Technique forte : un seul élément qui se transforme d'état en état (taille, arrondi, couleur), conduit par un curseur qui clique vraiment, et un dernier état identique au premier pour que le film boucle.

## 5. Mouvement avec du poids, son sur la même horloge

- Une courbe d'accélération fixe glisse de A à B ; un mouvement avec masse accélère, dépasse à peine et se pose. Utiliser des **ressorts analytiques** (fonctions du temps). Quand une valeur change plusieurs fois de cible, additionner un ressort par changement plutôt que de le relancer.
- Une règle par famille d'objets : petite interface vive et presque sans rebond, panneaux qui se posent, caméra discrète, titres qui arrivent franchement et **restent assez longtemps pour être lus**, mascotte qui rebondit exprès. Si tout rebondit, plus rien ne paraît précis.
- Le son suit la même horloge : soit synthétisé dans le code, soit une piste fournie dont on mesure d'abord le tempo, les temps et les temps forts (`code_run` avec un script d'analyse). Changements d'état sur les temps, grands moments sur les temps forts, clics et souffles sur les attaques. Volume final -14 LUFS (le moteur normalise la piste fournie).
- Test « yeux fermés » : écouter le film sans l'image ; si le son n'a pas de forme seul, il n'est pas fini.

## 6. La critique obligatoire

Ne jamais livrer le premier rendu. Construire les preuves avec ffmpeg (commandes dans [critic-checklist.md](references/critic-checklist.md)) : planche-contact à 2 images par seconde, bande de 12 images autour du mouvement le plus rapide, test téléphone à 360 px de large, double lecture pour la boucle, même instant rendu deux fois (empreintes identiques). Puis :
1. juger **uniquement les images rendues**, pas l'intention ;
2. noter de 1 à 10 : accroche en 2 s, lisibilité sur téléphone, qualité du mouvement, variété, synchronisation du son, fidélité à la marque ;
3. lister les 3 pires défauts avec horodatage, preuve et correction locale ;
4. corriger ces secondes, re-rendre, recommencer jusqu'à 8 partout.
Défauts à traquer : textes qui se chevauchent ou sortent du cadre, élément qui glisse au lieu de se poser, étiquettes de coin, texte flou agrandi, temps mort sans rien à l'écran, saccade au point de boucle.

## 7. Le dossier studio et les portes

Dans le bac à sable : `brief.md`, `style_guide.md`, `shotlist.md`, `assets/` (ressources validées), `src/` (composition), `reviews/` (planches et notes), `out/` (un export par format).

| Porte | Ce qui doit être validé avant de continuer |
|---|---|
| 1 | Références et ressources produit réunies |
| 2 | Guide de style et liste des plans |
| 3 | Une image fixe par plan, critiquée |
| 4 | Animatique à 960x540 avec son provisoire |
| 5 | Passe complète, finitions, son |
| 6 | Formats, contrôle de boucle, image d'affiche, notes de livraison |

Un film long se produit en tâche de fond (`prepare_work`) entre les portes ; une ressource manquante bloque, une référence floue donne lieu à une question ou à une image d'essai, jamais à 900 images polies dans la mauvaise direction. Utiliser la capacité avancée (`request_model_capacity` advanced, raison video_motion) pour un nouveau film.

## 8. Formats et livraison

- Chaque format vient de la **même timeline**, jamais d'un recadrage : vertical avec un texte plus grand et moins d'éléments, carré avec des tenues plus serrées, paysage avec plus de contexte.
- `render_motion` en brouillon pour les contrôles, en `high` pour la livraison ; `code_export_file` avec un titre explicite.
- Livrer : la vidéo par format, l'image d'affiche, la planche-contact finale et trois lignes sur ce qui a été fait. Proposer une déclinaison (autre format, version courte, GIF).
