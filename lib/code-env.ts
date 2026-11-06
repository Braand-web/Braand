// Keys a user enters for a project running in the sandbox of one conversation
// (database URL, API keys…). Entered in a secure form, sealed at rest, written
// only to that sandbox's .env.local; never shown to the model or in the chat.
import {db, seal, unseal} from './server';
import {AppError} from './core.mjs';

const SCHEMA = 'CREATE TABLE IF NOT EXISTS code_env(workspace_id TEXT NOT NULL,conversation_id TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace_id,conversation_id))';
const NAME = /^[A-Z][A-Z0-9_]{1,80}$/;

export async function saveEnvValues(tenant: string, conversationId: string, values: Record<string, string>) {
 const clean = Object.entries(values).filter(([k, v]) => NAME.test(k) && typeof v === 'string' && v.length > 0);
 if (!clean.length || clean.length > 40 || clean.some(([, v]) => v.length > 4000)) throw new AppError('Clés invalides : 1 à 40 clés, en MAJUSCULES, valeurs de 4000 caractères au plus.', 400, 'env_invalid');
 await db().prepare(SCHEMA).run();
 const current = await loadEnvValues(tenant, conversationId);
 const sealed = await seal(JSON.stringify({...current, ...Object.fromEntries(clean)}));
 await db().prepare('INSERT INTO code_env(workspace_id,conversation_id,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(workspace_id,conversation_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(tenant, conversationId, sealed, Date.now()).run();
 return clean.map(([k]) => k);
}

export async function loadEnvValues(tenant: string, conversationId: string): Promise<Record<string, string>> {
 await db().prepare(SCHEMA).run().catch(() => undefined);
 const row = await db().prepare('SELECT data FROM code_env WHERE workspace_id=? AND conversation_id=?').bind(tenant, conversationId).first<{data: string}>().catch(() => null);
 if (!row) return {};
 try {return JSON.parse(await unseal(row.data));} catch {return {};}
}

export async function envKeyNames(tenant: string, conversationId: string) {return Object.keys(await loadEnvValues(tenant, conversationId));}
