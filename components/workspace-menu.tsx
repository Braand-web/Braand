'use client';

import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';

export type WorkspaceMenuItem={id:string;label:string;icon:ReactNode;onSelect:()=>void;active?:boolean;disabled?:boolean};

/** One native, keyboard-accessible disclosure instead of a persistent row of tabs. */
export function WorkspaceMenu({label,icon,items,className='',ariaLabel,searchable=false}:{label:string;icon:ReactNode;items:WorkspaceMenuItem[];className?:string;ariaLabel:string;searchable?:boolean}){
 const labelId=useId();
 const [query,setQuery]=useState('');
 const visibleItems=items.filter(item=>item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const [open,setOpen]=useState(false),[position,setPosition]=useState({top:0,left:0,width:224}),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const show=()=>{const bounds=trigger.current?.getBoundingClientRect();if(!bounds)return;const width=Math.min(280,Math.max(224,bounds.width),window.innerWidth-24),height=Math.min(420,items.length*40+16,window.innerHeight-24);setPosition({left:Math.max(12,Math.min(bounds.left,window.innerWidth-width-12)),top:bounds.bottom+height+8<=window.innerHeight?bounds.bottom+6:Math.max(12,bounds.top-height-6),width});setQuery("");setOpen(true);};
 const close=(focus=false)=>{setOpen(false);if(focus)requestAnimationFrame(()=>trigger.current?.focus());};
 useEffect(()=>{if(!open)return;const outside=(event:Event)=>{if(!root.current?.contains(event.target as Node)&&!menu.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&(root.current?.contains(document.activeElement)||menu.current?.contains(document.activeElement))){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};const resized=()=>setOpen(false);document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resized);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resized);};},[open]);
 return <div ref={root} className={'workspace-menu '+className}>
  <button ref={trigger} type="button" className="workspace-menu-trigger" title={label} aria-label={ariaLabel} aria-describedby={labelId} aria-expanded={open} onClick={()=>open?close():show()} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();show();requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());}}}>{icon}<span id={labelId}>{label}</span><ChevronDown size={13} aria-hidden="true"/></button>
  {open&&createPortal(<div ref={menu} className="workspace-menu-list" style={{position:'fixed',...position}} role="group" aria-label={ariaLabel} onKeyDown={event=>{const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);let next:number|undefined;if(event.key==='ArrowDown')next=(index+1)%buttons.length;else if(event.key==='ArrowUp')next=(index-1+buttons.length)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;if(next!==undefined&&buttons.length){event.preventDefault();buttons[next].focus();}}}>{searchable&&<input className="workspace-menu-search" aria-label="Rechercher un contenu" placeholder="Rechercher…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(["Home","End","ArrowLeft","ArrowRight"].includes(event.key))event.stopPropagation();}}/>}{visibleItems.map(item=><button key={item.id} type="button" disabled={item.disabled} aria-current={item.active?'page':undefined} onClick={()=>{close(true);item.onSelect();}}>{item.icon}<span>{item.label}</span></button>)}{!visibleItems.length&&<p role="status">Aucun contenu trouvé.</p>}</div>,document.body)}
 </div>;
}
