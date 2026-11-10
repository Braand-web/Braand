// Pure policy shared by the authenticated Worker boundary and administration.
export const PLATFORM_OWNER_IDS=['0301d63c-9f01-4181-bc06-1e1162d4908f'];
export function platformAdminIdsFrom(env={}) {
 return new Set([...PLATFORM_OWNER_IDS,...[env.OPS_ADMIN_IDS,env.BILLING_ADMIN_IDS].flatMap(value=>typeof value==='string'?value.split(','):[])].map(value=>value.trim()).filter(Boolean));
}
