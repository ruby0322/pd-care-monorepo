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
- Path parameters are resolved to an `int` before the URL is built, which keeps arbitrary
  strings and path traversal out of the request. On the agent path they must arrive as the
  session-scoped handle the model was given (`patient_id="P#1"`), which is looked up in
  `CopilotIdentityHandle` for *that* session; an unknown or foreign-session handle is
  rejected outright rather than guessed at. On `/v1/copilot/proxy`, which never
  de-identified anything, they are plain integer ids as before.
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

### De-identification boundary

Two data paths exist, and they are de-identified differently on purpose:

- **Model-facing tool calls** — every GET tool result the agent loop dispatches
  (`/v1/copilot/sessions/{id}/messages`) passes through `deidentify_payload`
  ([`app/services/copilot/deidentify.py`](../../apps/backend/app/services/copilot/deidentify.py))
  before the model ever sees it. This is two layers:
  1. `filter_payload` — a deny-by-default, recursive field-name allowlist. A field survives
     only if its exact name is listed in `ALLOWED_FIELDS`; a new field added upstream (a new
     schema attribute, a new wrapper key) is silently withheld until someone deliberately
     allowlists it, so the failure mode is a visible gap in the model's data, not a silent
     leak of something new.
  2. `deidentify_payload` re-labels the row ids the filter keeps: `patient_id` becomes
     `P#1`, `P#2`, …; the staff/reviewer identity fields (`reviewer_identity_id`,
     `staff_identity_id`, `owner_identity_id`) all share one namespace and become `R#1`,
     `R#2`, …. Handles are minted in `CopilotIdentityHandle`, scoped to one
     `copilot_session_id` — the same handle maps to the same row only within that session;
     the same label in a different session can be a different patient entirely.
  `list_patient_annotations` additionally withholds free-text `comment` outright, since prose
  can carry a name no field-name allowlist would ever catch.
- **`/v1/copilot/proxy`** is the one path that is **exempt** and returns fully identified
  data. It exists only so a generated HTML report's own JS can re-query live data
  (`window.pdcare.query`) after the report is already rendered — and that result lands
  directly in the signed-in nurse's own browser, not back in the model's context. There is
  nothing to de-identify because the data never crosses back over the boundary.

  The boundary is two-way: because the model only ever sees `P#1`, that is also the only
  thing it can *send*. `CopilotTool.json_schema` advertises those parameters as handle
  strings on the agent path (`{"type": "string", "pattern": "^P#[0-9]+$"}`) and
  `build_path` resolves them back through the same handle table. Advertising an integer
  there would have been worse than a broken tool: a structured-output model satisfies a
  required-integer schema by inventing a number, and an invented id that happens to name
  another patient assigned to the same nurse returns a coherent per-patient narrative under
  the wrong name.

The frontend then substitutes real names back onto the handles it receives for display (see
[`handle-labels.ts`](../../apps/frontend/app/admin/copilot/_components/handle-labels.ts)), so
the nurse's screen reads a real name while the model only ever reasoned about `P#1` / `R#1`.
The system prompt ([`prompt.py`](../../apps/backend/app/services/copilot/prompt.py)) tells the
model this convention explicitly — that handles are the *only* way it can refer to a person,
that it must pass a handle straight back when a tool asks for one, and that it must not
apologise for not knowing a real name or ask the nurse to supply one. It also names nobody:
the prompt identifies the signed-in user by role only (`目前使用者：護理師`), because
`real_name` is on the never-allowlist and interpolating it there would have sent it to the
model on every turn, through the one channel no tool-result filter can reach.

**Out of scope, by design: what the nurse types.** This boundary governs data flowing from
the API to the model. It does nothing to a nurse's own chat input. If a nurse types a
patient's real name, case number, or any other identifying text into the chat box, that text
is sent to the model exactly as typed — there is no filter on the way in, and none is
planned, because distinguishing "a name" from ordinary free text reliably is not something a
field-name allowlist can do. Pilot users should be told this plainly: don't type identifying
details into the chat, and treat the handle convention as something the *model's queries*
respect, not a guarantee about what a human can paste into the box.

The same gap has a second consequence that is easy to miss: **a shared transcript republishes
what the owner typed.** Per-viewer handle resolution covers the model's side correctly — a
viewer not assigned a patient sees the bare `P#1` instead of a name — but user-role messages
are rendered verbatim to everyone who can read the session, because they are the viewer's own
prose and nothing in them was ever a handle. So a session whose questions name a patient
discloses that name to every staff member when its visibility is set to `staff`. The new-session
dialog says so beside the visibility picker; the rule for pilot users is that `staff`
visibility is for the *analysis*, and a thread where names were typed stays `private`.

**Also out of scope: what a generated report puts in its own error messages.** A rendered
report runs on identified data (see `/v1/copilot/proxy` below), and its runtime faults are
reported back to the thread so the assistant can repair its own HTML. A report that throws
`new Error("找不到 " + patient.full_name + " 的資料")` therefore has a real name in its error
text. Two things keep that out of the model: the **automatic** repair path sends only the
error's `kind` and its line/column — never `message` or `detail`, because it fires with no
nurse action at all — while the full text is sent only by the manual 「請 Copilot 修正」 button,
where a human has read it on screen first (`buildAutoRepairPrompt` / `buildManualRepairPrompt`
in [`artifact-bridge.ts`](../../apps/frontend/app/admin/copilot/_components/artifact-bridge.ts)).
The system prompt separately forbids putting patient identifiers in error strings. Neither is
a guarantee on its own: the first is, and the generated code is not ours to trust.

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
- De-identification only covers data coming *from* the API (see "De-identification
  boundary" above). A nurse's own typed chat input is not filtered — if they type a real
  name or case number, it reaches the model as-is, and sharing that session shows it to
  every viewer. This is a deliberate limitation, not a bug, and pilot users should be told
  not to type identifying details into the chat and to keep such threads `private`.
- A generated report's own error text is identified data by construction, so the automatic
  repair path forwards only the fault's type and location. A fault the assistant cannot fix
  from that alone needs the manual 「請 Copilot 修正」 button.
