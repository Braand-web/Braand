// Platform administrators, in a tiny module so any server code can check them
// without loading the administration. Worker variables are full, so the owner
// is declared in code; OPS_ADMIN_IDS / BILLING_ADMIN_IDS still add admins.
import {config} from './server';
import {platformAdminIdsFrom} from './platform-owner-ids.mjs';
export {PLATFORM_OWNER_IDS} from './platform-owner-ids.mjs';
export function platformAdminIds(){return platformAdminIdsFrom(config());}
