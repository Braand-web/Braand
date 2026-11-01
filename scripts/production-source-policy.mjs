export function assertProductionSource(candidate, annotation, isAncestor){
 if(!/^[a-f0-9]{40}$/.test(candidate||''))throw Error('A verified full source revision is required.');
 const live=String(annotation||'').match(/\b[a-f0-9]{40}\b/)?.[0];
 if(!live)throw Error('The live source revision is unknown; inspect production before replacing it.');
 if(!isAncestor(live,candidate))throw Error('Integrate the current production source before deploying; this build would discard live changes.');
 return live;
}
