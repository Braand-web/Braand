"use client";
import {useCallback,useEffect,useState} from 'react';
import {api,post} from '@/lib/client-api';
import {LoadingSkeleton} from "@/components/ds/loading";

type Approved={id:string;name:string;kind:string;tasks:string[];unit:string;maxUnits:number;quote?:{credits:number;verifiedAt:string}};
type Request={id:string;workspace_id:string;title:string;data:{endpointId:string;task:string;reason:string};created_at:number};
type Found={id:string;name:string;category?:string;description?:string;priceUsd?:number;priceUnit?:string;approved:boolean};
type Data={tasks:string[];approved:Approved[];requests:Request[];search?:Found[]};
const message=(error:unknown)=>error instanceof Error?error.message:'La demande a échoué. Réessayez.';
const defaultSchema=JSON.stringify({type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string',maxLength:4000},image_url:{type:'string',format:'uri'}}},null,2);

export default function MediaModelsAdmin(){
 const [data,setData]=useState<Data>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 const [form,setForm]=useState({id:'',name:'',kind:'image',tasks:'image',unit:'images',maxUnits:'1',description:'',inputSchema:defaultSchema,requestId:'',workspaceId:''});
 const load=useCallback(async(q='')=>{try{setData(await api<Data>('/api/admin/media-models'+(q?'?q='+encodeURIComponent(q):'')));setError('');}catch(e){setError(message(e));}},[]);
 useEffect(()=>{let active=true;api<Data>('/api/admin/media-models').then(result=>{if(active)setData(result);},e=>{if(active)setError(message(e));});return ()=>{active=false;};},[]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(message(e));}finally{setBusy(false);}};
 const pick=(id:string,name:string,task='image',request?:Request)=>setForm(current=>({...current,id,name,tasks:task,kind:task.startsWith('video_')?'video':task.startsWith('audio_')?'audio':'image',unit:task.startsWith('video_')?'seconds':task.startsWith('audio_')?'1000 characters':'images',requestId:request?.id||'',workspaceId:request?.workspace_id||''}));
 const approve=()=>run(async()=>{const model={id:form.id,name:form.name,kind:form.kind,tasks:form.tasks.split(',').map(t=>t.trim()).filter(Boolean),unit:form.unit,maxUnits:Number(form.maxUnits),description:form.description,inputSchema:JSON.parse(form.inputSchema)};const result=await api<{approved:Approved}>('/api/admin/media-models',post({action:'approve',model,requestId:form.requestId||undefined,workspaceId:form.workspaceId||undefined}));setNotice(`${result.approved.name} validé : ${result.approved.quote?.credits} crédits par génération au maximum.`);await load();});
 return <main className="billing-page" id="contenu">
  <header className="billing-heading"><div><h1>Modèles fal.ai</h1><p>Validez les modèles que les agents peuvent utiliser. Le prix est recalculé automatiquement depuis fal.</p></div><button className="button secondary" disabled={busy} onClick={()=>void load()}>Actualiser</button></header>
  {error&&<p className="billing-alert error" role="alert">{error}</p>}{notice&&<p className="billing-alert" role="status">{notice}</p>}
  {!data&&!error&&<LoadingSkeleton label="Chargement des modèles…" shape="table" count={5}/>}
  {data&&<>
   <h2 className="billing-subtitle">Demandes des agents</h2>
   {!data.requests.length?<p className="billing-empty">Aucune demande en attente.</p>:data.requests.map(request=><div className="billing-line" key={request.id}><div><strong>{request.data.endpointId}</strong><small>{request.data.task} · {new Date(request.created_at).toLocaleDateString('fr-FR')}</small><p>{request.data.reason}</p></div><div style={{display:'flex',gap:8}}><button className="button primary" disabled={busy} onClick={()=>pick(request.data.endpointId,request.data.endpointId,request.data.task,request)}>Préparer</button><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/api/admin/media-models',post({action:'reject',requestId:request.id,workspaceId:request.workspace_id}));await load();})}>Refuser</button></div></div>)}
   <h2 className="billing-subtitle">Rechercher dans fal.ai</h2>
   <form className="billing-field" onSubmit={event=>{event.preventDefault();void run(()=>load(query));}}><label htmlFor="fal-search">Besoin (ex. upscale, ugc avatar, lipsync)</label><div style={{display:'flex',gap:8}}><input id="fal-search" value={query} onChange={event=>setQuery(event.target.value)}/><button className="button secondary" disabled={busy||query.trim().length<2}>Rechercher</button></div></form>
   {data.search?.map(model=><div className="billing-line" key={model.id}><div><strong>{model.name}</strong><small>{model.id} · {model.category||'—'}{model.priceUsd!==undefined?` · ${model.priceUsd} $ / ${model.priceUnit}`:''}</small><p>{model.description}</p></div>{model.approved?<span>Validé</span>:<button className="button secondary" disabled={busy} onClick={()=>pick(model.id,model.name)}>Préparer</button>}</div>)}
   {form.id&&<section aria-labelledby="approve-title" style={{display:'grid',gap:12,marginTop:16}}>
    <h2 id="approve-title" className="billing-subtitle">Valider {form.id}</h2>
    <p className="billing-note">Bornez chaque quantité dans le schéma (durée, nombre d’images, longueur du texte) : le coût maximal est calculé à partir de l’unité de prix fal et du maximum indiqué.</p>
    <label className="billing-field">Nom<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label className="billing-field">Type<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="image">Image</option><option value="video">Vidéo</option><option value="audio">Audio</option></select></label>
    <label className="billing-field">Tâches (séparées par des virgules)<input value={form.tasks} onChange={e=>setForm({...form,tasks:e.target.value})} list="fal-tasks"/></label><datalist id="fal-tasks">{data.tasks.map(task=><option key={task} value={task}/>)}</datalist>
    <label className="billing-field">Unité de prix fal<select value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})}>{['images','megapixels','seconds','videos','1000 characters','units'].map(unit=><option key={unit}>{unit}</option>)}</select></label>
    <label className="billing-field">Quantité maximale par génération<input inputMode="decimal" value={form.maxUnits} onChange={e=>setForm({...form,maxUnits:e.target.value})}/></label>
    <label className="billing-field">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label className="billing-field">Schéma des paramètres (JSON)<textarea rows={10} value={form.inputSchema} onChange={e=>setForm({...form,inputSchema:e.target.value})} style={{fontFamily:'var(--font-mono)'}}/></label>
    <div style={{display:'flex',gap:8}}><button className="button primary" disabled={busy} onClick={()=>void approve()}>Valider le modèle</button><button className="button secondary" disabled={busy} onClick={()=>setForm({...form,id:''})}>Annuler</button></div>
   </section>}
   <h2 className="billing-subtitle">Modèles validés</h2>
   {!data.approved.length?<p className="billing-empty">Aucun modèle ajouté. Les modèles configurés côté serveur restent disponibles.</p>:data.approved.map(model=><div className="billing-line" key={model.id}><div><strong>{model.name}</strong><small>{model.id} · {model.tasks.join(', ')} · max {model.maxUnits} {model.unit}</small></div><div style={{display:'flex',gap:8,alignItems:'center'}}><span>{model.quote?`${model.quote.credits} crédits`:'Prix à vérifier'}</span><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/api/admin/media-models',post({action:'remove',id:model.id}));await load();})}>Retirer</button></div></div>)}
  </>}
 </main>;
}
