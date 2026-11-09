'use client';
import {useState} from 'react';
import type {Resource} from '@/lib/contracts';

export function DeliverableHistory({resource}:{resource:Resource}){
 const [version,setVersion]=useState<number|null>(null);
 const history=Array.isArray(resource.data.history)?resource.data.history.filter((item):item is {version:number;content:string}=>!!item&&typeof item==='object'&&typeof item.version==='number'&&typeof item.content==='string'):[];
 const previous=history.find(item=>item.version===version);
 if(!history.length)return null;
 return <details className="version-history"><summary>Historique · {history.length} version(s)</summary><label>Comparer avec <select aria-label="Version à comparer" value={version??''} onChange={event=>setVersion(event.target.value?Number(event.target.value):null)}><option value="">Choisir une version</option>{history.map(item=><option key={item.version} value={item.version}>Version {item.version}</option>)}</select></label>{previous&&<div className="atelier-version-comparison"><section><h3>Version {previous.version}</h3><pre>{previous.content}</pre></section><section><h3>Version {resource.version}</h3><pre>{String(resource.data.content||'')}</pre></section></div>}</details>;
}
