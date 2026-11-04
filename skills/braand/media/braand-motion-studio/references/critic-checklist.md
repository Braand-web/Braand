# Critique sur preuves rendues

Exécuter avec `code_run` dans le bac à sable après chaque rendu brouillon, puis après la passe finale.

```bash
# Planche-contact : 2 images par seconde, 6 par ligne
ffmpeg -i out/draft.mp4 -vf "fps=2,scale=320:-2,tile=6x5" -frames:v 1 reviews/contact.png
# Bande de 12 images consécutives autour du mouvement le plus rapide (ex. 7,2 s)
ffmpeg -ss 7.0 -i out/draft.mp4 -vf "select='lt(n\,12)',scale=240:-2,tile=12x1" -frames:v 1 reviews/strip.png
# Test téléphone : lisibilité à 360 px de large
ffmpeg -i out/draft.mp4 -vf "fps=1,scale=360:-2,tile=4x4" -frames:v 1 reviews/phone.png
# Boucle : le film joué deux fois de suite
ffmpeg -stream_loop 1 -i out/draft.mp4 -c copy reviews/loop.mp4
# Déterminisme : deux rendus du même instant doivent avoir la même empreinte
ffmpeg -ss 10 -i out/a.mp4 -frames:v 1 -f rawvideo -pix_fmt rgb24 - | sha256sum
ffmpeg -ss 10 -i out/b.mp4 -frames:v 1 -f rawvideo -pix_fmt rgb24 - | sha256sum
# Volume
ffmpeg -i out/final.mp4 -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input Integrated|Input True Peak"
```

Grille (1 à 10, juger les images rendues, pas l'intention) :

| Critère | Question |
|---|---|
| Accroche | Comprend-on qu'il se passe quelque chose avant 2 s ? |
| Lisibilité téléphone | Chaque texte se lit à 360 px, assez longtemps ? |
| Mouvement | Les éléments se posent-ils avec du poids, sans glisser ? |
| Variété | Du nouveau toutes les 2 à 4 s, sans temps mort ? |
| Son | Les changements tombent-ils sur les temps ? Le son tient-il seul ? |
| Marque | Couleurs, police, logo et écrans sont-ils exacts et réels ? |

Sortie attendue : les 3 pires défauts, chacun avec horodatage, preuve (image de la planche) et correction locale. Corriger, re-rendre ces secondes, recommencer jusqu'à 8 partout.
