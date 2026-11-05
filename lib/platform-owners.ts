// Platform administrators, in a tiny module so any server code can check them
// without loading the administration. Worker variables are full, so the owner
// is declared in code; OPS_ADMIN_IDS / BILLING_ADMIN_IDS still add admins.
import {config} from './server';
export const PLATFORM_OWNER_IDS=['0301d63c-9f01-4181-bc06-1e1162d4908f'];
export function platformAdminIds(){const c=config();return new Set([...PLATFORM_OWNER_IDS,...[c.OPS_ADMIN_IDS,c.BILLING_ADMIN_IDS].flatMap(v=>(v||'').split(',')).map(v=>v.trim()).filter(Boolean)]);}
