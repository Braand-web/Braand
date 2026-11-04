// Designed social and marketing visuals (PNG), rendered by Chromium from HTML.
// All text is escaped; only https or data images are allowed as background.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeImage=url=>/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)||/^https:\/\/[^\s"'<>()]+$/.test(url);

export const VISUAL_FORMATS={square:[1080,1080],portrait:[1080,1350],story:[1080,1920],banner:[1200,628],poster:[1240,1754]};
export const VISUAL_TEMPLATES=['announcement','quote','stat','list','promo'];

/**
 * @param {{template?:string,format?:string,kicker?:string,headline:string,body?:string,items?:string[],stat?:string,author?:string,cta?:string,accent?:string,background?:string,brandName?:string}} spec
 */
export function buildVisualHtml(spec){
 const [width,height]=VISUAL_FORMATS[spec.format]||VISUAL_FORMATS.square,template=VISUAL_TEMPLATES.includes(spec.template)?spec.template:'announcement';
 const accent=/^#[0-9a-f]{6}$/i.test(spec.accent||'')?spec.accent:'#2563eb',bg=spec.background&&safeImage(spec.background)?spec.background:'';
 const wide=width/height>1.4,tall=height/width>1.6,unit=Math.min(width,height)/1080*(tall?1.2:1);
 const size=n=>Math.round(n*unit)+'px';
 const headline=esc(spec.headline),len=String(spec.headline||'').length;
 const hSize=size(template==='quote'?(len>120?58:len>70?70:84):len>60?(wide?52:68):len>30?(wide?64:88):(wide?76:108));
 let main='';
 if(template==='quote')main=`<div class="mark">“</div><p class="quote">${headline}</p>${spec.author?`<p class="author">— ${esc(spec.author)}</p>`:''}`;
 else if(template==='stat')main=`<div class="stat">${esc(spec.stat||'')}</div><h1 class="headline">${headline}</h1>${spec.body?`<p class="body">${esc(spec.body)}</p>`:''}`;
 else if(template==='list')main=`<h1 class="headline">${headline}</h1><ol class="items">${(spec.items||[]).slice(0,6).map(item=>`<li><span>${esc(item)}</span></li>`).join('')}</ol>`;
 else main=`${spec.kicker?`<div class="kicker">${esc(spec.kicker)}</div>`:''}<h1 class="headline">${headline}</h1>${spec.body?`<p class="body">${esc(spec.body)}</p>`:''}`;
 return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap">
<style>
*{box-sizing:border-box;margin:0}html,body{width:${width}px;height:${height}px;overflow:hidden}
body{font-family:Manrope,'Helvetica Neue',Arial,sans-serif;color:#fff;position:relative;background:${bg?'#0b0c0f':`radial-gradient(circle at 80% 15%,${accent} 0%,transparent 55%),linear-gradient(160deg,#10131a,#05070b)`}}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:${wide?'linear-gradient(90deg,rgba(5,7,11,.92) 0%,rgba(5,7,11,.7) 55%,rgba(5,7,11,.15) 100%)':'linear-gradient(180deg,rgba(5,7,11,.15) 0%,rgba(5,7,11,.55) 45%,rgba(5,7,11,.93) 100%)'}}
.wrap{position:absolute;inset:0;padding:${size(tall?110:wide?60:80)} ${size(wide?70:80)};display:flex;flex-direction:column;justify-content:${template==='quote'||template==='stat'?'center':'flex-end'};gap:${size(26)};${wide?'max-width:68%;':''}}
.brand{position:absolute;top:${size(tall?90:56)};left:${size(wide?70:80)};font-weight:800;font-size:${size(30)};letter-spacing:-.02em;display:flex;align-items:center;gap:${size(12)}}
.brand i{width:${size(16)};height:${size(16)};border-radius:50%;background:${accent};display:inline-block}
.kicker{align-self:flex-start;background:${accent};font-weight:700;font-size:${size(26)};letter-spacing:.08em;text-transform:uppercase;padding:${size(10)} ${size(20)};border-radius:999px}
.headline{font-size:${hSize};font-weight:800;line-height:1.02;letter-spacing:-.035em;text-wrap:balance}
.body{font-size:${size(wide?28:34)};line-height:1.35;color:rgba(255,255,255,.86);font-weight:500;max-width:22em}
.mark{font-size:${size(220)};line-height:.6;color:${accent};font-weight:800;height:${size(110)}}
.quote{font-size:${hSize};font-weight:700;line-height:1.15;letter-spacing:-.02em;text-wrap:balance}
.author{font-size:${size(30)};color:rgba(255,255,255,.8);font-weight:600}
.stat{font-size:${size(wide?150:230)};font-weight:800;line-height:.9;letter-spacing:-.05em;color:${accent}}
.items{list-style:none;padding:0;display:grid;gap:${size(18)};counter-reset:n}
.items li{counter-increment:n;display:flex;gap:${size(22)};align-items:center;font-size:${size(34)};font-weight:600;line-height:1.25}
.items li::before{content:counter(n);flex:none;width:${size(58)};height:${size(58)};border-radius:50%;background:${accent};display:grid;place-items:center;font-weight:800;font-size:${size(28)}}
.cta{align-self:flex-start;background:#fff;color:#0b0c0f;font-weight:800;font-size:${size(30)};padding:${size(18)} ${size(34)};border-radius:999px;margin-top:${size(8)}}
</style></head><body>${bg?`<img class="bg" src="${esc(bg)}" alt=""><div class="shade"></div>`:''}${spec.brandName?`<div class="brand"><i></i>${esc(spec.brandName)}</div>`:''}<div class="wrap">${main}${spec.cta?`<div class="cta">${esc(spec.cta)}</div>`:''}</div></body></html>`;
}
