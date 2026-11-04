---
name: braand-approval-window-publishing
description: Préparer un lot de publications ou de programmations entièrement prêt avant de demander l'approbation, puis l'exécuter aussitôt dans la fenêtre de validité. Utile pour toute publication sociale, campagne ou envoi qui passe par une approbation.
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Publier dans la fenêtre d'approbation

Méthode Braand adaptée d'une pratique fournie par un utilisateur. Une approbation porte sur un contenu exact et ne vaut que tant que ce contenu et son contexte n'ont pas changé.

## Adapter à n'importe quel projet

Fixer d'abord les variables du projet depuis le profil, la mémoire, le projet actif ou la demande : plateformes et comptes de destination, public, langue, fuseau horaire de l'audience, cadence, heures de publication et contraintes de la marque. Ne demander que celles qui manquent et changent le résultat. Ne jamais reprendre l'heure, la légende ou le chiffre d'un autre projet.

## Tout préparer avant de demander

- Terminer chaque visuel, légende, destination, audience et heure de publication avant de demander l'approbation. Vérifier les formats avec `platform_specs` quand l'outil est disponible.
- Revérifier le jour même chaque chiffre volatil du lot (prix, dates, horaires, résultats, stocks) et corriger ce qui a bougé depuis la production.
- Tenir une liste unique du lot, une ligne par publication, avec ce qui est prêt et ce qui manque, enregistrée comme livrable (`save_deliverable`) quand le lot dépasse trois publications.
- Ne pas demander l'approbation tant qu'un élément du lot est incomplet : une demande envoyée trop tôt fige un contenu qui changera.

## Une approbation, un lot, une exécution immédiate

- Préparer le lot avec `prepare_publications` ou l'action connectée exacte, puis présenter la carte d'approbation avec l'heure limite et la première heure de publication qu'elle protège.
- Ne pas ouvrir une deuxième demande pour la même destination tant que la première est en attente : on ne saurait plus quelle approbation couvre quel lot.
- Après l'approbation, exécuter dans la même session ; une approbation sans exécution rapide n'est pas une livraison.

## Approbation périmée = approbation nulle

- Si la fenêtre de la plateforme ou l'heure prévue est dépassée, ne pas exécuter : préparer une nouvelle demande pour le lot inchangé, après l'avoir revérifié.
- Annoncer clairement une fenêtre manquée, les publications concernées et la prochaine fenêtre proposée, au lieu de laisser le lot en silence.

## Une écriture à la fois

- Pour une même destination, lancer une seule publication ou programmation à la fois et attendre son reçu avant la suivante.
- Si un résultat est incertain, relire l'état réel (`get_publications`, lecture connectée) avant toute nouvelle tentative ; ne jamais republier à l'aveugle.
- Terminer par un bilan : publié, programmé, refusé ou à relancer, avec les liens réels retournés.
