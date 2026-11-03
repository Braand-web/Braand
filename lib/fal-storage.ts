// Upload a workspace library file to fal's CDN so a generation can use it as a
// reference (product photo, logo, face, style). Only files the workspace owns,
// in an image/video/audio type, below a size bound, are sent.
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {AppError,safeWebURL} from './core.mjs';
import {config,db} from './server';

const FAL_UPLOAD_URL='https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3';
const MAX_BYTES=25*1024*1024;
const ALLOWED=/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|x-wav|mp4|ogg))$/;

type FileRow={id:string;storage_key:string|null;detected_mime:string|null;size_bytes:number|null;display_name:string|null};

export async function uploadLibraryFileToFal(tenant:string,fileId:string){
 const key=config().FAL_KEY;if(!key)throw new AppError('Génération média non configurée.',503,'fal_not_ready');
 const file=await db().prepare("SELECT id,storage_key,detected_mime,size_bytes,display_name FROM files WHERE id=? AND workspace_id=? AND status='ready'").bind(fileId,tenant).first<FileRow>();
 if(!file?.storage_key)throw new AppError('Fichier de référence introuvable dans la bibliothèque.',404,'reference_not_found');
 const mime=String(file.detected_mime||'');
 if(!ALLOWED.test(mime))throw new AppError('Ce type de fichier ne peut pas servir de référence.',400,'reference_type');
 if(Number(file.size_bytes||0)>MAX_BYTES)throw new AppError('Fichier de référence trop volumineux (25 Mo maximum).',400,'reference_too_large');
 const object=await env.BUCKET?.get(file.storage_key);if(!object)throw new AppError('Fichier de référence indisponible.',404,'reference_not_found');
 const initiate=await fetch(FAL_UPLOAD_URL,{method:'POST',headers:{Authorization:'Key '+key,'Content-Type':'application/json'},body:JSON.stringify({content_type:mime,file_name:(file.display_name||'reference').slice(0,120)}),signal:AbortSignal.timeout(15000)});
 if(!initiate.ok)throw new AppError('fal.ai n’a pas accepté la référence.',502,'reference_upload_failed');
 const target=z.object({upload_url:z.string().url(),file_url:z.string().url()}).parse(await initiate.json());
 const put=await fetch(safeWebURL(target.upload_url),{method:'PUT',headers:{'Content-Type':mime},body:await object.arrayBuffer(),signal:AbortSignal.timeout(60000)});
 if(!put.ok)throw new AppError('L’envoi de la référence a échoué.',502,'reference_upload_failed');
 return safeWebURL(target.file_url) as string;
}
