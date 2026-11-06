"use client";
// What waits for the user's decision in this conversation and is not already
// shown in a message: actions raised later by a background mission, a browser
// started from the panel, publications or replies prepared earlier. Checked
// again every 15 s while the page is visible; a decided card stays in place.
import {useEffect,useState,type ReactNode} from "react";
import {api} from "@/lib/client-api";
import type {Resource} from "@/lib/contracts";
import {ConnectorActionCard,SocialBatchCard,SocialReplyCard} from "./approval-card";

type Decision={kind:"connector_action"|"proposal"|"social_batch"|"social_reply"|"browser_session";id:string};
type Props={conversationId:string|null;shownIds:Set<string>;refreshKey:unknown;renderProposal:(resource:Resource)=>ReactNode;renderBrowser:(id:string)=>ReactNode;onChange:()=>void};

function ResourceCard({id,render}:{id:string;render:(resource:Resource)=>ReactNode}){
 const [resource,setResource]=useState<Resource|null>(null);
 useEffect(()=>{let stop=false;api<Resource>("/api/resources/"+encodeURIComponent(id)).then(next=>{if(!stop)setResource(next);}).catch(()=>undefined);return()=>{stop=true;};},[id]);
 return resource?<>{render(resource)}</>:null;
}

export function ConversationDecisions({conversationId,shownIds,refreshKey,renderProposal,renderBrowser,onChange}:Props){
 const [state,setState]=useState<{conversationId:string|null;items:Decision[]}>({conversationId:null,items:[]});
 const items=state.conversationId===conversationId?state.items:[];
 useEffect(()=>{
  if(!conversationId)return;
  let stop=false,timer:ReturnType<typeof setTimeout>|undefined;
  const load=async()=>{
   try{
    const {decisions}=await api<{decisions:Decision[]}>("/api/decisions?conversationId="+encodeURIComponent(conversationId));
    if(stop)return;
    // Keep cards already shown (decided ones fold in place); add new ones in order.
    setState(current=>{const kept=current.conversationId===conversationId?current.items:[];const known=new Set(kept.map(item=>item.id));const added=decisions.filter(item=>!known.has(item.id));return added.length||current.conversationId!==conversationId?{conversationId,items:[...kept,...added]}:current;});
   }catch{/* Shown again on the next check. */}
   if(!stop)timer=setTimeout(()=>void load(),document.visibilityState==="hidden"?60000:15000);
  };
  void load();
  return()=>{stop=true;clearTimeout(timer);};
 },[conversationId,refreshKey]);
 const visible=items.filter(item=>!shownIds.has(item.id));
 if(!visible.length)return null;
 return <section className="conversation-decisions" aria-label="Décisions en attente dans cette discussion">
  {visible.map(item=>item.kind==="connector_action"?<ResourceCard key={item.id} id={item.id} render={resource=><ConnectorActionCard resource={resource} onUpdated={onChange}/>}/>
   :item.kind==="proposal"?<ResourceCard key={item.id} id={item.id} render={renderProposal}/>
   :item.kind==="social_batch"?<SocialBatchCard key={item.id} batchId={item.id} onUpdated={onChange}/>
   :item.kind==="social_reply"?<SocialReplyCard key={item.id} replyId={item.id} onUpdated={onChange}/>
   :<div key={item.id}>{renderBrowser(item.id)}</div>)}
 </section>;
}
