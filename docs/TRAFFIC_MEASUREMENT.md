# Trafic hors administration

La mesure `app / public-v2` remplace, pour les statistiques publiques de Braand,
les anciens compteurs `app / ''`. Les lignes historiques restent en base : on ne
peut pas soustraire des visiteurs administrateurs, des pays ou des provenances
que l'ancienne mesure ne distinguait pas. Elles ne sont pas mélangées aux nouveaux
totaux ni à leurs comparaisons. Sites publiés : mesure distincte inchangée.

## Exclusion

- `/admin`, ses sous-pages et `/api/admin` sont exclus systématiquement.
- Le Worker applique la liste d'administrateurs partagée avec l'administration
  uniquement après reconstruction de l'identité depuis la session serveur.
- Un administrateur reconnu reçoit `__Host-braand_internal_traffic=1`, témoin
  booléen sans identifiant, Secure, HttpOnly, SameSite=Lax, Path=/, pendant 90 jours.
  Ses consultations suivantes, y compris celles de la coque publique qui ne lit
  pas les sessions D1, sont exclues. Google le pose avant le retour dans Braand.
- Un utilisateur non administrateur authentifié efface ce témoin, pour les
  navigateurs partagés. Un administrateur qui consulte anonymement depuis un
  nouveau navigateur ne peut pas être identifié avant sa connexion ; aucune
  empreinte persistante, adresse IP administrative ou liste de pays ne le devine.
- Le témoin n'accorde aucun accès. Un visiteur qui le pose lui-même s'exclut
  seulement des statistiques. Les faux en-têtes d'identité ne sont jamais utilisés.
- HEAD, préchargements et robots reconnus n'ajoutent pas de visite.

## Période et interprétation

Les visiteurs sont dédupliqués par jour avec le mécanisme existant de sel quotidien
et d'empreinte éphémère ; IP brutes jamais enregistrées, empreintes et sels deux
jours. Le total est donc nommé « Visiteurs journaliers cumulés », pas visiteurs
uniques sur 30 jours. « Direct ou source inconnue » ne désigne pas des prospects
identifiés. Le filtre robots par user-agent n'est pas exhaustif.

Les inscriptions sont des compteurs journaliers anonymes, écrits dans la même
transaction que la création d'un nouvel utilisateur vérifié. Le nouvel UUID ne
correspond qu'à cette insertion : reconnexion, conflit concurrent et nouvelle
tentative ne doublent pas le compteur. Un navigateur déjà exclu ne l'incrémente
pas. Supprimer ensuite un compte ne réécrit pas ces totaux agrégés.

Le ratio indicatif est calculé exclusivement avec les inscriptions et visiteurs
`public-v2` des mêmes jours affichés. Ce n'est pas une attribution individuelle.
Aucun ratio n'est affiché sans visite. Les tendances de la période précédente
restent indisponibles tant que son début précède la nouvelle mesure.

## Vérification

`tests/traffic.test.mjs` couvre routes, témoin, requêtes normales et faux en-têtes.
`tests/admin-dashboard.integration.mjs` contrôle le stockage, la déduplication,
l'exclusion de l'ancien historique et les périodes sur SQLite isolé.
`tests/auth-runtime.integration.mjs` et `tests/auth-google.integration.mjs`
contrôlent le témoin serveur et les inscriptions sans accès fournisseur réel.

Aucun changement de l'accueil, des connexions disponibles, des rôles, des soldes
ou des comptes conservés n'est requis pour ce correctif.
