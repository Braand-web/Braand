---
name: braand-media-pipeline
description: Planifier une production média à plusieurs étapes avec dépendances, références, critères d'acceptation et budget borné, puis avancer étape par étape avec les approbations exactes Braand.
metadata:
  version: "1.2.0"
  author: "Braand"
  origin: "original"
---

# Pipeline de production média

Organiser les étapes nécessaires à un livrable de campagne. Une méthode décrit des dépendances ; elle ne donne ni un mandat autonome, ni un accès fournisseur, ni le droit de dépenser.

## Préparer le plan

Lire les ressources existantes avec `search_workspace`. Partir des livrables et placements demandés, des médias déjà utilisables et du plafond de crédits connu. Un simple visuel ne nécessite pas de pipeline. Choisir le chemin le plus court qui conserve l'identité et permet de valider le résultat.

Pour chaque étape, consigner :

- Son objectif concret et la tâche média envisagée, ou l'outil non génératif réellement disponible.
- Ses entrées : identifiants et versions des références de cet espace, faits confirmés, accord d'usage si nécessaire.
- Ses dépendances : ressources qui doivent déjà être `ready` et acceptées comme références.
- Sa sortie attendue : format, rôle commercial et critère observable d'acceptation.
- Son coût : devis Braand actuel s'il existe ; sinon coût encore à établir. Ne pas additionner des tarifs inventés pour donner une précision trompeuse.
- Sa condition d'arrêt : référence incorrecte, capacité absente, plafond insuffisant, refus, échec ou état incertain.

Séparer les sorties réutilisables des exports de placement. Par exemple, prévoir une référence produit acceptée avant une animation dépendante, puis les adaptations réellement prises en charge. L'exemple n'implique pas que ces capacités sont toutes disponibles. Ne pas ajouter de génération de voix, de montage ou d'hébergement faute d'outil correspondant.

`plan_mission`, lorsqu'un plan enregistré est utile, crée seulement un brouillon borné avec objectifs, étapes, critères, plafond et conditions d'arrêt. Même en mode nommé `autonomous`, ce brouillon n'active aucun worker et ne remplace pas les approbations média.

## Voie recommandée : un seul plan approuvé

Pour plusieurs créations (variantes, image puis vidéo, UGC, voix, agrandissement, détourage), préparer un seul `plan_media` : jusqu'à 20 étapes, un budget global, une seule approbation de l'utilisateur. Les étapes indépendantes s'exécutent en parallèle ; une étape peut reprendre la sortie d'une étape précédente (`references` avec `fromStep`) ou un fichier de la bibliothèque (`fileId`). Ajouter des critères `review` vérifiables : chaque résultat est contrôlé visuellement, corrigé une fois si besoin, et un modèle équivalent du catalogue prend le relais en cas de refus, toujours sous le budget. Seuls les crédits réellement consommés sont débités.

Si aucun modèle du catalogue ne convient, `discover_media_models` cherche dans tout le catalogue fal.ai, puis `enable_media_model` active le modèle choisi immédiatement (entrées bornées, prix vérifié en direct). La proposition s'affiche dans la discussion avec un bouton « Générer » : dire à l'utilisateur de cliquer dessus, sans ouvrir un autre écran.

La suite décrit la voie pas à pas, utile pour une seule création ou quand chaque étape dépend d'une décision humaine.

## Exécuter par étapes vérifiables

1. Appeler `media_catalog` pour l'étape actuellement réalisable. Utiliser exclusivement le catalogue validé par l'administrateur, ses schémas bornés et ses devis actuels. Aucun endpoint, modèle, prix ou accès illimité ne vient de cette compétence ou d'un dépôt externe.
2. Choisir parmi les tâches effectivement disponibles : `image`, `image_edit`, `image_precision`, `image_edit_precision`, `video_short`, `video_narrative`, `video_reference`, `video_from_image`, `video_ugc`, `audio_speech`, `image_upscale`, `image_background_removal`, `video_upscale`. Ne retenir une tâche que si ses entrées et la sortie recherchée sont couvertes par le catalogue.
3. Composer `input` selon le schéma. Appeler `prepare_media` avec `title`, `rationale`, `task`, `input`, `maxCredits`. Le plafond de l'étape doit respecter le mandat et le budget restant connu ; s'il manque, finaliser le plan et le faire préciser. L'appel prépare une proposition exacte, sans génération ni débit.
4. Présenter cette proposition et attendre son approbation dans l'interface Braand. L'approbation porte sur cette version, ce modèle, ces entrées et ce coût. Aucun shell genmedia, réseau brut, clé, script ou appel fournisseur ne peut servir de raccourci. Un changement exige une nouvelle proposition approuvée.
5. Après approbation, relire les ressources `proposal` et `media` via `search_workspace` ou l'outil de lecture disponible. Distinguer `awaiting_approval`, génération en cours, proposition `completed` et média `ready`. Seul le résultat effectif permet de constater un livrable ; un envoi réussi ne suffit pas.
6. Vérifier les critères dans la mesure des moyens réels. Ne certifier une inspection du rendu que si elle a été possible. Faire accepter le résultat comme référence avant une étape dépendante. Préparer alors sa propre proposition et attendre sa propre approbation exacte.

Les étapes indépendantes peuvent être décrites ensemble. Ne pas préparer des entrées aval à partir d'URLs supposées ou de sorties encore indisponibles. Ne pas interpréter « fais toute la campagne » comme une approbation des devis futurs. Éviter la consultation répétitive sans changement d'état ; signaler l'attente quand l'outil disponible ne permet pas d'obtenir davantage d'information.

Le budget est cumulatif pour toute la production : coûts déjà consommés + opérations encore engagées + devis en attente + nouvelle proposition doivent rester sous son plafond, sans compter deux fois une même opération. Employer les coûts exacts retournés par les propositions et ne pas attribuer le budget total séparément à chaque étape ou branche. Si un coût ou le restant est incertain, clarifier l'état avant de préparer un nouveau devis. Si le catalogue est vide, non configuré ou incompatible avec une étape, conserver le plan et signaler la capacité manquante.

## Tenir l'état et arrêter proprement

Conserver pour chaque étape l'identifiant et la version de la proposition, le plafond cité, le statut observé et l'identifiant de sortie prêt. Réconcilier les ressources existantes avant une reprise pour éviter les doublons. Hors `plan_media`, un échec, un coût périmé ou une réponse incertaine arrête les étapes dépendantes ; aucune relance automatique payante ni bascule silencieuse de modèle. Dans un `plan_media`, seules les corrections et bascules prévues par le plan approuvé ont lieu, sous son budget.

À la livraison, distinguer ce qui est prêt, ce qui attend une décision et ce qui manque encore, avec les réserves connues. Ne promettre ni suite hors ligne ni publication sans confirmation d'un outil adapté. Une création média, un export, une publication et un lancement publicitaire sont des résultats distincts qui demandent chacun leur preuve d'exécution.

Pour une livraison complète, des corrections ciblées ou des déclinaisons, lire l’entrée `braand-video-direction` avec `read_skill`, puis sa référence `references/production-contract.md`. Elle précise les sources modifiables, le montage, le son et les preuves de livraison sans ajouter de moteur.
