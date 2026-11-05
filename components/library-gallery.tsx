'use client';

import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,AudioLines,Code2,FileText,Film,Folder,Globe,Image as ImageIcon,LayoutGrid,List,Pin,Plus,Search,Upload} from 'lucide-react';
import type {Resource} from '@/lib/contracts';
import {readBraandStorage} from '@/lib/client-storage';
import {libraryPresentation,libraryStatus,type LibraryCategory} from '@/lib/library-presentation';
import {useFilePreview} from './file-preview/file-preview-provider';
import {previewFileFromResource,statusLabel} from './file-preview/types';
import styles from './library-gallery.module.css';

export type LibraryTab='all'|LibraryCategory|'publications';
type Props={resources:Resource[];userId?:string;workspaceId?:string;loading:boolean;filePreviewEnabled:boolean;category?:string;onCategory?:(tab:LibraryTab)=>void;onOpen:(resource:Resource)=>void;onImport:()=>void;onAsk:(prompt:string)=>void};
const kinds=['file','media','proposal','deliverable','page'];
const TABS:[LibraryTab,string][]=[['all','Tout'],['creations','Visuels'],['documents','Documents'],['files','Fichiers'],['pages','Pages'],['publications','Publications']];
const EMPTY:Record<LibraryTab,{title:string;body:string;action:string;prompt?:string}>={
 all:{title:'Tout commence par une idée',body:'Les visuels, documents et pages créés dans vos discussions, et les fichiers importés, apparaîtront ici.',action:'Créer avec Braand',prompt:'Je souhaite créer un nouveau contenu ou livrable. Aide-moi à préciser le résultat attendu et le format avant de commencer.'},
 creations:{title:'Vos visuels prendront place ici',body:'Images, vidéos et affiches créées avec Braand, prêtes à être utilisées.',action:'Créer un visuel',prompt:'Je voudrais créer un visuel pour mon entreprise.'},
 documents:{title:'Aucun document pour le moment',body:'Rapports, devis, présentations et livrables préparés par Braand.',action:'Faire un document',prompt:'Je souhaite préparer un document. Aide-moi à préciser le format et le contenu.'},
 files:{title:'Vos fichiers, au même endroit',body:'Importez les documents et médias qui aideront Braand à comprendre votre entreprise.',action:'Importer un fichier'},
 pages:{title:'Une page. Une prochaine étape.',body:'Présentez votre offre et donnez à vos visiteurs une bonne raison de vous contacter.',action:'Créer une page',prompt:'Aide-moi à créer une page de destination pour mon offre.'},
 publications:{title:'',body:'',action:''},
};
const UNFINISHED=new Set(['draft','awaiting_approval','pending','generating','failed','unavailable','rejected','uploading','validating']);
const date=(at:number)=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short'}).format(at);
const DAY=86_400_000;
function period(at:number,now:number){const start=new Date(now);start.setHours(0,0,0,0);if(at>=start.getTime())return 'Aujourd’hui';if(at>=start.getTime()-6*DAY)return 'Cette semaine';if(at>=start.getTime()-29*DAY)return 'Ce mois-ci';return 'Plus ancien';}
function readPins(key:string|null):string[]{if(!key)return [];try{const value:unknown=JSON.parse(readBraandStorage(key)||'[]');return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&id.length<=160).slice(0,200):[];}catch{return [];}}
function readChoice<T extends string>(key:string,allowed:readonly T[],fallback:T):T{const value=readBraandStorage(key);return allowed.includes(value as T)?value as T:fallback;}
function remember(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* private mode: keep the choice for this visit only */}}

