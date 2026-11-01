"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Globe2,Keyboard,RefreshCw} from 'lucide-react';
import type {BrowserSessionDTO,HumanBrowserInput} from '@/lib/browser-contracts';
import {browserPoint} from '@/lib/browser-input.mjs';
import './browser-live-view.css';
type PageMeta={url:string;title:string;control:'human'|'agent';status:string;version:number};
export function BrowserLiveView({session,returning=false,onPage}:{session:BrowserSessionDTO;returning?:boolean;onPage?:(url:string)=>void}){
 const [connection,setConnection]=useState<'connecting'|'connected'|'reconnecting'|'unavailable'>('connecting'),[meta,setMeta]=useState<PageMeta>({url:session.url,title:session.title,control:session.control,status:session.status,version:session.version}),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const canvas=useRef<HTMLCanvasElement>(null),typing=useRef<HTMLTextAreaElement>(null),keyboardTrigger=useRef<HTMLButtonElement>(null),socket=useRef<WebSocket|null>(null),control=useRef({driver:session.control,version:session.version}),size=useRef({width:1280,height:720});
 const queue=useRef<HumanBrowserInput[]>([]),awaiting=useRef<number|null>(null),sequence=useRef(0),pageCallback=useRef(onPage),returningRef=useRef(returning);
 useEffect(()=>{pageCallback.current=onPage;},[onPage]);
 useEffect(()=>{returningRef.current=returning;if(returning){queue.current=[];typing.current?.blur();}},[returning]);
 const flush=useCallback(()=>{const ws=socket.current;if(ws?.readyState!==WebSocket.OPEN||awaiting.current!==null||!queue.current.length)return;const seq=++sequence.current,input=queue.current.shift();awaiting.current=seq;ws.send(JSON.stringify({type:'input',seq,version:control.current.version,input}));},[]);
 const send=useCallback((input:HumanBrowserInput)=>{if(control.current.driver!=='human'||returningRef.current||connection!=='connected')return;if(queue.current.length>=50){setError('La saisie attend la connexion. Patientez avant de continuer.');return;}queue.current.push(input);flush();},[connection,flush]);
 useEffect(()=>{const field=typing.current;return()=>{if(field)field.value='';};},[meta.control,returning]);
 useEffect(()=>{const surface=canvas.current;const wheel=(event:WheelEvent)=>{if(control.current.driver!=='human'||returningRef.current)return;event.preventDefault();send({kind:'scroll',deltaY:Math.round(Math.max(-10000,Math.min(10000,event.deltaY)))});};surface?.addEventListener('wheel',wheel,{passive:false});return()=>surface?.removeEventListener('wheel',wheel);},[send]);
 useEffect(()=>{
  let stopped=false,reconnect:ReturnType<typeof setTimeout>|undefined,tries=0,paint=0,hasFrame=false;
  const connect=()=>{
   if(stopped)return;const url=new URL('/api/browser/sessions/'+encodeURIComponent(session.id)+'/live',window.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
   const ws=new WebSocket(url);socket.current=ws;
   ws.onopen=()=>{if(stopped)return ws.close();tries=0;setConnection('connected');setError('');};
   ws.onmessage=event=>{
    if(stopped||typeof event.data!=='string'||event.data.length>3_100_000)return;
    try{
     const value=JSON.parse(event.data);
     if(value.type==='input_ack'){if(awaiting.current===value.seq){awaiting.current=null;flush();}return;}
     if(value.type==='input_error'){awaiting.current=null;queue.current=[];setError('Cette saisie n’a pas été confirmée. Vérifiez la page avant de la répéter.');return;}
     if(!['state','frame'].includes(value.type)||!['agent','human'].includes(value.control)||!Number.isInteger(value.version))return;
     control.current={driver:value.control,version:value.version};
     if(value.control!=='human'){queue.current=[];if(typing.current)typing.current.value='';}
     setMeta(previous=>{const next={url:value.url??previous.url,title:value.title??previous.title,control:value.control,status:value.status,version:value.version};return JSON.stringify(previous)===JSON.stringify(next)?previous:next;});
     if(value.type!=='frame'||typeof value.image!=='string'||!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.width>4096||value.height<1||value.height>4096)return;
     size.current={width:value.width,height:value.height};if(value.url)pageCallback.current?.(value.url);
     const image=new window.Image(),order=++paint;image.onload=()=>{if(stopped||order!==paint||!canvas.current)return;const surface=canvas.current;if(surface.width!==value.width)surface.width=value.width;if(surface.height!==value.height)surface.height=value.height;surface.getContext('2d')?.drawImage(image,0,0,value.width,value.height);hasFrame=true;};image.src='data:image/jpeg;base64,'+value.image;
    }catch{setError('Un événement de la session n’a pas pu être affiché.');}
   };
   ws.onclose=()=>{if(stopped)return;queue.current=[];awaiting.current=null;setConnection('reconnecting');if(++tries>5){setConnection('unavailable');return;}reconnect=setTimeout(connect,Math.min(1000*2**(tries-1),10000));};
   ws.onerror=()=>{if(!hasFrame)setError('La vue en direct n’est pas encore disponible. Votre session reste conservée.');};
  };
  connect();return()=>{stopped=true;clearTimeout(reconnect);queue.current=[];awaiting.current=null;socket.current?.close();socket.current=null;};
 },[session.id,attempt,flush]); // Reconnect to the same browser; never create or replay an action.
 const blocked=meta.status==='awaiting_login'&&meta.control==='agent',human=meta.control==='human'&&!returning;
 const label=returning?'Reprise : lecture de la page':human?'Vous pilotez le navigateur':blocked?'Intervention requise':'Session de l’agent';
 return <section className="browser-live" aria-label="Navigateur en direct">
  <header className="browser-live-header"><Globe2 size={16} aria-hidden="true"/><div><strong>{label}</strong><span>{meta.title||'Navigateur de cette session'}</span></div><span role="status">{connection==='connected'?'En direct':connection==='connecting'?'Ouverture de la vue…':connection==='reconnecting'?'Reconnexion…':'Vue indisponible'}</span></header>
  <div className="browser-live-url" title={meta.url}>{meta.url||'Aucune page ouverte'}</div>
  <p className="browser-live-objective">{session.objective}</p>
  <div className={'browser-live-surface'+(human?' browser-live-surface-human':'')}>
   <canvas ref={canvas} width={1280} height={720} aria-label={human?'Page distante sous votre contrôle':'Vue réelle de la page distante'} onPointerDown={event=>{if(!human)return;event.preventDefault();typing.current?.focus({preventScroll:true});send({kind:'pointer',...browserPoint(event.currentTarget.getBoundingClientRect(),event.clientX,event.clientY,size.current)});}}/>
   {human&&<textarea ref={typing} className="browser-live-keyboard" aria-label="Saisie privée dans le navigateur distant. Majuscule et Échap pour quitter la saisie." autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} onInput={event=>{if((event.nativeEvent as InputEvent).isComposing)return;const text=event.currentTarget.value;event.currentTarget.value='';if(text.length>4096){setError('Cette saisie dépasse la limite. Elle n’a pas été transmise.');return;}if(text)send({kind:'text',text});}} onCompositionEnd={event=>{const text=event.currentTarget.value;event.currentTarget.value='';if(text.length>4096){setError('Cette saisie dépasse la limite. Elle n’a pas été transmise.');return;}if(text)send({kind:'text',text});}} onKeyDown={event=>{if(event.key==='Escape'&&event.shiftKey){event.preventDefault();keyboardTrigger.current?.focus();return;}if(['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)){event.preventDefault();send({kind:'key',key:event.key});}}}/>}
  </div>
  <footer className="browser-live-footer">{human?<><span>Saisie privée · Maj + Échap pour quitter.</span><button ref={keyboardTrigger} type="button" onClick={()=>typing.current?.focus()}><Keyboard size={16} aria-hidden="true"/>Saisir au clavier</button></>:<span>Observation uniquement. Les clics sont ignorés.</span>}{connection==='unavailable'&&<button type="button" onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/>Reconnecter la vue</button>}</footer>
  {error&&<p className="browser-live-error" role="alert">{error}</p>}
 </section>;
}
