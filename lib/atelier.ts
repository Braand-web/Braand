import type {Resource} from './contracts';

/** References in the current discussion are explicit access paths, not project defaults. */
export function atelierResources(resources:Resource[],projectId:string|null,referencedIds:Set<string>){
 return resources.filter(resource=>resource.status!=='deleted'&&(
  referencedIds.has(resource.id)||(typeof resource.data.projectId==='string'?resource.data.projectId:null)===projectId
 ));
}

/** Only the annotation bridge runs. Generated scripts and network requests stay blocked. */
export function annotatedPage(html:string,token:string){
 const nonce=token.replace(/[^a-zA-Z0-9-]/g,'');
 const policy=`default-src 'none'; img-src https: data: blob:; style-src https: 'unsafe-inline'; font-src https: data:; script-src 'nonce-${nonce}'; connect-src 'none'; form-action 'none'; base-uri 'none';`;
 const bridge=`document.addEventListener('click',function(e){e.preventDefault();var node=e.target;if(!(node instanceof Element))return;var selected=String(window.getSelection()||'').trim();var path=[],cursor=node;while(cursor&&cursor!==document.body&&path.length<8){var tag=cursor.localName,index=Array.from(cursor.parentElement?.children||[]).filter(function(n){return n.localName===tag}).indexOf(cursor)+1;path.unshift(tag+':nth-of-type('+index+')');cursor=cursor.parentElement;}parent.postMessage({type:'braand-preview-selection',token:${JSON.stringify(nonce)},text:(selected||node.textContent||node.getAttribute('alt')||'').trim().slice(0,2000),target:path.join(' > ')},'*');},true);`;
 return `<meta http-equiv="Content-Security-Policy" content="${policy}">`+html+`<script nonce="${nonce}">${bridge}</script>`;
}
