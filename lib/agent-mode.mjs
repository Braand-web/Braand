const autonomousToolNames = new Set(['response_formats','present_response','search_project_context','get_current_time','read_agent_guide','read_agent_context','explain_memory','get_analysis_result','get_source_project','search_workspace','get_workspace_resource','search_memory','search_conversation','read_meta','plan_mission','search_skills','read_skill','capabilities','get_work','get_routine','prepare_routine','social_accounts','get_publications','browser_capabilities','browser_session_result','get_video_edit_result','list_campaigns','list_publications','list_activity','performance_summary','find_projects','open_view','read_page','platform_specs']);
// Planning may draft a routine; an executing mission cannot replicate itself.
const missionToolNames = new Set([...autonomousToolNames].filter(name=>name!=='prepare_routine').concat(['analyze_data','save_source_project','export_deliverable','save_deliverable','revise_deliverable','create_page','revise_page','delegate_specialist','verify_deliverable','save_work_checkpoint','update_work_plan','prepare_media','plan_media','discover_media_models','enable_media_model','propose_media','research_web','read_web_source','inspect_media','assemble_media','prepare_video_edit']));
const missionConnectorNames = new Set(['COMPOSIO_SEARCH_TOOLS','COMPOSIO_GET_TOOL_SCHEMAS','braand_connector_status','braand_connector_receipt','braand_connector_action']);
// Autonomy permits bounded preparation and private deliverables. Every connected
// mutation still passes through the server-side proposal/approval mechanism.
const autonomousExecutionNames = new Set([...missionToolNames,'prepare_routine','request_project_reference','browser_plan','save_knowledge','revise_knowledge','forget_knowledge','save_campaign_plan','save_skill_candidate']);
export function agentToolsForMode(workMode, standardTools, connectorTools = []) {
 if(workMode==='autonomous')return [...standardTools.filter(tool=>autonomousExecutionNames.has(tool.name)),...connectorTools.filter(tool=>missionConnectorNames.has(tool.name))];
 if(workMode==='approved_mission')return [...standardTools.filter(tool=>missionToolNames.has(tool.name)),...connectorTools.filter(tool=>missionConnectorNames.has(tool.name))];
 return [...standardTools,...connectorTools];
}
export function agentToolAllowedForMode(workMode,toolName){return workMode==='autonomous'?autonomousExecutionNames.has(toolName)||missionConnectorNames.has(toolName):workMode==='approved_mission'?missionToolNames.has(toolName)||missionConnectorNames.has(toolName):workMode==='accompanied';}
