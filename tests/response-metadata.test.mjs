import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { appendCitationDelta, responseSources, responseStatus } from "../lib/response-metadata.mjs";

const citation = { type: "web_search_result_location", url: "https://example.org/report", title: "Rapport vérifié", cited_text: "Donnée native", encrypted_index: "opaque-provider-reference" };

test("native citation deltas preserve all provider fields without mutating prior blocks", () => {
  const original = [{ type: "page_location", document_index: 0, document_title: "Document client", start_page_number: 2, end_page_number: 3 }];
  const result = appendCitationDelta(original, { type: "citations_delta", citation });
  assert.equal(result.length, 2);
  assert.equal(original.length, 1);
  assert.deepEqual(result[1], citation);
  assert.deepEqual(appendCitationDelta(undefined, { type: "citations_delta", citation: "invalid" }), []);
});

test("sources require native structured citations, use safe links and stable identifiers", () => {
  const source = responseSources([{ type: "text", text: "https://invented.invalid", citations: [citation, citation] }]);
  assert.equal(source.length, 1);
  assert.deepEqual(source, responseSources([{ type: "text", citations: [citation] }]));
  assert.equal(source[0].domain, "example.org");
  assert.equal(source[0].url, citation.url);
  assert.equal(source[0].encrypted_index, undefined);
  assert.equal(source[0].cited_text, undefined);
  assert.deepEqual(responseSources([{ type: "text", text: "Source: https://invented.invalid" }]), []);
  assert.deepEqual(responseSources([{ type: "text", citations: [
    { ...citation, url: "javascript:alert(1)" }, { ...citation, url: "data:text/html,x" },
    { ...citation, url: "https://user:password@example.org" }, { url: citation.url },
  ] }]), []);
  const documents = responseSources([{ type: "text", citations: [{ type: "page_location", document_index: 0, document_title: "Contrat client", start_page_number: 1, end_page_number: 2 }] }]);
  assert.equal(documents[0].domain, "Document joint");
  assert.equal(documents[0].url, undefined);
});

test("only a linked run can establish completion, cancellation or error", () => {
  assert.equal(responseStatus(null, "completed"), "unknown");
  assert.equal(responseStatus("id", null), "unknown");
  assert.equal(responseStatus("id", "completed"), "complete");
  assert.equal(responseStatus("id", "streaming"), "streaming");
  assert.equal(responseStatus("id", "cancelled"), "cancelled");
  assert.equal(responseStatus("id", "failed"), "error");
  assert.equal(responseStatus("id", "partial"), "error");
});

