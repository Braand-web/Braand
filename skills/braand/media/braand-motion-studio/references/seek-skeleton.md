# Squelette de composition « seek »

Point de départ d'une composition rendue par `render_motion`. Tout l'affichage dépend uniquement du temps `t` (secondes) : le moteur appelle `window.__braandSeek(t)` pour chaque image et attend `window.__braandReady`. Aucune animation CSS, aucun minuteur, aucun `Math.random`.

Remplacer les valeurs entre crochets à partir du brief et du guide de style. Garder la structure : données des plans → fonctions pures → `paint(t)`.

```html
<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  @font-face{font-family:Display;src:url(assets/display.woff2)}   /* police de marque importée */
  html,body{margin:0;width:100vw;height:100vh;overflow:hidden;background:#0B0C0F} /* le moteur fixe la taille : 1080x1920, 1080x1080, 1920x1080… */
  #stage{position:absolute;inset:0;font-family:Display,sans-serif;color:#fff}
  #box{position:absolute;left:50%;top:50%;background:[ACCENT];will-change:transform}
  #title{position:absolute;left:8vw;right:8vw;top:14vh;font-size:min(11vw,9vh);font-weight:800;letter-spacing:-.03em;line-height:1.02}
  /* aucune transition, aucune animation : seek(t) dessine tout */
</style></head>
<body><div id="stage"><div id="box"></div><div id="title"></div></div>
<script>
// 1. Données du film : une liste d'états, chacun avec son temps d'entrée.
// Tailles en fraction du petit côté (U) : la même timeline sert tous les formats.
const W=innerWidth,H=innerHeight,U=Math.min(W,H);
const STATES=[
  {t:0.0, w:.17*U, h:.17*U, r:.085*U, color:'[ACCENT]', text:''},                // accroche : logo
  {t:2.0, w:.66*U, h:.13*U, r:.065*U, color:'[ACCENT]', text:'[PROBLÈME]'},       // le problème
  {t:5.0, w:.82*U, h:.52*U, r:.034*U, color:'#FFFFFF',  text:'[RÉVÉLATION]'},     // le produit entre
  {t:9.0, w:.82*U, h:.52*U, r:.034*U, color:'#FFFFFF',  text:'[PREUVE]'},         // une preuve réelle
  {t:13.0,w:.17*U, h:.17*U, r:.085*U, color:'[ACCENT]', text:'[APPEL À L’ACTION]'} // retour à l'état initial : boucle
];
// 2. Ressort analytique : fonction pure du temps écoulé (pas de simulation).
function spring(dt,{stiffness=170,damping=22}={}){ if(dt<=0) return 0;
  const w=Math.sqrt(stiffness), z=damping/(2*w);
  if(z<1){const wd=w*Math.sqrt(1-z*z);return 1-Math.exp(-z*w*dt)*(Math.cos(wd*dt)+z*w/wd*Math.sin(wd*dt));}
  return 1-Math.exp(-w*dt)*(1+w*dt);}
// Valeur qui change plusieurs fois de cible : un ressort par changement, additionnés.
function track(t,key,opts){let v=STATES[0][key];
  for(let i=1;i<STATES.length;i++) v+=(STATES[i][key]-STATES[i-1][key])*spring(t-STATES[i].t,opts);
  return v;}
// 3. Bruit à graine (déterministe) pour le grain ou les particules.
function noise(seed){let x=Math.sin(seed*12.9898)*43758.5453;return x-Math.floor(x);}
// 4. Peindre exactement l'image t.
const box=document.getElementById('box'), title=document.getElementById('title');
function paint(t){
  const i=STATES.findLastIndex(s=>s.t<=t), s=STATES[Math.max(0,i)];
  box.style.background=s.color;
  const enter=spring(t-s.t,{stiffness:260,damping:26});            // titre : arrive net, puis tient
  title.textContent=s.text; title.style.opacity=Math.min(1,enter); title.style.transform=`translateY(${(1-enter)*U*.04}px)`;
  const w=track(t,'w'), h=track(t,'h'), r=track(t,'r',{stiffness:120,damping:20});
  box.style.width=w+'px'; box.style.height=h+'px'; box.style.borderRadius=r+'px';
  // Toujours sous le titre, avec une marge, quel que soit le format.
  const below=title.getBoundingClientRect().bottom+U*.05, top=Math.max(H/2-h/2,below);
  box.style.transform=`translate(${-w/2}px,${top-H/2}px)`;
  document.body.style.backgroundPosition=`${noise(Math.floor(t*12))*4}px 0`; // grain discret, reproductible
}
window.__braandSeek=t=>paint(t);
window.__braandReady=document.fonts.ready.then(()=>paint(0));
</script></body></html>
```

Contrôles avant tout rendu long :
- `render_motion` en `quality: draft` sur 3 s ;
- l'image d'un même instant rendue deux fois doit être identique (empreinte égale) ;
- aucun texte ne sort du cadre au format le plus étroit.
