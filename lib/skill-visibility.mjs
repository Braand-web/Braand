// A personal method is visible only to its author; team methods (and legacy
// ones without an owner) to every member of the workspace. Never across workspaces.
/** @param {Record<string,unknown>} data @param {string} userId */
export function skillHiddenFrom(data,userId){return data?.visibility==='personal'&&typeof data.ownerId==='string'&&data.ownerId!==userId;}
