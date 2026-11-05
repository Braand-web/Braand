// After a deploy: read the live assistant health and say which brain levels can answer.
// Fails when the assistant is not ready; a missing higher level is reported, not fatal.
import {appendFileSync} from 'node:fs';
const url=process.argv[2]||'https://braand.fun/api/health?check=assistant';
const response=await fetch(url,{headers:{Accept:'application/json'}});
const health=await response.json().catch(()=>({}));
const tiers=health.routing?.tiers||{},names={light:'Léger (Haiku)',standard:'Standard (Sonnet)',advanced:'Avancé (Opus)'};
const lines=[`### Cerveau de Braand en production`,'',`- Assistant prêt : ${health.assistantReady?'oui':'NON'}`,`- Routage : ${health.routing?.enabled?health.routing.policy:'désactivé'}`,`- Tarifs vérifiés : ${health.pricing||'inconnu'}${health.reason?` (${health.reason})`:''}`,...Object.entries(names).map(([key,label])=>`- ${label} : ${tiers[key]?'disponible':'indisponible'}`)];
console.log(lines.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
for(const key of ['standard','advanced'])if(health.routing?.enabled&&!tiers[key])console.log(`::warning::${names[key]} indisponible en production : les demandes lourdes resteront sur Haiku.`);
if(!response.ok||!health.assistantReady){console.log('::error::L’assistant n’est pas prêt en production.');process.exit(1);}