test("real chat handlers persist run metadata and user feedback in isolated SQLite", async (t) => {
  const project = path.resolve(import.meta.dirname, "..");
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  const migrations = readdirSync(path.join(project, "drizzle")).filter(name => name.endsWith(".sql")).sort();
  for (const migration of migrations.filter(name => name < "0011_response_feedback.sql")) sql.exec(readFileSync(path.join(project, "drizzle", migration), "utf8"));
  sql.prepare("INSERT INTO workspaces(id,name,created_at) VALUES ('legacy','Legacy',0)").run();
  sql.prepare("INSERT INTO resources(id,workspace_id,kind,title,created_at,updated_at) VALUES ('legacy-conversation','legacy','conversation','Ancienne discussion',0,0)").run();
  sql.prepare("INSERT INTO messages(id,workspace_id,conversation_id,role,content,created_at) VALUES ('legacy-message','legacy','legacy-conversation','assistant','[{\"type\":\"text\",\"text\":\"Ancien message\"}]',0)").run();
  for (const migration of migrations.filter(name => name >= "0011_response_feedback.sql")) sql.exec(readFileSync(path.join(project, "drizzle", migration), "utf8"));
  assert.equal(sql.prepare("SELECT run_id FROM messages WHERE id='legacy-message'").get().run_id, null);

  function statement(query, args = []) {
    return { bind(...next) { return statement(query, next); }, async first(column) { const row = sql.prepare(query).get(...args); return column ? row?.[column] ?? null : row ?? null; }, async all() { return { results: sql.prepare(query).all(...args) }; }, async run() { return this._run(); }, _run() { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; } };
  }
  const DB = { prepare: query => statement(query), async batch(statements) { sql.exec("BEGIN"); try { const result = statements.map(s => s._run()); sql.exec("COMMIT"); return result; } catch (error) { sql.exec("ROLLBACK"); throw error; } } };
  const fixture = { env: { DB, ANTHROPIC_API_KEY: "fixture-unused-local-key" }, headers: new Headers({ "x-braand-identity-id": "owner", "x-braand-identity-email": "owner@test.invalid" }), responses: [], requests: [] };
  globalThis.__responseMetadataTest = fixture;
  const outfile = path.join(project, ".local-build", "response-metadata-test.mjs");
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({ stdin: { contents: `export * as route from ${JSON.stringify(path.join(project, "app/api/chat/route.ts").replaceAll("\\", "/"))};export * as server from ${JSON.stringify(path.join(project, "lib/server.ts").replaceAll("\\", "/"))};`, resolveDir: project, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", plugins: [{ name: "isolated-response-bindings", setup(b) {
    b.onResolve({ filter: /^(cloudflare:workers|next\/headers|next\/navigation)$/ }, args => ({ path: args.path, namespace: "bindings" }));
    b.onLoad({ filter: /.*/, namespace: "bindings" }, args => ({ contents: args.path === "cloudflare:workers" ? "export const env=globalThis.__responseMetadataTest.env;" : args.path === "next/headers" ? "export async function headers(){return globalThis.__responseMetadataTest.headers;}" : "export function redirect(){throw Error('Unexpected redirect');}" }));
    b.onResolve({ filter: /(?:^|\/)metering$/ }, args => ({ path: args.path, namespace: "metering-fixture" }));
    b.onLoad({ filter: /.*/, namespace: "metering-fixture" }, () => ({ contents: `export async function startRunBudget(who,runId,maxCredits){return {who,runId,limit:maxCredits*100};}export async function finishRunBudget(){}export async function reconcileOpenRouterUsage(){throw Error('Unexpected reconciliation in response metadata test');}export function modelReadiness(){return {ready:false};}export function modelRate(){throw Error('No paid tools in this test');}export async function meteredMessage(_budget,_role,request){const t=globalThis.__responseMetadataTest;t.requests.push(structuredClone(request));const response=t.responses.shift();if(!response)throw Error('Unexpected model request');return new Response(response,{headers:{'Content-Type':'text/event-stream'}});}` }));
  } }] });
  const { route, server } = await import(pathToFileURL(outfile).href);
  const request = (method = "GET", body, extraHeaders = {}, suffix = "") => new Request("https://app.test/api/chat" + suffix, { method, headers: { "content-type": "application/json", origin: "https://app.test", ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const who = await server.identity(request());
  const conversation = await server.createResource(who.tenant, "conversation", "Test local", {}, "saved");
  const stream = blocks => [{ type: "message_start", message: { id: "fixture-response", type: "message", role: "assistant" } }, ...blocks, { type: "message_stop" }].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

  await t.test("citations_delta survives tool round history, persisted blocks, live identity and reload", async () => {
    fixture.responses.push(stream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "Rapport", citations: [], provider_metadata: { untouched: true } } },
      { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool-1", name: "search_workspace", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"kind":"project"}' } },
      { type: "content_block_stop", index: 1 },
    ]), stream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "Analyse terminée", citations: [citation] } },
      { type: "content_block_stop", index: 0 },
    ]));
    const response = await route.POST(request("POST", { conversationId: conversation.id, text: "Analyser le rapport", maxCredits: 10, workMode: "autonomous" }));
    assert.equal(response.status, 200);
    const events = await response.text();
    assert.match(events, /event: assistant_message/u);
    assert.match(events, /event: done/u);
    const assistantEvents = events.split("\n\n").filter(part => part.includes("event: assistant_message")).map(part => JSON.parse(part.split("data: ")[1]));
    assert.equal(assistantEvents.length, 2);
    for (const event of assistantEvents) {
      const row = sql.prepare("SELECT * FROM messages WHERE id=?").get(event.messageId);
      assert.equal(row.run_id, event.runId);
      assert.deepEqual(JSON.parse(row.content)[0].citations[0], citation);
      assert.deepEqual(event.sources, responseSources(JSON.parse(row.content)));
    }
    const history = fixture.requests[1].messages.find(message => message.role === "assistant");
    assert.deepEqual(history.content[0].citations[0], citation);
    assert.deepEqual(history.content[0].provider_metadata, { untouched: true });
    const reload = await route.GET(request("GET", undefined, {}, `?conversationId=${conversation.id}`));
    assert.equal(reload.status, 200);
    const messages = (await reload.json()).messages.filter(message => message.role === "assistant");
    assert.equal(messages.length, 2);
    assert.ok(messages.every(message => message.status === "complete" && message.feedback === null && message.sources.length === 1));
  });

  const messageId = sql.prepare("SELECT id FROM messages WHERE workspace_id='owner' AND role='assistant' LIMIT 1").get().id;
  await t.test("messages saved within the same millisecond retain insertion order", async () => {
    const tied = await server.createResource(who.tenant, "conversation", "Ordre des messages", {}, "saved");
    for (const [id, role] of [["z-first", "user"], ["a-second", "assistant"]]) sql.prepare("INSERT INTO messages(id,workspace_id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?,?)").run(id, who.tenant, tied.id, role, JSON.stringify([{ type: "text", text: id }]), 123);
    const response = await route.GET(request("GET", undefined, {}, `?conversationId=${tied.id}`));
    assert.deepEqual((await response.json()).messages.map(message => message.id), ["z-first", "a-second"]);
  });
  await t.test("feedback is idempotent, can be cleared, and is hydrated per authenticated user", async () => {
    for (let i = 0; i < 2; i++) assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: "up" }))).status, 200);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM response_feedback WHERE message_id=?").get(messageId).n, 1);
    const load = async () => (await (await route.GET(request("GET", undefined, {}, `?conversationId=${conversation.id}`))).json()).messages.find(message => message.id === messageId);
    assert.equal((await load()).feedback, "up");
    const otherWho = await server.identity(request("GET", undefined, {}));
    assert.equal(otherWho.user.userId, "owner");
    sql.prepare("INSERT INTO organization_members(organization_id,user_id,role,active) VALUES ('owner','reviewer','editor',1)").run();
    sql.prepare("INSERT INTO members(id,workspace_id,user_id,role) VALUES ('reviewer-member','owner','reviewer','editor')").run();
    sql.prepare("INSERT INTO billing_subscriptions(id,organization_id,plan,cycle,start_at,end_at,status,order_id) VALUES ('feedback-business','owner','business','period',?,?,'active','feedback-order')").run(Date.now() - 1000, Date.now() + 86400000);
    fixture.headers = new Headers({ "x-braand-identity-id": "reviewer", "x-braand-identity-email": "reviewer@test.invalid" });
    const reviewerLoad = await route.GET(request("GET", undefined, { "x-braand-workspace": "owner" }, `?conversationId=${conversation.id}`));
    assert.equal((await reviewerLoad.json()).messages.find(message => message.id === messageId).feedback, null);
    assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: "down" }, { "x-braand-workspace": "owner" }))).status, 200);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM response_feedback WHERE message_id=?").get(messageId).n, 2);
    fixture.headers = new Headers({ "x-braand-identity-id": "owner", "x-braand-identity-email": "owner@test.invalid" });
    assert.equal((await load()).feedback, "up");
    assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: null }))).status, 200);
    assert.equal((await load()).feedback, null);
  });

  await t.test("vote validation rejects spoofed scope, user messages, foreign messages and cross-origin writes", async () => {
    assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: "up", userId: "attacker" }))).status, 400);
    assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: "maybe" }))).status, 400);
    assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: "up" }, { origin: "https://attacker.invalid" }))).status, 403);
    const foreign = await route.PATCH(request("PATCH", { messageId: "legacy-message", feedback: "up" }));
    const missing = await route.PATCH(request("PATCH", { messageId: "missing", feedback: "up" }));
    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
    const userMessage = sql.prepare("SELECT id FROM messages WHERE workspace_id='owner' AND role='user' LIMIT 1").get().id;
    assert.equal((await route.PATCH(request("PATCH", { messageId: userMessage, feedback: "up" }))).status, 404);
    assert.throws(() => sql.prepare("INSERT INTO response_feedback(workspace_id,user_id,message_id,feedback,created_at,updated_at) VALUES ('legacy','owner',?,'up',0,0)").run(messageId), /FOREIGN KEY/u);
    fixture.headers = new Headers();
    assert.equal((await route.PATCH(request("PATCH", { messageId, feedback: "up" }))).status, 401);
    fixture.headers = new Headers({ "x-braand-identity-id": "owner", "x-braand-identity-email": "owner@test.invalid" });
  });

  await t.test("migration preserves old messages, linked status is truthful, feedback deletion cascades", async () => {
    const legacyMessage = sql.prepare("SELECT * FROM messages WHERE id='legacy-message'").get();
    assert.equal(legacyMessage.run_id, null);
    assert.equal(responseStatus(legacyMessage.run_id, null), "unknown");
    const runId = sql.prepare("SELECT run_id FROM messages WHERE id=?").get(messageId).run_id;
    for (const [status, expected] of [["streaming", "streaming"], ["failed", "error"], ["partial", "error"], ["cancelled", "cancelled"]]) {
      sql.prepare("UPDATE runs SET status=? WHERE id=?").run(status, runId);
      const response = await route.GET(request("GET", undefined, {}, `?conversationId=${conversation.id}`));
      assert.equal((await response.json()).messages.find(message => message.id === messageId).status, expected);
    }
    sql.prepare("DELETE FROM messages WHERE id=?").run(messageId);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM response_feedback WHERE message_id=?").get(messageId).n, 0);
  });
  delete globalThis.__responseMetadataTest;
  sql.close();
});

