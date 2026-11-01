import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(path.join(project, "tests")).sort();
const artifactTests = ["file-preview-bundle.test.mjs", "worker-config.test.mjs", "composio-bundle.integration.mjs", "skills-bundle.integration.mjs"];
const httpSuites = new Map([
  ["run-http-integration.mjs", ["http.integration.mjs", "composio-http.integration.mjs"]],
  ["run-file-upload-integration.mjs", ["file-preview.integration.mjs"]],
]);
const httpTests = [...httpSuites.values()].flat();
for (const file of [...artifactTests, ...httpSuites.keys(), ...httpTests]) {
  assert.ok(files.includes(file), `Missing registered test: ${file}`);
}
for (const file of files.filter(name => /^run-.*-integration\.mjs$/u.test(name))) {
  assert.ok(httpSuites.has(file), `Register the HTTP wrapper and its child tests: ${file}`);
}
const groups = {
  unit: files.filter(name => name.endsWith(".test.mjs") && !artifactTests.includes(name)),
  integration: files.filter(name => name.endsWith(".integration.mjs") && !artifactTests.includes(name) && !httpTests.includes(name)),
  artifacts: artifactTests,
  http: [...httpSuites.keys()],
};
const requested = process.argv.slice(2);
const selected = requested.length ? requested : Object.keys(groups);
for (const group of selected) assert.ok(group in groups, `Unknown test group: ${group}`);

// Do not inherit live provider credentials or local adapter configuration.
const env = {...process.env};
for (const key of Object.keys(env)) {
  if (/^(?:WEB_PROVIDERS_JSON$|BROWSERBASE_|FIRECRAWL_|VAULT_|CREDENTIAL_VAULT$|WORK_|ROUTINES_|RESEARCH_|TAVILY_|SOCIAL_|MEDIA_|BRAAND_|AUTH_|APP_ORIGIN$|APP_ENV$|BROWSER_|AUTONOMY_|BACKUP_|BILLING_|COMPOSIO_|FAL_|META_|OPENAI_|MODEL_ROUTING_|MODEL_PRICING_|OPENROUTER_|ANTHROPIC_|SASPAY_|RESEND_|OPS_|TOKEN_ENCRYPTION_KEY$|FILE_URL_SIGNING_SECRET$|SCHEDULER_SECRET$|PAGE_FORM_SECRET$|LLM_PROVIDER$|FREE_DAILY_CREDITS$|FILE_PREVIEW_V1$|PAGES_ORIGIN$)/u.test(key)) delete env[key];
}
env.NODE_OPTIONS = `--import=${pathToFileURL(path.join(project, "tests/offline-network.mjs")).href}`;
env.NEXT_TELEMETRY_DISABLED = "1";
env.WRANGLER_SEND_METRICS = "false";

for (const group of selected) {
  console.log(`\n[tests] ${group}: ${groups[group].length} files (external network blocked)`);
  const commands = group === "unit"
    ? [["--test", ...groups[group].map(file => path.join("tests", file))]]
    : groups[group].map(file => [path.join("tests", file)]);
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, {cwd: project, env, stdio: "inherit", timeout: 180_000});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
