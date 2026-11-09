'use client';
import {useEffect,useState} from 'react';
import type {Resource} from '@/lib/contracts';

export function ApplicationPreview({resource,onRestart}:{resource:Resource;onRestart:()=>void}){
 const [now,setNow]=useState(()=>Date.now()),[revision,setRevision]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
 let url:URL|null=null;try{url=new URL(String(resource.data.previewUrl));}catch{}
 const valid=url?.protocol==='https:'&&url.pathname.startsWith('/__preview/')&&url.origin!==window.location.origin;
 const expired=typeof resource.data.expiresAt!=='number'||resource.data.expiresAt<=now;
 if(!valid||expired)return <div className="resource-detail" role="status"><p>{expired?'L’aperçu a expiré. Relancez-le avec Braand.':'Cet aperçu ne peut pas être ouvert.'}</p><button type="button" className="button secondary" onClick={onRestart}>Relancer l’aperçu</button></div>;
 const embeddedUrl=new URL(url!.href);embeddedUrl.searchParams.set('embedded','1');
 return <section className="atelier-application" aria-label="Application en cours d’exécution"><div className="preview-toolbar"><button type="button" className="button small secondary" onClick={()=>setRevision(value=>value+1)}>Actualiser l’aperçu</button><a className="button small secondary" href={url!.href} target="_blank" rel="noopener noreferrer">Ouvrir à part</a></div><iframe key={revision} src={embeddedUrl.href} title={resource.title} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer"/><p className="atelier-preview-help">Application isolée · accès temporaire.</p></section>;
}
