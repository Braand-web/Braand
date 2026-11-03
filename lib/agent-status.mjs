// UI observations only: no effect on authorization, tools, billing or the agent prompt.
/** @typedef {{messageId:string,state:string,detail?:string,startedAt:number,endedAt?:number}} AgentStatus */
/** @returns {AgentStatus} */
export function startAgentStatus(messageId, now = Date.now()) {
  return {messageId, state:'thinking', startedAt:now};
}
const toolStates = {
  analyze_data:['analyzing','Analyse des données'],
  get_analysis_result:['analyzing','Lecture du résultat calculé'],
  save_source_project:['writing','Préparation des fichiers source'],
  get_source_project:['analyzing','Lecture du projet source'],
  search_workspace:['analyzing','Lecture de votre projet'],
  get_workspace_resource:['analyzing','Vérification du résultat enregistré'],
  verify_deliverable:['analyzing','Vérification du livrable'],
  update_work_plan:['analyzing','Organisation du travail'],
  save_work_checkpoint:['analyzing','Enregistrement du contexte'],
  search_memory:['analyzing','Recherche du contexte utile'],
  search_conversation:['analyzing','Lecture des échanges précédents'],
  save_deliverable:['writing','Enregistrement du livrable'],
  read_meta:['analyzing','Lecture des données Meta'],
  create_page:['writing','Création de votre page'],
  revise_page:['writing','Modification de votre page'],
  media_catalog:['analyzing','Consultation des modèles média'],
  propose_media:['analyzing','Préparation du visuel'],
  prepare_video_edit:['analyzing','Préparation de votre montage'],
  assemble_media:['analyzing','Organisation des séquences'],
  get_video_edit_result:['analyzing','Vérification de votre vidéo'],
  inspect_media:['analyzing','Relecture de votre création'],
  plan_mission:['analyzing','Préparation de la mission'],
  COMPOSIO_SEARCH_TOOLS:['analyzing','Recherche des outils disponibles'],
  read_page:['analyzing','Lecture de la page produit'],
  platform_specs:['analyzing','Vérification des formats des plateformes'],
  list_campaigns:['analyzing','Lecture de vos campagnes'],
  list_publications:['analyzing','Lecture de vos publications'],
  list_activity:['analyzing','Lecture de votre activité'],
  performance_summary:['analyzing','Lecture de vos performances'],
  code_run:['analyzing','Exécution du code'],
  code_write_file:['writing','Écriture du code'],
  code_read_file:['analyzing','Lecture du code'],
  code_list_files:['analyzing','Exploration des fichiers'],
  code_reset:['analyzing','Réinitialisation de l’environnement de code'],
};
/** @param {AgentStatus|null} current @param {string} event @param {Record<string,unknown>} data @returns {AgentStatus|null} */
export function agentStatusEvent(current, event, data = {}, now = Date.now()) {
  if (!current || current.endedAt !== undefined) return current;
  if (event === 'done' || event === 'error' || event === 'cancelled') return {...current,state:event,detail:undefined,endedAt:now};
  if (event === 'text_delta' && typeof data.text === 'string' && data.text.length) return {...current,state:'writing',detail:undefined};
  if (event === 'verification_result') return {...current,state:'analyzing',detail:data.status==='structurally_verified'?'Structure du livrable contrôlée':'Vérification à compléter'};
  if (event === 'specialist_start' && typeof data.name === 'string' && data.name.trim()) return {...current,state:'analyzing',detail:data.name.trim().slice(0,60)+' travaille'};
  if (event === 'specialist_start') return {...current,state:'analyzing',detail:data.role === 'coding' ? 'Ingénieur logiciel' : data.role === 'creative' ? 'Spécialiste créatif' : data.role === 'campaigns' ? 'Spécialiste campagnes' : data.role === 'review' ? 'Vérification du livrable' : 'Analyse spécialisée'};
  if (event === 'tool_start') {
    const [state, detail] = typeof data.name === 'string' && Object.hasOwn(toolStates, data.name) ? toolStates[data.name] : ['analyzing','Utilisation d’un outil'];
    return {...current,state,detail};
  }
  if (['run','specialist_done','tool_result'].includes(event)) return {...current,state:'thinking',detail:undefined};
  return current;
}
