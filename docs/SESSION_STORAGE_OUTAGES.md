# Session storage outages

On 2026-11-09, the Cloudflare D1 account dashboard showed 5.16 million rows
read against a Free allowance of 5 million. Authenticated navigation returned
`authentication_unavailable` before the application document could render.
`SELECT 1` health checks did not establish that session-table reads worked.

## Application boundary

- Only GET/HEAD `/` (the public Studio client shell) and the explicit public
  asset paths in `build/worker.ts` skip session storage. They never receive
  identity headers, even if supplied by the caller. Studio loads private data
  separately through the authenticated API. Do not introduce private server
  data into this public root without revisiting this boundary.
- API routes, authentication, dynamic image proxies and mutations retain the
  existing revocable D1 session check. A storage exception returns a sanitized,
  uncached 503. No session cookie is deleted on failure.
- Studio distinguishes unavailable from anonymous. It leaves the composer
  editable, disables sending/uploads and pauses wallet polling and approval
  continuations. Pending approval receipts remain queued. Explicit retry
  revalidates the workspace and resumes eligible work only after success.
- Existing local draft persistence remains enabled across retries/reloads.
  Unavailable credit balances are not presented as a confirmed zero balance.

## Operations

The shell fix does not restore exhausted database quota or prove private flows
have recovered. On Workers Free, daily limits reset at 00:00 UTC according to
[Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
Keep the selected free plan. After the reset, retry the workspace and inspect
row-read metrics/query plans before widening usage. Removing D1 reads from
static assets reduces unnecessary work but does not establish the cause of
all daily usage.

## Regression checks

`node tests/auth-runtime.integration.mjs` verifies the public boundary during a
throwing database outage, identity stripping, body preservation and private
routes failing closed. `node tests/agent-ui.browser.mjs` exercises the real
React shell, blocked sending, mobile layout, draft persistence, failed retry
and keyboard recovery using controlled local workspace responses. These
fixtures do not demonstrate live D1 quota recovery.