test("each cited passage is tied to the numbers of its real sources, in list order", async () => {
  const { responseCitationMarks } = await import("../lib/response-metadata.mjs");
  const second = { type: "web_search_result_location", url: "https://www.stats.example.com/glaces", title: "Statistiques" };
  const blocks = [
    { type: "text", text: "Voici le point. " },
    { type: "text", text: "Les ventes de pistache montent de 23 %", citations: [citation] },
    { type: "text", text: " et les fruits à noyau suivent", citations: [second, citation, { type: "web_search_result_location", url: "javascript:alert(1)" }] },
    { type: "text", text: "Sans source fiable.", citations: [{ type: "web_search_result_location", url: "ftp://x.example" }] },
    { type: "tool_use", id: "t", name: "x", input: {} },
  ];
  const sources = responseSources(blocks);
  assert.deepEqual(sources.map(source => source.domain), ["example.org", "stats.example.com"]);
  assert.deepEqual(responseCitationMarks(blocks), [
    { after: "Les ventes de pistache montent de 23 %", sources: [1] },
    { after: " et les fruits à noyau suivent", sources: [1, 2] },
  ]);
  assert.deepEqual(responseCitationMarks([{ type: "text", text: "x".repeat(200), citations: [citation] }])[0].after.length, 80);
  assert.deepEqual(responseCitationMarks(null), []);
});

