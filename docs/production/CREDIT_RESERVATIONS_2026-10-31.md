# Réservations de crédits — 31 octobre 2026

## Incident confirmé

Le chat réservait systématiquement son plafond de 10 crédits et le solde de la barre latérale n'explicitait pas la réservation. Une demande annulée restait réservée alors que son reçu authentifié fournissait un coût final : `cancelled: true`, `finish_reason: null`. Le rapprochement exigeait à tort un motif de fin non vide.

L'inspection de production n'a lu ni messages ni fichiers utilisateurs. Les identifiants de reçus et les secrets ne sont pas inclus dans ce document.

## Correction

- Accepter un reçu annulé explicitement par le fournisseur, avec identifiant concordant et coût numérique valide. Référence du contrat : [métadonnées de génération](https://openrouter.ai/docs/api/api-reference/generations/get-generation).
- Exiger une preuve de fin pour tout flux interrompu : une consommation intermédiaire n'est pas un coût final.
- Régulariser aussi les réservations des demandes terminées dont le Worker a pu s'arrêter après l'enregistrement du coût. Libérer les réservations anciennes sans demande ni consommation associée.
- Pour le chat, réserver au maximum le plus petit du plafond accepté et du solde disponible, au centième de crédit. La transaction et ses contraintes continuent d'empêcher les dépassements concurrents. Les réservations de générations média conservent leur montant exact obligatoire.
- Afficher séparément le disponible et le montant temporairement réservé. Rafraîchir toutes les cinq secondes pendant une réponse ou une réservation, lorsque l'onglet est visible.

Le rapprochement ne relance pas l'agent et n'invente ni coût ni remboursement. Un coût encore inconnu reste protégé jusqu'à sa confirmation. Le débit et la libération passent par le registre existant, une seule fois.

## Validation et livraison

Les tests de non-régression couvrent les reçus annulés sans motif de fin, les reçus encore incomplets, l'interruption avant régularisation, les petites fractions de solde, le plafond accepté, les réservations média et l'absence de double débit. Les tests navigateur couvrent l'affichage ordinateur/mobile et la mise à jour automatique après libération.

Déployer le build exact validé par le CI en préservant les ressources, bindings, variables, secrets, files et routes de production. Aucune migration de schéma ni modification de tarifs. Après publication, contrôler la santé, la préparation de l'assistant, les assets et la régularisation des anciennes réservations sur le registre de production. Aucun paiement ni nouvelle génération facturable n'est nécessaire à ces contrôles.
