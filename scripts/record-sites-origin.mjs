// Records the public address of the sites Worker so the app can show links.
// Reads `wrangler deploy` output on stdin and stores only an https workers.dev origin.
import {execFileSync} from 'node:child_process';
let input='';for await(const chunk of process.stdin)input+=chunk;
process.stdout.write(input);
const match=input.match(/https:\/\/braand-sites\.[a-z0-9-]+\.workers\.dev/);
if(!match)throw new Error('The sites Worker address was not found in the deploy output.');
const origin=new URL(match[0]).origin;
const sql=`CREATE TABLE IF NOT EXISTS platform_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO platform_settings(key,value,updated_at) VALUES ('sites_origin','${origin}',${Date.now()}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`;
execFileSync('npx',['--no-install','wrangler','d1','execute','aira-production','--remote','--config','.wrangler/deploy/sites.json','--command',sql],{stdio:'inherit'});
console.log('Sites address recorded: '+origin);
if(process.env.GITHUB_STEP_SUMMARY)(await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Sites publiés\n\n- Adresse : ${origin}\n`);
