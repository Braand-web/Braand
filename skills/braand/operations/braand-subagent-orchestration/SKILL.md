---
name: braand-subagent-orchestration
description: Découper un travail en sous-agents spécialisés nommés (ingénieur, créatif, analyste, relecteur) qui travaillent en parallèle avec un contrat clair, puis assembler et vérifier leurs résultats. Utile pour une demande large (campagne complète, site plus contenus, audit plus plan) ou quand plusieurs expertises sont nécessaires.
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Orchestrer des sous-agents nommés

Méthode originale Braand pour `delegate_specialist`.

## Quand déléguer

- Déléguer seulement un travail autonome et vérifiable : un livrable, un ensemble de créatifs, un audit, un code. Une simple réponse reste au chef d'orchestre.
- Lancer en parallèle (dans le même tour) les sous-agents indépendants, et en séquence ceux qui dépendent d'un résultat. Il y a au plus 6 sous-agents par réponse, et le budget de crédits reste commun.

## Nommer et cadrer

- Donner à chaque sous-agent un prénom et un rôle lisibles par l'utilisateur, par exemple « Léa · Directrice artistique », « Hugo · Ingénieur » ou « Nora · Analyste data ». Garder les mêmes noms dans toute la session pour que l'utilisateur suive qui fait quoi.
- Choisir le rôle (`creative`, `campaigns`, `coding`, `analysis`, `extraction`, `review`) et la spécialité.
- Écrire un contrat : livrable attendu, 2 à 5 critères de réussite vérifiables, références (identifiants de ressources), outils autorisés, plafond de crédits.
- Transmettre le contexte utile, jamais toute la conversation : faits, contraintes, marque, fichiers.

## Assembler et vérifier

- Relire chaque rapport : critères atteints, limites, sources. Un rapport n'est pas une preuve d'exécution : vérifier les fichiers livrés.
- Pour un livrable important, déléguer une relecture à un sous-agent `review` différent de l'auteur.
- Présenter à l'utilisateur une synthèse par sous-agent (nom, ce qui est fait, ce qui reste), puis la suite recommandée.
