"use client";
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createChatSessions,createChatQueue,type ChatSlot} from '@/lib/chat-sessions';
export function useChatSessions<M,A,S>(scope:string){
 const [store]=useState(()=>createChatSessions<M,A,S>()),[queue]=useState(()=>createChatQueue());
 const slot=useSyncExternalStore(store.subscribe,()=>store.snapshot(scope),()=>store.snapshot(scope));
 const lifecycle=useRef({generation:0});
 // Strict Mode replays effect setup before this microtask. Only a real unmount
 // disposes the conversation store and aborts its owned streams.
 useEffect(()=>{const state=lifecycle.current,token=++state.generation;return()=>{queueMicrotask(()=>{if(state.generation===token)store.dispose();});};},[store]);
 const setters=useMemo(()=>{const set=<K extends keyof ChatSlot<M,A,S>>(field:K)=>(value:ChatSlot<M,A,S>[K]|((current:ChatSlot<M,A,S>[K])=>ChatSlot<M,A,S>[K]))=>store.update(slot.key,field,value);return {setReferenceProjectId:set('referenceProjectId'),setMessages:set('messages'),setConversationId:set('conversationId'),setBusy:set('busy'),setRunId:set('runId'),setActivity:set('activity'),setResponseStatus:set('responseStatus'),setDraft:set('draftInput'),setAttachments:set('attachments'),setError:set('error')};},[store,slot.key]);
 return {...slot,...setters,controller:slot.controller,responseInFlight:slot.inFlight,flushRef:slot.flush,newChat:(force=false,projectId:string|null=slot.projectId)=>store.newChat(scope,force,projectId),open:(id:string,messages?:M[],projectId?:string|null)=>store.open(scope,id,messages,projectId),openKey:(key:string)=>store.select(scope,key),isCurrent:()=>store.isCurrent(scope,slot.key),running:()=>store.running(scope),queue};
}
