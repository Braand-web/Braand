# Bac à sable de code (agents de codage)

Le spécialiste `coding` de Braand peut écrire, exécuter et tester du code dans un
environnement Linux isolé, puis corriger en boucle jusqu’au succès. Ce bac à sable
est un Worker Cloudflare séparé (`services/code-sandbox`) qui pilote des
[Cloudflare Containers](https://developers.cloudflare.com/containers/) via
`@cloudflare/sandbox` 1.0.3.

Sans ce service, rien ne change : le spécialiste écrit le code sans l’exécuter et
ne prétend jamais l’avoir lancé.

## Architecture

```
Worker principal ──(liaison de service CODE_SANDBOX + jeton)──▶ braand-code-sandbox-<env>
                                                                  └─ Durable Object CodeSandbox
                                                                       └─ conteneur Linux /workspace
```

- **Un conteneur par conversation** : le nom est un hachage opaque (espace + conversation), le
  service ne voit ni identifiant d’espace ni identifiant d’utilisateur.
- **Aucun secret** : pas de D1, pas de R2, pas de clé fournisseur, pas de variable d’environnement
  transmise au conteneur.
- **Internet fermé par défaut** (`CODE_SANDBOX_INTERNET=false`). Sans Internet, `npm install` et
  `pip install` échouent ; l’ouvrir est une décision explicite.
- **Image** : Node 24 (npm, pnpm via corepack), Python 3, pip, git, outils de compilation,
  sqlite3, jq, ripgrep.
- **Mise en veille** : un conteneur inactif s’arrête après 10 minutes ; `/workspace` est alors perdu.

## Outils exposés au spécialiste `coding`

| Outil | Rôle |
| --- | --- |
| `code_run` | Commande `sh -lc` dans `/workspace`, délai 1–300 s (60 s par défaut), sortie tronquée au milieu au-delà de 24 000 caractères |
| `code_write_file` | Crée ou remplace un fichier texte (512 Kio max) |
| `code_read_file` | Lit un fichier par tranches de 60 000 caractères |
| `code_list_files` | Liste un dossier |
| `code_reset` | Détruit le conteneur de la conversation |

Les chemins hors de `/workspace` sont refusés. Les commandes sont enveloppées par
`timeout -k 5`, qui arrête tout l’arbre de processus.

## Vidéo et motion design

L’image contient aussi FFmpeg, Chromium et les polices Inter et Noto (avec emoji). Le spécialiste `creative`
reçoit le bac à sable en plus du spécialiste `coding`.

| Outil | Rôle |
| --- | --- |
| `code_import_file` | Copie un fichier de l’espace (photo produit, logo, rushs, musique) dans `/workspace`, 200 Mio max |
| `render_motion` | Rend une composition HTML/CSS/JS en MP4 H.264 (yuv420p, faststart) ou en GIF, image par image avec une horloge virtuelle : animations CSS, Web Animations, `requestAnimationFrame` (GSAP, anime.js, canvas). Audio optionnel, normalisé à -14 LUFS |
| `code_export_file` | Livre un fichier fini dans la Bibliothèque, téléchargeable (100 Mio max pour les médias) et affiché dans la conversation |

Le moteur est `services/code-sandbox/motion/render-motion.mjs` (commande `render-motion` dans l’image). Il a été vérifié
localement : composition 1080×1920 de 4 s à 30 i/s rendue en MP4 H.264 conforme (`ffprobe`), avec textes décalés,
dégradé animé et produit piloté par `requestAnimationFrame` capturés aux bons instants. Compter environ 0,3 à 0,5 s
par image selon l’instance ; `quality: draft` accélère les essais.

Le montage (couper, recadrer, enchaîner, sous-titrer, mixer) passe par `code_run` avec FFmpeg.

## Limites par réponse

- 60 opérations de bac à sable et 900 secondes de commandes au total (`lib/code-sandbox.ts`).
- 18 tours de modèle pour le spécialiste `coding` quand le bac à sable est actif (4 sinon).
- Chaque opération est inscrite au journal d’audit (`sandbox.code_run`, etc.).

Le temps de conteneur n’est pas encore facturé en crédits Braand : seul l’usage du
modèle l’est. Le coût Cloudflare des conteneurs est à la charge de l’exploitant ;
ajustez le type d’instance en conséquence. Chaque conversation active peut garder un conteneur jusqu’à 10 minutes d’inactivité.

## Déploiement

Prérequis : forfait Workers Paid avec Containers, Docker sur la machine qui déploie,
Wrangler authentifié, en version 4.151.3 ou plus (la version du projet principal est trop
ancienne pour le format de conteneur du SDK 1.0).

1. Générer le manifeste isolé et désactivé :
   ```sh
   node services/code-sandbox/prepare-config.mjs staging
   ```
   Variables facultatives : `BRAAND_STAGING_CODE_SANDBOX_INSTANCE` (`lite`, `basic`, `standard-1`…`standard-4`, défaut `basic`),
   `BRAAND_STAGING_CODE_SANDBOX_INTERNET=true`.
2. Déployer le service (Docker construit l’image) :
   ```sh
   npx wrangler@4.151.3 deploy --config .wrangler/deploy/code-sandbox-staging.json
   ```
3. Créer un jeton aléatoire d’au moins 32 caractères et le poser sur **les deux** Workers
   (le Worker principal s’appelle `aira-staging` en staging et `aira-production` en production) :
   ```sh
   npx wrangler secret put CODE_SANDBOX_CALL_TOKEN --name braand-code-sandbox-staging
   npx wrangler secret put CODE_SANDBOX_CALL_TOKEN --name aira-staging
   ```
4. Relier le Worker principal : `BRAAND_STAGING_CODE_SANDBOX_SERVICE=braand-code-sandbox-staging`
   puis `npm run cloudflare:config -- staging` et redéployer le Worker principal.
5. Activer explicitement `CODE_SANDBOX_ENABLED=true` sur les deux Workers, après une recette.

Recette minimale : une demande de code dans le chat doit afficher « Exécution du code »,
le rapport doit citer des commandes et des codes de sortie réels, et une demande dans une
autre conversation ne doit pas voir les fichiers de la première.
