# Adaptive model capacity — 24 October 2026

## Behavior

The existing runtime supports an additional policy behind
`MODEL_ROUTING_ENABLED=true` and `MODEL_ROUTING_POLICY=adaptive`.
Without both switches the existing single-model or task-based routing remains.
No production switch or tariff is changed by this implementation.

Each new user message starts on **light** (Haiku). The model answers a simple
question directly, with the existing streaming path and no classifier call.
Before substantial work it can call the internal `request_model_capacity` tool
once, selecting **standard** (Sonnet) or **advanced** (Opus). The decision is
semantic and multilingual; the runtime does not classify user text by keywords.
If uncertain, the policy asks it to stay on light. There is no measurable guarantee
that a model will always classify complexity correctly; the tests use scripted
decisions and cannot establish live model quality or latency.

The first isolated decision may select advanced directly. Later changes move up
one level, with at most two changes per run. The runtime refuses repeated levels,
downgrades and requests combined with other tools or text in the same turn. Prior
streamed content is retained. The next user message resets to light while keeping
the conversation history. Specialist delegations may carry `complexity`, using
the same three levels; an unspecified extraction is light and other specialist
work is standard. Their tools, permissions and budgets remain bounded as before.

Capacity choices produce no user-facing tool-start/tool-result events. They are
recorded in the private audit log. Instructions, user language, history, tool
results and the approved hold continue unchanged. Signed reasoning is scoped to
its originating model; it is never forwarded to another model. Visible history
and tool-call/result pairs survive the switch. This preserves context without
treating opaque provider reasoning as portable across models.

## Availability and costs

Catalog entries retain the existing validated fields. An optional
`transport: "openrouter"` uses the existing `OPENROUTER_API_KEY` and native
Messages endpoint; default `transport: "direct"` uses the existing direct keys.
The exact allowlisted adaptive IDs are:

- direct: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`;
- OpenRouter: `anthropic/claude-haiku-5.5`,
  `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`.

The public OpenRouter catalog was read on 24 October 2026 and listed these three
IDs with tool support. That read does not validate a customer tariff, exchange
rate, funding fee, generation, context handling or live performance. Sources:
[catalog](https://openrouter.ai/api/v1/models),
[Messages](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages).
The upstream auto router is not used: its variable underlying model would require
a different pre-reservation and per-model accounting contract.

Every selected entry needs its exact model/provider rate, verified USD/XAF and
overhead, a verification date within 24 hours, and bounded input/output tokens.
OpenRouter additionally requires verified `fundingFeeBps`. It receives
`require_parameters: true` and `allow_fallbacks: false`; an upstream cannot
silently replace the selected model. Missing/stale prices fail closed. Switching
capacity never refreshes a tariff timestamp or makes an invalid rate usable.

Each provider-usage row stores its exact model, rate, tier and actual/estimated
receipt. Settlement uses that row's price, not the default or next model's price.
All calls share the existing hold. Context, output ceilings, unresolved costs,
concurrent usage and spending limits remain enforced before a paid request.
Independent safe reads retain the existing bounded parallel execution. Paid model
calls sharing a hold remain serialized to avoid overspending.

Only an explicit HTTP 429, recorded as a rejected request before any streaming
output from that call, permits a bounded next-tier attempt with unchanged history.
No action is replayed. A timeout, network failure, HTTP 5xx, incomplete stream or
uncertain provider receipt stops work and preserves the existing reconciliation
requirements. No blind fallback retries those requests.

## Verification

`tests/agent-routing.integration.mjs` covers one-call light conversation,
multilingual output, model-selected capacity, escalation after an actual tool
error, resetting on the next message, unchanged history/instructions/budget,
unavailable pricing, autonomous permission denial, duplicate selections,
explicit refusal versus uncertain failure, and specialist complexity.

`tests/model-routing.integration.mjs` covers exact allowlisted selection, tiers,
per-model settlement, reasoning isolation, OpenRouter transport/receipt handling,
missing funding fees, context ceilings and existing budget/reconciliation guards.
Providers are simulated. Request counts are reproducible runtime observations;
they are not production latency, quality or spending benchmarks.

On 24 October 2026, the three OpenRouter entries were configured in private
staging and production, with adaptive routing enabled. The optional
[automatic price registry](MODEL_PRICING_REFRESH.md) supplies source-verified
per-model rates and a dated BEAC reference. Its explicit accounting basis is
inference-credit consumption; company funding expenses remain separate.
Commercial checkout and all unrelated experimental gates remain disabled.
Source verification and a minimal native streaming diagnostic succeeded;
neither proves an authenticated end-to-end customer conversation or the quality
of every tier. The prior 24-hour expiry guard remains enforced.

## Video editing and motion design preference — 31 October 2026

For substantive montage, storyboard production, animation code, targeted motion retouches and quality control, the principal model is instructed to choose advanced capacity with the bounded reason `video_motion` before doing the production work. This remains a semantic decision; no keyword scan of user text is added. A simple explanation about video can still answer immediately on light.

The server then uses its `video_motion` task, mapped to the already allowlisted Opus 5.5 in both task-based and adaptive routing. An explicitly selected light/standard tier does not override that task. Under the existing OpenRouter transport the exact ID is `anthropic/claude-opus-5.5`, verified in its public catalog on 31 October 2026 with tools support. The production catalog already contains this entry; no key, tariff timestamp, activation flag or funding policy is changed.

The request-local preference also applies to creative specialists delegated by that video work. Their tools and their contract budgets stay the same. Other specialist roles retain their normal routes. The next principal response starts fresh on light, with the same conversation history. Missing configuration, unverified rates or insufficient budget still stop a paid call before provider execution. Opus prepares and reasons about the work; the available renderer performs the actual media export.

Regression tests cover the exact model route, unchanged generic creative routing, rejected missing Opus configuration, silent principal selection, creative delegation and reset on the following message. Provider responses are simulated; no paid generation is used for these tests.
