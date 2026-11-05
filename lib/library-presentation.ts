import type {Resource} from './contracts';

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:'';
export function resourceImage(resource:Resource):string|null{
 const output=object(resource.data.output),images=Array.isArray(output.images)?output.images:[];
 const value=text(object(images[0]).url);
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export type LibraryCategory='creations'|'documents'|'files'|'pages';
export function libraryPresentation(resource:Resource){
 const mime=text(resource.data.mime),output=object(resource.data.output),format=text(resource.data.format);
 const video=Boolean(output.video)||Array.isArray(output.videos)&&output.videos.length>0||mime.startsWith('video/');
 const audio=Boolean(output.audio)||mime.startsWith('audio/');
 const image=Boolean(resourceImage(resource))||mime.startsWith('image/');
 const source=format==='source-project'||/zip|javascript|json/.test(mime);
 // Imported files keep their own tab; what Braand produced is a visual or a document.
 const category:LibraryCategory=resource.kind==='page'?'pages':resource.kind==='file'?'files':['media','proposal'].includes(resource.kind)||image||video||audio?'creations':'documents';
 const type=resource.kind==='page'?'Page':resource.kind==='proposal'?'Demande de création':video?'Vidéo':audio?'Audio':image?'Image':source?'Sources':mime==='application/pdf'?'PDF':resource.kind==='deliverable'?'Livrable':resource.kind==='file'?'Fichier':'Document';
 const title=text(resource.data.title)||resource.title;
 const sections=Array.isArray(resource.data.sections)?resource.data.sections:[];
 const excerpt=text(resource.data.summary)||text(resource.data.description)||text(object(sections[0]).heading)||text(resource.data.content)||text(resource.data.rationale);
 return {category,type,source,title,excerpt:excerpt.replace(/[#*`>]/g,'').trim().slice(0,360),mime,image:resourceImage(resource)};
}
export function libraryStatus(status:string){return ({draft:'Brouillon',ready:'Prêt',saved:'Enregistré',completed:'Terminé',awaiting_approval:'À valider',pending:'À valider',generating:'En création',failed:'Échec',unavailable:'Indisponible',rejected:'Refusé',uploading:'Envoi en cours',validating:'Vérification en cours'} as Record<string,string>)[status]||status;}