function Cover({resource,filePreviewEnabled}:{resource:Resource;filePreviewEnabled:boolean}){
 const info=libraryPresentation(resource),{getSignedUrl}=useFilePreview(),root=useRef<HTMLDivElement>(null);
 const [signed,setSigned]=useState<string|null>(null),[failed,setFailed]=useState<string|null>(null);
 const raster=resource.kind==='file'&&['image/png','image/jpeg','image/webp'].includes(info.mime)&&resource.status==='ready';
 useEffect(()=>{
  if(!raster||!filePreviewEnabled)return;
  let disposed=false,started=false;
  const load=()=>{if(started)return;started=true;void getSignedUrl(resource.id,'thumbnail').then(url=>{if(!disposed)setSigned(url);}).catch(()=>{});};
  const element=root.current;
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();load();}},{rootMargin:'160px'});
  if(element&&observer)observer.observe(element);else load();
  return()=>{disposed=true;observer?.disconnect();};
 },[resource.id,raster,filePreviewEnabled,getSignedUrl]);
 const image=info.image||(raster?(filePreviewEnabled?signed:`/api/files?id=${encodeURIComponent(resource.id)}&preview=thumbnail`):null);
 const Icon=resource.kind==='page'?Globe:info.type==='Vidéo'?Film:info.type==='Audio'?AudioLines:info.type==='Image'?ImageIcon:info.source?Code2:FileText;
 const unfinished=UNFINISHED.has(resource.status);
 return <div ref={root} className={styles.cover} data-kind={resource.kind}>
  <Icon size={20} strokeWidth={1.5} className={styles.listIcon}/>
  {image&&failed!==image?<Image src={image} alt="" width={640} height={480} unoptimized loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(image)}/>:resource.kind==='page'?<div className={styles.pagePreview}><span>{resource.title}</span><strong>{info.excerpt||'Page enregistrée'}</strong></div>:info.excerpt&&['deliverable','proposal'].includes(resource.kind)?<div className={styles.documentPreview}><span>{info.type}</span><strong>{resource.title}</strong><p>{info.excerpt}</p></div>:<div className={styles.typePreview}><Icon size={28} strokeWidth={1.4}/><span>{info.type}</span></div>}
  {unfinished&&<span className={styles.status} data-status={resource.status}>{libraryStatus(resource.status)}</span>}
 </div>;
}

