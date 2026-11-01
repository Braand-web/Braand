import {z} from 'zod';
import {authorize,db} from './server';
import {AppError} from './core.mjs';
import type {BillingIdentity} from './billing';
const choice=z.enum(['allow','ask','deny']);
export const browserPermissionSchema=z.object({visit:choice,submit:choice,download:choice,upload:z.enum(['ask','deny']),credentials:choice}).strict();
export type BrowserPermissions=z.infer<typeof browserPermissionSchema>;
const defaults:BrowserPermissions={visit:'ask',submit:'ask',download:'ask',upload:'ask',credentials:'ask'};
export async function getBrowserPermissions(who:BillingIdentity){
 const row=await db().prepare('SELECT visit,submit,download,upload,credentials,version FROM browser_permissions WHERE workspace_id=? AND user_id=?').bind(who.tenant,who.user.userId).first<BrowserPermissions&{version:number}>();
 return row||{...defaults,version:0};
}
// User settings API only; no agent dispatch exposes this mutation.
export async function setBrowserPermissions(who:BillingIdentity,input:unknown){
 await authorize(who.tenant,who.user.userId,'write');
 const {version,...values}=browserPermissionSchema.extend({version:z.number().int().nonnegative()}).parse(input);
 const current=await getBrowserPermissions(who);
 if(current.version!==version)throw new AppError('Ces permissions ont changé. Actualisez les réglages.',409,'stale_version');
 const result=version===0?await db().prepare('INSERT OR IGNORE INTO browser_permissions(workspace_id,user_id,visit,submit,download,upload,credentials,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(who.tenant,who.user.userId,values.visit,values.submit,values.download,values.upload,values.credentials,Date.now()).run():await db().prepare('UPDATE browser_permissions SET visit=?,submit=?,download=?,upload=?,credentials=?,version=version+1,updated_at=? WHERE workspace_id=? AND user_id=? AND version=?').bind(values.visit,values.submit,values.download,values.upload,values.credentials,Date.now(),who.tenant,who.user.userId,version).run();
 if(!result.meta.changes)throw new AppError('Ces permissions ont changé. Actualisez les réglages.',409,'stale_version');
 return getBrowserPermissions(who);
}
