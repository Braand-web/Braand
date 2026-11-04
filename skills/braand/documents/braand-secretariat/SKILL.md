---
name: braand-secretariat
description: Produire les documents administratifs d'un bureau (ordre de mission, fiche de présence, bon de décaissement, attestation, note de service, demande de congé, courrier, journal de trésorerie) aux normes d'une entreprise d'Afrique francophone, remplis depuis la fiche entreprise.
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Secrétariat et documents administratifs

Méthode originale Braand pour faire gagner du temps à un secrétariat, un assistant administratif, une caisse ou un service RH, sans jamais inventer d'identifiant ni de signature.

## Adapter à l'entreprise de l'utilisateur

1. Lire `get_company_profile`. S'il n'existe pas, produire quand même le document demandé, puis proposer en une phrase d'enregistrer la fiche entreprise : raison sociale, adresse, ville, téléphone, e-mail, RCCM, NIU, logo (image de la bibliothèque), signataire (nom et fonction), personnel (nom, fonction, matricule).
2. N'enregistrer que ce que l'utilisateur fournit. Ne jamais inventer un RCCM, un NIU, un matricule, un montant ou un nom de signataire.
3. Une personne citée par son nom se cherche d'abord dans le registre du personnel : reprendre sa fonction et son matricule sans les redemander.
4. Adapter la devise, la ville et les formules au pays de l'entreprise ; par défaut FCFA sans décimales et dates JJ/MM/AAAA.

## Choisir le bon document et le bon format

| Besoin | Modèle `create_office_document` | Format conseillé |
|---|---|---|
| Suivre la caisse ou la banque | `journal_tresorerie` | xlsx |
| Pointer les présences du mois | `fiche_presence` | xlsx |
| Sortir de l'argent de la caisse | `bon_decaissement` | docx ou pdf (xlsx pour une série) |
| Envoyer un agent en déplacement | `ordre_mission` | docx ou pdf |
| Attester un emploi, un stage, une présence, une prestation | `attestation` | docx ou pdf |
| Informer le personnel | `note_service` | docx ou pdf |
| Demander un congé | `demande_conge` | docx |
| Écrire à un partenaire ou une administration | `courrier` | docx |

Word quand le document sera modifié ou signé à la main ; PDF quand il part tel quel ; Excel dès qu'il y a des calculs. `blank:true` donne un modèle vierge réutilisable ; Braand numérote automatiquement les documents remplis (BD-2026-001…).

## Règles métier à respecter

- **Bon de décaissement** : montant en chiffres et en lettres (Braand le calcule), motif précis, imputation, trois signatures (bénéficiaire, caissier, responsable). Rappeler de reporter le bon dans le journal de trésorerie avec le même numéro de pièce.
- **Journal de trésorerie** : un journal par compte (571 Caisse, 521 Banque selon le SYSCOHADA), solde initial obligatoire, une ligne par pièce justificative, entrée ou sortie jamais les deux. Le solde final doit égaler l'argent compté ou le relevé bancaire ; sinon chercher l'écart avant toute autre chose.
- **Fiche de présence** : codes P, A, R, C, M, F ; les retards comptent comme présences ; visa du responsable en bas.
- **Ordre de mission** : dates de départ et de retour, objet précis, frais pris en charge, visas à l'arrivée et au départ.
- **Attestation** : une page, texte sobre, « pour servir et valoir ce que de droit », signée par une personne habilitée. Ne produire une attestation que pour un fait que l'utilisateur déclare vrai ; refuser une attestation fausse ou au nom d'une autre structure.
- **Courrier** : référence, objet, formule d'appel et formule de politesse cohérentes.

## Livrer et faire gagner du temps

- Donner le lien de téléchargement, dire en une phrase ce que le fichier fait tout seul (« le solde se calcule à chaque ligne »).
- Proposer la suite logique : reporter le bon dans le journal, préparer la fiche du mois suivant, faire la même attestation pour une autre personne.
- Pour une série (plusieurs ordres de mission ou attestations), produire un document par personne.
