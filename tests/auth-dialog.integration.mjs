import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..'),outfile=path.join(root,'.local-build/auth-dialog-test.mjs');
mkdirSync(path.dirname(outfile),{recursive:true});
await build({stdin:{contents:`
 import {createElement} from 'react';
 import {renderToStaticMarkup} from 'react-dom/server';
 import {SettingsPanel} from './components/settings-panel';
 import {EmailSignIn} from './components/email-sign-in';
 export const settings=props=>renderToStaticMarkup(createElement(SettingsPanel,props));
 export const login=()=>renderToStaticMarkup(createElement(EmailSignIn));
`,resolveDir:root,loader:'tsx'},outfile,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom/server','lucide-react'],loader:{'.css':'empty'},plugins:[{name:'isolate-settings-children',setup(builder){
 builder.onResolve({filter:/(?:connectors-panel|memory-panel|appearance-settings)$/},args=>({path:args.path,namespace:'child'}));
 builder.onLoad({filter:/.*/,namespace:'child'},()=>({contents:'export default function Child(){return null;} export const MemoryPanel=Child,AppearanceSettings=Child;',loader:'js'}));
}}]});
const ui=await import(pathToFileURL(outfile));
const base={tab:'general',onTabChange(){},onClose(){},onFiles(){},onRefresh(){}};
for(const tab of ['general','connections','skills','credits','billing','team','storage','permissions']) {
 const pending=ui.settings({...base,tab,sessionState:'loading',user:{id:'previous',name:'Previous account',email:'old@example.test'},billingContent:'Private billing content'});
 assert.match(pending,/Vérification de votre session/);
 assert.doesNotMatch(pending,/Se connecter|Se déconnecter|Previous account|old@example|Private billing content/);
 const failure=ui.settings({...base,tab,sessionState:'error'});
 assert.match(failure,/Réessayer/);assert.doesNotMatch(failure,/Se connecter|Connectez-vous/);
}
const anonymous=ui.settings({...base,sessionState:'anonymous'});
assert.match(anonymous,/Se connecter/);assert.doesNotMatch(anonymous,/Se déconnecter/);
const signedIn=ui.settings({...base,sessionState:'authenticated',user:{id:'current',name:'Current account',email:'current@example.test'}});
assert.match(signedIn,/Current account/);assert.match(signedIn,/Se déconnecter/);assert.doesNotMatch(signedIn,/Connectez-vous pour retrouver/);
for(const tab of ['help','legal']) assert.doesNotMatch(ui.settings({...base,tab,sessionState:'loading'}),/Vérification de votre session/);
const form=ui.login();
assert.match(form,/Vérification de votre session/);assert.match(form,/Gardons vos idées ensemble\./);assert.match(form,/créé automatiquement/);
assert.doesNotMatch(form,/type="email"|type="password"|Mot de passe|Créer un compte|Recevoir un lien/);
console.log('PASS: unresolved sessions never masquerade as signed-out accounts; sign-in is Google only and waits for its secure browser binding.');
