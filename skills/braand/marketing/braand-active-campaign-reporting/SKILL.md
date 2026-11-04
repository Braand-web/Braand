---
name: braand-active-campaign-reporting
description: Rapporter les résultats publicitaires (Meta ou autre régie) uniquement depuis la campagne réellement active, en séparant fenêtre de dépense et date d'attribution et en signalant les annonces incohérentes. Utile pour tout point de performance publicitaire.
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Rapport publicitaire depuis la campagne active

Méthode Braand adaptée d'une pratique fournie par un utilisateur. Un rapport faux sur la mauvaise campagne coûte plus cher qu'un rapport en retard.

## Adapter à n'importe quel projet

Fixer les variables du projet : compte publicitaire, devise, fuseau du compte, offre et prix en vigueur, événement de conversion réel (achat, inscription, demande), objectif et seuils de décision de l'utilisateur. Ne demander que ce qui manque et change la lecture. Ne jamais comparer à des coûts ou taux d'un autre projet sans le dire.

## Identifier la campagne avant tout chiffre

- Lire les campagnes du compte avec `read_meta` ou l'outil connecté découvert, et garder seulement celle dont le statut est actif pour la question posée.
- Traiter une campagne en pause, une copie en pause ou une ancienne campagne au nom proche comme de l'historique, jamais comme le résultat actuel.
- Citer le nom et l'identifiant lus de la campagne avant toute dépense, impression ou conversion.
- Si deux campagnes actives portent le même nom ou si le statut est ambigu, poser une seule question à l'utilisateur et attendre sa réponse.

## Séparer dépense et attribution

- Donner la fenêtre de dépense et la date d'attribution comme deux faits distincts dans chaque rapport.
- Ne présenter comme « aujourd'hui » que les conversions attribuées à aujourd'hui ; dater les autres.
- Dire quand l'attribution peut encore évoluer. Pour corriger un rapport, relire la même campagne sur la même fenêtre et citer les dates corrigées.

## Signaler les risques avant de juger

- Lister les annonces de la campagne active et repérer celles qui portent un ancien prix ou une ancienne offre.
- Comparer le prix affiché dans chaque annonce à celui de la page de destination (`read_page` quand elle est disponible).
- Présenter un écart de prix comme un risque à corriger avant de dépenser plus ; ne pas juger une campagne mélangée comme si toutes les annonces vendaient la même offre.

## Campagne protégée = alerte seulement

- Une campagne que l'utilisateur a marquée comme à ne jamais couper reste intacte : les seuils déclenchent une alerte, jamais une action.
- Toute modification (pause, budget, création) passe par l'approbation exacte avec `braand_connector_action`, budget et devise explicites.
- Présenter le rapport avec `present_response` (indicateurs, tableau) quand c'est utile, et terminer par une ou deux décisions concrètes.