export default function LibraryGallery({resources,userId,workspaceId,loading,filePreviewEnabled,category='all',onCategory,onOpen,onImport,onAsk}:Props){
 const {openPreview}=useFilePreview(),storageKey=userId&&workspaceId?`braand.library.pins:${userId}:${workspaceId}`:null;
 const tab:LibraryTab=TABS.some(([id])=>id===category)?category as LibraryTab:'all';
 const [now]=useState(()=>Date.now()),[query,setQuery]=useState(''),[view,setView]=useState<'grid'|'list'>(()=>readChoice('braand.library.view',['grid','list'] as const,'grid')),[sort,setSort]=useState<'recent'|'name'>(()=>readChoice('braand.library.sort',['recent','name'] as const,'recent')),[pins,setPins]=useState(()=>readPins(storageKey)),[notice,setNotice]=useState('');
 const items=resources.filter(resource=>kinds.includes(resource.kind)&&resource.status!=='deleted'&&(!workspaceId||resource.workspace_id===workspaceId));
 const counts=items.reduce<Record<string,number>>((all,resource)=>{const key=libraryPresentation(resource).category;all[key]=(all[key]||0)+1;return all;},{});
 const needle=query.trim().toLocaleLowerCase('fr');
 const visible=items.filter(resource=>(tab==='all'||libraryPresentation(resource).category===tab)&&(`${resource.title} ${libraryPresentation(resource).type}`).toLocaleLowerCase('fr').includes(needle)).sort((a,b)=>sort==='name'?a.title.localeCompare(b.title,'fr'):b.updated_at-a.updated_at||a.id.localeCompare(b.id));
 const fileIds=items.filter(resource=>resource.kind==='file'&&resource.status==='ready').map(resource=>resource.id);
 const pinned=visible.filter(resource=>pins.includes(resource.id));
 // Pinned items lead; the rest is grouped by when it last changed (or A→Z when sorted by name).
 const rest=visible.filter(resource=>!pins.includes(resource.id));
 const groups:{label:string;items:Resource[]}[]=[];
 if(pinned.length)groups.push({label:'Épinglés',items:pinned});
 if(sort==='name'){if(rest.length)groups.push({label:pinned.length?'Autres ressources':'Toutes les ressources',items:rest});}
 else for(const resource of rest){const label=period(resource.updated_at,now),last=groups.at(-1);if(last&&last.label===label)last.items.push(resource);else groups.push({label,items:[resource]});}
 const togglePin=(resource:Resource)=>{setPins(current=>{const next=current.includes(resource.id)?current.filter(id=>id!==resource.id):[resource.id,...current].slice(0,200);if(storageKey)remember(storageKey,JSON.stringify(next));return next;});setNotice(pins.includes(resource.id)?'Ressource retirée des épinglés.':'Ressource épinglée sur cet appareil.');};
 const open=(resource:Resource)=>{if(resource.kind==='file'&&filePreviewEnabled)openPreview(resource.id,{contextFileIds:fileIds});else onOpen(resource);};
 const create=()=>onAsk(EMPTY.all.prompt!);
 const empty=EMPTY[tab],emptyAction=()=>{if(tab==='files'||!empty.prompt)onImport();else onAsk(empty.prompt);};
 const summary=[[counts.creations,'visuel'],[counts.documents,'document'],[counts.files,'fichier'],[counts.pages,'page']].filter(([n])=>n).map(([n,word])=>`${n} ${word}${Number(n)>1?'s':''}`).join(' · ');
 return <div className={styles.gallery} data-library-gallery>
  <header className={styles.header}><div><h1>Bibliothèque</h1><p>{items.length?summary:'Vos créations, documents et fichiers, au même endroit.'}</p></div><div className={styles.actions}><button type="button" className="button secondary" onClick={onImport}><Upload size={16}/>Importer</button><button type="button" className="button primary" onClick={create}><Plus size={16}/>Créer</button></div></header>
  <nav className={styles.tabs} aria-label="Sections de la bibliothèque">{TABS.map(([id,label])=>{const count=id==='all'?items.length:id==='publications'?0:counts[id]||0;return <button type="button" key={id} aria-current={tab===id?'page':undefined} onClick={()=>onCategory?.(id)}>{label}{count>0&&<span className={styles.count} aria-hidden="true">{count}</span>}</button>;})}</nav>
  <div className={styles.toolbar}><label className={styles.search}><Search size={17}/><input type="search" aria-label="Rechercher dans la bibliothèque" placeholder="Rechercher par nom ou type" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className={styles.tools}><select aria-label="Trier la bibliothèque" value={sort} onChange={event=>{const next=event.target.value==='name'?'name':'recent';setSort(next);remember('braand.library.sort',next);}}><option value="recent">Récemment modifiés</option><option value="name">Nom</option></select><div className={styles.viewSwitch} role="group" aria-label="Présentation de la bibliothèque"><button type="button" aria-label="Vue galerie" aria-pressed={view==='grid'} onClick={()=>{setView('grid');remember('braand.library.view','grid');}}><LayoutGrid size={16}/></button><button type="button" aria-label="Vue liste" aria-pressed={view==='list'} onClick={()=>{setView('list');remember('braand.library.view','list');}}><List size={17}/></button></div></div></div>
  <p className={styles.srOnly} role="status" aria-live="polite">{notice}</p>
  {loading?<div className={styles.skeleton} role="status" aria-label="Chargement de la bibliothèque">{[0,1,2,3,4,5,6,7].map(index=><div key={index}/>)}</div>:visible.length?groups.map(group=><section key={group.label} className={styles.group} aria-label={group.label}>
   <h2 className={styles.groupLabel}>{group.label==='Épinglés'&&<Pin size={13}/>}{group.label}<span>{group.items.length}</span></h2>
   <div className={view==='grid'?styles.grid:styles.list} role="list" aria-label={'Ressources : '+group.label}>{group.items.map(resource=>{const info=libraryPresentation(resource),file=resource.kind==='file'?previewFileFromResource(resource):null,disabled=!!file&&file.status!=='ready',isPinned=pins.includes(resource.id);return <article key={resource.id} className={styles.item} role="listitem" data-library-resource data-kind={resource.kind} data-pinned={isPinned||undefined}>
    <button type="button" className={styles.open} onClick={()=>open(resource)} disabled={disabled} aria-label={'Ouvrir '+resource.title} title={resource.title}><Cover resource={resource} filePreviewEnabled={filePreviewEnabled}/><span className={styles.copy}><strong>{resource.title}</strong><span>{info.type}{file&&file.status!=='ready'?' · '+statusLabel(file.status):''} · <time dateTime={new Date(resource.updated_at).toISOString()}>{date(resource.updated_at)}</time></span></span>{view==='list'&&<ArrowUpRight size={16} className={styles.openArrow}/>}</button>
    <button type="button" className={styles.pin} aria-label={(isPinned?'Désépingler ':'Épingler ')+resource.title} aria-pressed={isPinned} onClick={()=>togglePin(resource)}><Pin size={15}/></button>
   </article>;})}</div>
  </section>):<section className={styles.empty}><Folder size={28} strokeWidth={1.4}/><h2>{needle?'Aucune correspondance':empty.title}</h2><p>{needle?'Essayez un autre mot, ou cherchez dans tous les onglets.':empty.body}</p>{needle?<button type="button" className="button secondary" onClick={()=>{setQuery('');onCategory?.('all');}}>Voir toutes les ressources</button>:<div className={styles.actions}>{tab!=='files'&&<button type="button" className="button secondary" onClick={onImport}><Upload size={15}/>Importer un fichier</button>}<button type="button" className="button primary" onClick={emptyAction}>{empty.action}<ArrowUpRight size={15}/></button></div>}</section>}
 </div>;
}
