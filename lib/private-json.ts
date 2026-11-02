import {AppError} from './core.mjs';
// Limit structure before recursive schema validation. The input byte ceiling
// alone does not prevent deeply nested or very large collections.
export function boundedJSONStructure(value:unknown):unknown{
 const pending:Array<{value:unknown;depth:number}>=[{value,depth:0}];let nodes=0;
 while(pending.length){const current=pending.pop()!;if(++nodes>50000||current.depth>64)throw new AppError('Structure de requête trop complexe.',413,'request_too_complex');
  if(current.value&&typeof current.value==='object'){
   const children=Object.values(current.value);if(children.length>10000)throw new AppError('Collection trop volumineuse.',413,'request_too_complex');
   for(const child of children)pending.push({value:child,depth:current.depth+1});
  }
 }
 return value;
}
// Bound bytes before parsing, including chunked requests without Content-Length.
export async function privateJSON(request:Request,limit=20000):Promise<unknown>{
 if(Number(request.headers.get('content-length')||0)>limit)throw new AppError('Requête trop volumineuse.',413,'request_too_large');
 const reader=request.body?.getReader();if(!reader)return {};
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw new AppError('Requête trop volumineuse.',413,'request_too_large');}chunks.push(part.value);}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}try{return boundedJSONStructure(size?JSON.parse(new TextDecoder().decode(bytes)):{});}catch(error){if(error instanceof AppError)throw error;throw new AppError('Requête invalide.',400,'invalid_json');}finally{bytes.fill(0);}}
 finally{for(const part of chunks)part.fill(0);reader.releaseLock();}
}
