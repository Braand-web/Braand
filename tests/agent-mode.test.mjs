import assert from "node:assert/strict";
import test from "node:test";
import { agentToolAllowedForMode, agentToolsForMode } from "../lib/agent-mode.mjs";

const standardTools = [
  { name: "search_skills" },
  { name: "read_skill" },
  { name: "search_workspace" },
  { name: "get_workspace_resource" },
  { name: "read_meta" },
  { name: "plan_mission" },
  { name: "create_page" },
  { name: "propose_media" },
];
const connectorTools = [{ name: "COMPOSIO_SEARCH_TOOLS" }, { name: "braand_connector_action" }, { name: "braand_connector_status" }];

test("accompanied mode retains normal and connected tools", () => {
  assert.deepEqual(
    agentToolsForMode("accompanied", standardTools, connectorTools).map((tool) => tool.name),
    [...standardTools, ...connectorTools].map((tool) => tool.name),
  );
  assert.equal(agentToolAllowedForMode("accompanied", "braand_connector_action"), true);
});

test('an approved mission discovers guarded connected actions without acquiring sandbox, payment or approval rights',()=>{
 const names=['braand_connector_action','braand_connector_receipt','COMPOSIO_SEARCH_TOOLS','COMPOSIO_REMOTE_BASH_TOOL','braand_connect_toolkit','COMPOSIO_MULTI_EXECUTE_TOOL'];
 const selected=agentToolsForMode('approved_mission',[],names.map(name=>({name})));
 assert.deepEqual(selected.map(t=>t.name),names.slice(0,3));
 for(const name of names.slice(3))assert.equal(agentToolAllowedForMode('approved_mission',name),false);
 assert.equal(agentToolAllowedForMode('approved_mission','export_deliverable'),true);
});

test("autonomous mode can deliver private work through guarded tools", () => {
  assert.deepEqual(
    agentToolsForMode("autonomous", standardTools, connectorTools).map((tool) => tool.name),
    [...standardTools, ...connectorTools].map(tool=>tool.name),
  );
  assert.equal(agentToolAllowedForMode("autonomous", "plan_mission"), true);
  assert.equal(agentToolAllowedForMode("autonomous", "get_workspace_resource"), true);
  assert.equal(agentToolAllowedForMode("autonomous", "create_page"), true);
  assert.equal(agentToolAllowedForMode("autonomous", "braand_connector_action"), true);
  assert.equal(agentToolAllowedForMode("autonomous", "braand_connector_status"), true);
});

test('native computations and source exports keep the distinction between planning and approved work',()=>{
 for(const tool of ['analyze_data','save_source_project']){assert.equal(agentToolAllowedForMode('autonomous',tool),true);assert.equal(agentToolAllowedForMode('approved_mission',tool),true);assert.equal(agentToolAllowedForMode('accompanied',tool),true);}
 for(const tool of ['get_analysis_result','get_source_project'])assert.equal(agentToolAllowedForMode('autonomous',tool),true);
 for(const tool of ['run_shell','execute_code','deploy_app'])assert.equal(agentToolAllowedForMode('approved_mission',tool),false);
});

test('autonomy does not acquire approval, shell or raw connector execution rights',()=>{for(const tool of ['approve','publish_page','execute_code','run_shell','COMPOSIO_MULTI_EXECUTE_TOOL','COMPOSIO_REMOTE_BASH_TOOL'])assert.equal(agentToolAllowedForMode('autonomous',tool),false);});
