export function assertProductionSource(candidate, annotation, isAncestor){
 if(!/^[a-f0-9]{40}$/.test(candidate||''))throw Error('A verified full source revision is required.');
 const live=String(annotation||'').match(/\b[a-f0-9]{40}\b/)?.[0];
 if(!live)throw Error('The live source revision is unknown; inspect production before replacing it.');
 if(!isAncestor(live,candidate))throw Error('Integrate the current production source before deploying; this build would discard live changes.');
 return live;
}

// Updating bindings/secrets can remove Cloudflare's version annotation without
// changing executable code. Recover provenance only from an identical script.
export function productionSourceAnnotation(current, history=[]){
 const annotation=current?.annotations?.['workers/message'];
 if(/\b[a-f0-9]{40}\b/.test(annotation||''))return annotation;
 const etag=current?.resources?.script?.etag;
 if(!/^[a-f0-9]{64}$/.test(etag||''))throw Error('The live source revision is unknown; no verified script fingerprint.');
 const match=history.find(version=>version?.resources?.script?.etag===etag&&/\b[a-f0-9]{40}\b/.test(version?.annotations?.['workers/message']||''));
 if(!match)throw Error('The live source revision is unknown; no matching annotated script.');
 return match.annotations['workers/message'];
}
