# PD Copilot

Read-only LLM analysis assistant for staff and admin, at `/admin/copilot`.

A nurse asks a question in natural language; the agent decomposes it, queries the existing
authenticated staff API, and answers with Markdown plus — when a chart or table helps — a
self-contained HTML report rendered in a sandboxed frame.

## Security model

### The agent cannot exceed the signed-in user's permissions

Every tool maps to an existing **GET** endpoint on this same app. Calls are dispatched
in-process via `httpx.ASGITransport` carrying **the caller's own bearer token**, so each one
re-runs the real auth dependencies (`require_staff_or_admin`, `assert_patient_access`,
assignment scoping). Consequences:

- The model cannot read anything the user could not already fetch from the UI.
- Only `GET` and only allowlisted path templates are reachable, so the surface is read-only
  by construction — there is no write tool to misuse.
- Path parameters are coerced to `int` before the URL is built, which keeps arbitrary
  strings and path traversal out of the request.
- A `403` from an underlying endpoint is handed back to the model **as data**, so it explains
  the permission boundary instead of guessing. It is not a stream failure.

Allowlist and dispatcher: [`app/services/copilot/tools.py`](../../apps/backend/app/services/copilot/tools.py).

### Permission matrix

| Scope | Source | Who |
| --- | --- | --- |
| Individual patient history | existing `/v1/staff/patients/*` | staff (assigned patients only), admin (all) |
| De-identified cohort aggregates | `/v1/staff/analytics/*` | staff + admin — counts and trends, no patient identity |
| Operational detail incl. per-nurse annotation attribution | **not exposed to Copilot** | — |

`/v1/staff/analytics/*` ([`cohort_analytics.py`](../../apps/backend/app/api/routes/staff_parts/cohort_analytics.py))
reuses the same service functions as the admin-only `/v1/staff/admin/analytics/*` with
`accessible_patient_ids=None`, and returns the existing counts-only schemas. The admin-only
endpoints are unchanged and still `require_admin`.

### Session visibility

`private` = owner only · `staff` = any staff/admin · `admin` = admin only (and only an admin
can create one). **Writes are always owner-only**, so a shared session is a read-only
transcript for everyone else — no concurrent writes to one thread, and authorship stays clear.
A non-visible session returns `404` rather than `403` so it is not discoverable.

### HTML artifact sandbox

Generated HTML is rendered client-side under four independent constraints:

1. `<iframe sandbox="allow-scripts">` — **no `allow-same-origin`**, so the frame has an opaque
   origin and cannot touch cookies, `localStorage`, or the parent DOM.
2. An injected CSP of `default-src 'none'; connect-src 'none'; script-src 'unsafe-inline';
   style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'` — the
   artifact's own JS **cannot make any network request**, and no external resource loads.
3. Data reaches it only through `window.pdcare.query(tool, params)`, a `postMessage` bridge.
   The parent verifies `event.source` is its own frame, re-checks the tool against a
   client-side mirror of the allowlist, then calls `/v1/copilot/proxy` with the user's token.
   **The token never enters the frame.**
4. Live data is **opt-in per artifact** and rate-limited (per-artifact concurrency and
   interval caps in the client, per-identity per-minute cap on the server).

Bridge: [`artifact-bridge.ts`](../../apps/frontend/app/admin/copilot/_components/artifact-bridge.ts) ·
renderer: [`copilot-html-artifact.tsx`](../../apps/frontend/app/admin/copilot/_components/copilot-html-artifact.tsx).

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `COPILOT_ENABLED` | `false` | Off by default; the UI shows a setup notice when off. |
| `OPENAI_API_KEY` | — | Secret. Without it the feature reports itself unavailable. |
| `COPILOT_MODELS` | `gpt-6.1-terra,gpt-6.1-sol,gpt-6-luna` | Comma-separated; drives the model picker. |
| `COPILOT_DEFAULT_MODEL` | first of `COPILOT_MODELS` | Falls back to the first listed model if not in the list. |
| `COPILOT_MAX_TOOL_ITERATIONS` | `12` | Agent loop cap. |
| `COPILOT_REQUEST_TIMEOUT_SECONDS` | `180` | OpenAI client timeout. |
| `COPILOT_TOOL_RESULT_MAX_BYTES` | `24576` | Larger results get their arrays shortened and flagged `_truncated`. |
| `COPILOT_PROXY_RATE_LIMIT_PER_MINUTE` | `60` | Per identity, per replica. |

Local setup: `bash ops/dev/setup-copilot-env.sh`. In K8s, `COPILOT_*` live in
`k8s/base/configmap.yaml` and `OPENAI_API_KEY` in the secret (declared `optional: true` on
the deployment so clusters whose applied secret predates PD Copilot keep rolling out).

## Endpoints

| Endpoint | Behaviour |
| --- | --- |
| `GET /v1/copilot/models` | Env-driven model list and default. |
| `GET` / `POST /v1/copilot/sessions` | List visible / create. `visibility=admin` needs admin. |
| `GET /v1/copilot/sessions/{id}` | Transcript plus `can_write`. |
| `PATCH` / `DELETE /v1/copilot/sessions/{id}` | Owner only. |
| `POST /v1/copilot/sessions/{id}/messages` | Owner only. SSE: `tool_call`, `tool_result`, `token`, `message_saved`, `error`, `done`. |
| `POST /v1/copilot/proxy` | Live-artifact bridge; same allowlist, same caller token, rate-limited. |

Streaming is consumed with `fetch` + `ReadableStream` rather than the shared axios client,
whose 15s timeout and response buffering do not suit SSE.

## Known limits

- Rate limiting and the proxy window are **process-local**, so the aggregate ceiling across
  replicas is higher than the configured per-minute value.
- Every tool result is re-fetched per turn; there is no caching layer.
- Stopping a turn (or disconnecting) discards that assistant reply: the user's message is
  persisted before streaming starts, so the transcript keeps the question without an answer.
  Partial replies are not saved.
- The agent is explicitly instructed not to diagnose or prescribe, and not to analyse
  individual nurse performance.
