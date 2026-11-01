import {AppError} from './core.mjs';
// Bound bytes before parsing, including chunked requests without Content-Length.
export async function privateJSON(request:Request,limit=20000):Promise<unknown>{
 if(Number(request.headers.get('content-length')||0)>limit)throw new AppError('Requête trop volumineuse.',413,'request_too_large');
 const reader=request.body?.getReader();if(!reader)return {};
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw new AppError('Requête trop volumineuse.',413,'request_too_large');}chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}try{return size?JSON.parse(new TextDecoder().decode(bytes)):{};}catch{throw new AppError('Requête invalide.',400,'invalid_json');}finally{bytes.fill(0);}}
 finally{for(const part of chunks)part.fill(0);reader.releaseLock();}
}
