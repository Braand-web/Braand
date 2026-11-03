---
name: braand-video-editing
description: Monter une vidéo à partir des rushs, photos et musique de l'utilisateur avec FFmpeg dans le bac à sable - couper, recadrer pour chaque réseau, enchaîner avec transitions, sous-titrer, mixer voix et musique, exporter en H.264 conforme. Utile pour « monte ma vidéo », « fais un Reel avec ces clips » ou « ajoute des sous-titres ».
metadata:
  version: "1.0.0"
  author: "Braand"
  origin: "original"
---

# Montage vidéo avec FFmpeg

Méthode originale Braand pour le bac à sable. Toujours inspecter avant de couper, et vérifier après chaque rendu.

## Inspecter

`code_import_file` pour chaque fichier, puis `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of compact fichier`. Noter l'orientation, la cadence et la présence d'audio.

## Recettes

- **Couper précisément :** `ffmpeg -ss 00:00:03.2 -to 00:00:07.8 -i in.mp4 -c:v libx264 -crf 18 -preset medium -c:a aac out.mp4` (réencoder pour une coupe à l'image près).
- **Recadrer en 9:16 depuis du 16:9 :** `-vf "crop=ih*9/16:ih,scale=1080:1920"`. Pour ajouter des bandes floues au lieu de couper : `-filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20[bg];[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2"`.
- **Uniformiser avant d'enchaîner :** même taille, cadence (`fps=30`), `format=yuv420p`, `setsar=1`.
- **Enchaîner avec fondus :** `xfade=transition=fade:duration=0.4:offset=<durée du clip 1 - 0,4>` pour la vidéo, et `acrossfade=d=0.4` pour l'audio.
- **Photos en vidéo (Ken Burns) :** `-loop 1 -t 3 -i photo.jpg -vf "scale=2160:-2,zoompan=z='min(zoom+0.0015,1.15)':d=90:s=1080x1920:fps=30"`.
- **Sous-titres incrustés :** écrire un `.srt` (phrases de 2 lignes au plus, 32 caractères par ligne), puis `-vf "subtitles=subs.srt:force_style='FontName=Inter,FontSize=14,Bold=1,Outline=2,MarginV=120'"`.
- **Musique sous une voix :** `-filter_complex "[1:a]volume=0.25[m];[0:a][m]amix=inputs=2:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11"`.
- **Export final :** `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k`.

## Contrôler et livrer

Vérifier la durée, la taille et la présence audio avec `ffprobe`, extraire une image du milieu pour contrôler le cadrage, puis `code_export_file` avec un titre clair. Proposer les déclinaisons (16:9, 1:1, version sans musique, version sous-titrée).
