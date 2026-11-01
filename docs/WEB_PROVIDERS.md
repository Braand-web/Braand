# Browserbase et Firecrawl

Le modèle principal choisit les outils. Browserbase ne fournit ici aucun raisonnement supplémentaire : le navigateur utilise le moteur Playwright existant via une adaptation privée du transport CDP. Firecrawl fournit la recherche publique et la lecture Markdown dans les outils existants.

## Secrets et déploiement en ligne

Un secret Cloudflare `WEB_PROVIDERS_JSON` contient les deux clés et leurs contrôles. Il n'est jamais exposé au client, à un outil du modèle ou à Git. Aucun identifiant de projet n'est demandé : l'API Browserbase infère son projet et le serveur le découvre pour consulter le quota. Deux secrets GitHub Actions alimentent la publication demandée. Les installations, fichiers temporaires, compilations et preuves restent dans le runner GitHub, sans nouvelle copie de travail locale.

La commande manuelle du workflow CI, sur `feat/browserbase-firecrawl`, avec `release_providers=true`, vérifie la révision complète, exécute les tests réels bornés, supprime le Worker de recette, publie l'artefact vérifié, puis active les fournisseurs. Les autres connexions et secrets restent conservés. Une preuve simulée ne remplace pas cette étape.

## Coûts et quotas

Le mode livré est `free_only`. Il ne déclenche aucun abonnement, achat de crédits, proxy payant, CAPTCHA automatique ou Model Gateway. Browserbase est borné à 60 minutes de quota d'équipe et à 300 secondes par session. L'usage fournisseur et les réservations simultanées du runtime sont vérifiés avant création. Les modèles restent facturés selon leur propre tarif et leur budget autorisé.

Firecrawl utilise seulement les recherches Web sans extraction et les lectures Markdown basiques. La limite est de 900 crédits par période de facturation, avec consultation du solde et refus d'un forfait dépassant la configuration gratuite. Les résultats mis en cache dans la conversation ne provoquent pas un nouvel appel. Les crédits fournisseur consommés sont journalisés séparément du coût monétaire, fixé à zéro dans ce mode. Le serveur conserve les réservations des appels incertains et ne les relance pas automatiquement.

La configuration de ces limites n'autorise pas un débit payant après épuisement. Pour une offre payante, il faudra définir et vérifier un tarif distinct, avec un budget explicite.

## Sécurité et continuité

Le même propriétaire Durable Object, le verrou de session, les approbations, les domaines autorisés, les captures masquées, les profils chiffrés et le coffre isolé sont conservés. Les enregistrements et logs Browserbase sont désactivés à la création. La clé et l'URL CDP restent en mémoire serveur. Les sessions persistantes Browserbase ne sont pas utilisées.

Un identifiant sérialisé porte le fournisseur ; il ne peut pas être rouvert silencieusement avec un autre moteur. Une perte du propriétaire arrête l'exécution et passe par la fermeture ou le rapprochement, sans nouvelle session automatique. Le reçu final repose sur les dates réellement renvoyées par le fournisseur.

Firecrawl ne reçoit ni cookie, ni identifiant de connexion, ni mot de passe, ni session de navigateur, ni script fourni par un modèle. Les URLs privées et les paramètres secrets sont rejetés. Le cache Firecrawl est désactivé pour les lectures ; le stockage interne existant reste limité à l'espace et à la conversation, avec source, date, empreinte et caractère non fiable. Cela n'est pas une promesse de zéro rétention contractuelle du fournisseur.

## Vérifications

Les tests unitaires contrôlent le transport, les quotas, l'absence de rejeu, les reçus et le refus d'un changement de fournisseur. L'intégration SQLite contrôle la recherche, la lecture, le cache, les montants et les erreurs. La recette réelle utilise uniquement une page fictive et `example.com` : navigation, clic, screencast CDP, remplissage fictif sans soumission, capture masquée et fermeture confirmée. Elle ne crée aucun compte client et n'appelle aucun modèle payant.

Les services gratuits ne garantissent pas l'accès aux sites protégés ni la résolution des CAPTCHA. Une authentification ou une autorisation manquante reste un blocage réel ; elle ne doit pas être présentée comme une action réussie.