test("source chips go right after the cited passage and never invent a source", async () => {
  mkdirSync(".local-build/citations", { recursive: true });
  await build({ entryPoints: ["components/agents/citations.tsx"], outfile: ".local-build/citations/citations.mjs", bundle: true, platform: "node", format: "esm", jsx: "automatic", external: ["react", "react/jsx-runtime", "lucide-react"], alias: { "@": path.resolve(".") } });
  const { withCitationMarks, CITATION_MARKER } = await import(pathToFileURL(path.resolve(".local-build/citations/citations.mjs")).href);
  const text = "Voici le point. Les ventes de pistache montent de 23 % et les fruits à noyau suivent.";
  const marked = withCitationMarks(text, [{ after: "montent de 23 %", sources: [1] }, { after: "à noyau suivent", sources: [1, 2, 9] }, { after: "absent du texte", sources: [2] }], 2);
  assert.equal(marked, "Voici le point. Les ventes de pistache montent de 23 %\uE0001\uE001 et les fruits à noyau suivent\uE0001,2\uE001.");
  assert.equal(marked.split(CITATION_MARKER).filter(part => CITATION_MARKER.test(part)).length, 2);
  // Markers the model might write are removed; without sources nothing is added.
  assert.equal(withCitationMarks("Texte \uE0001\uE001 simulé", [{ after: "Texte", sources: [1] }], 1), "Texte\uE0001\uE001 1 simulé");
  assert.equal(withCitationMarks(text, [{ after: "montent de 23 %", sources: [1] }], 0), text);
});
