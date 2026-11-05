---
name: braand-dev-method
description: Construire un site, une application web ou un petit SaaS de bout en bout comme un développeur senior - comprendre le besoin, choisir la solution la plus simple, coder par petites étapes testées, vérifier l'aperçu sur ordinateur et mobile, puis publier après validation. Utile pour toute demande de site, page, app, outil interne, script ou automatisation en code.
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Méthode de développement Braand

Méthode originale Braand. Le but n'est pas d'écrire beaucoup de code, mais de livrer quelque chose qui marche, que l'utilisateur comprend et peut faire évoluer.

## 1. Comprendre avant de coder

- Reformuler en une phrase : pour qui, pour faire quoi, comment on saura que c'est réussi.
- Lire ce qui existe déjà : projet en cours, site publié, fichiers fournis, charte, textes et images réels.
- Poser une seule question si une inconnue change vraiment le résultat (public, langue, paiement, données personnelles). Sinon choisir l'hypothèse la plus raisonnable et l'annoncer.
- Ne jamais inventer : ni témoignages, ni chiffres, ni logos de clients, ni prix. Laisser un emplacement clairement marqué à compléter.

## 2. Choisir la forme la plus simple qui suffit

| Besoin | Forme recommandée |
| --- | --- |
| Présenter une activité, une offre, un événement, un portfolio | **Site statique** (HTML, CSS, un peu de JavaScript) publié sur Braand |
| Formulaire de contact, inscription, prise de rendez-vous simple | Site statique + formulaire relié aux prospects Braand |
| Calculatrice, simulateur, quiz, outil qui tourne dans le navigateur | Application front (JavaScript, éventuellement Vite) publiée comme un site |
| Comptes utilisateurs, base de données, paiements, tableau de bord multi-clients | Application complète : seulement si l'hébergement d'apps est disponible ou sur le compte de l'utilisateur |

- Préférer des technologies standard et stables. Pas de framework ni de dépendance sans raison concrète.
- Donner **une** recommandation motivée en une phrase ; ne présenter une alternative que si elle change vraiment le coût, le délai ou le résultat.

## 3. Plan court, puis petites étapes

- Écrire un plan de 3 à 7 étapes vérifiables (`update_work_plan` pour un travail long).
- Chaque étape se termine par une preuve : la page s'affiche, le test passe, la capture est correcte.
- Un gros projet passe en tâche de fond par étapes, avec un point à chaque étape importante.

## 4. Qualité attendue

- **Mobile d'abord** : lisible à 360 px de large, sans défilement horizontal, boutons d'au moins 44 px.
- **Accessibilité** : titres dans l'ordre, textes alternatifs, contrastes suffisants, navigation au clavier, étiquettes de formulaire.
- **Référencement de base** : titre et description par page, une seule balise h1, adresses lisibles, image de partage.
- **Performance** : images compressées et dimensionnées, pas de bibliothèque lourde pour un effet simple.
- **Sécurité** : aucun secret, mot de passe ou clé dans le code ; valider les entrées ; pas de script externe non nécessaire ; ne jamais imiter la page de connexion ou de paiement d'une marque.
- **Contenu** : textes dans la langue et le ton de l'utilisateur, avec ses vraies informations.

## 5. Vérifier avant d'annoncer

- Prévisualiser chaque page (ordinateur et mobile) et regarder les captures : mise en page, textes coupés, images manquantes.
- Vérifier les liens internes, les formulaires et la console (aucune erreur JavaScript).
- Si un contrôle échoue : le dire, trouver la cause, corriger, revérifier. Ne jamais annoncer « c'est en ligne » sans l'avoir constaté.
- Quand le bac à sable de code est disponible : installer, lancer les tests et le serveur d'aperçu dans `/workspace` ; sinon, dire clairement que le code n'a pas été exécuté.

## 6. Publier et livrer

- La mise en ligne passe toujours par la validation de l'utilisateur (carte de publication). Rappeler ce qui sera public.
- Livrer : l'adresse publique, ce qui a été vérifié, ce qui reste à compléter, et comment demander une modification.
- Après publication, une modification crée une nouvelle version ; la version en ligne ne change qu'après une nouvelle validation.
