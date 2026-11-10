# PD Copilot De-identification Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop direct patient identifiers reaching LLM context, while nurses keep reading real names and generated reports keep rendering identifiable data.

**Architecture:** A single choke point. `dispatch_tool_call` already sits between every tool and the model, so one wrapper there applies an allowlist and swaps identities for session-scoped handles (`P#3`). A new table persists the mapping; the frontend resolves handles back to labels per viewer. The `/v1/copilot/proxy` runtime path is untouched and still returns full data.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Alembic, pytest; Next.js 16 / React 19, Jest.

**Spec:** `docs/superpowers/specs/2026-11-05-copilot-deidentification-and-modules-design.md`

## Global Constraints

- De-identification is **always on** — no environment flag, no prod-only branch.
- Field policy is an **allowlist**: a field reaches the model only if listed.
- These must never be on the allowlist: `case_number`, `full_name`, `patient_full_name`, `line_user_id`, `line_display_name`, `real_name`, `birth_date`, `picture_url`.
- `upload_id` is retained as-is: an opaque surrogate key the tools need to correlate.
- Handles are scoped to one session. The same patient in two sessions gets different handles.
- Migrations are non-destructive and single-head; `scripts/check_non_destructive_migrations.py` enforces both.
- Alembic head at plan time is `20261104_10`. New migration revises it.
- Commit messages use `type(scope): summary` and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

- **A tool returning an unseen nested shape** (a dict inside a list inside a dict) must still be filtered at every depth, not just the top level. Task 1.
- **A patient-level tool added later** with no policy entry must fail the leak sweep rather than pass PII through. Task 2.
- **A 403/404 error body** from an underlying endpoint may echo a case number in its `detail`; the boundary must filter error payloads too, not only successful ones. Task 2.
- **A session shared with an unassigned viewer** must yield the bare handle, never a label — the one path where re-identification could bypass assignment scoping. Task 4.
- **A handle appearing in prose mid-stream** (`P#3` inside a streamed token) must still render as a name once the turn completes, not stay raw. Task 5.

---

### Task 1: Field policy and recursive filter

**Files:**
- Create: `apps/backend/app/services/copilot/deidentify.py`
- Test: `apps/backend/tests/test_copilot_deidentify.py`

**Interfaces:**
- Produces: `ALLOWED_FIELDS: frozenset[str]`, `FORBIDDEN_FIELDS: frozenset[str]`, `filter_payload(value: Any) -> Any`

- [ ] **Step 1: Write the failing tests**

```python
def test_drops_fields_absent_from_the_allowlist():
    assert filter_payload({"age": 62, "case_number": "P123456"}) == {"age": 62}

def test_filters_at_every_depth():
    payload = {"items": [{"age": 1, "full_name": "王小明", "nested": {"line_user_id": "U_X", "total": 2}}]}
    assert filter_payload(payload) == {"items": [{"age": 1, "nested": {"total": 2}}]}

def test_forbidden_fields_are_not_in_the_allowlist():
    assert ALLOWED_FIELDS.isdisjoint(FORBIDDEN_FIELDS)

def test_preserves_quasi_identifiers_the_analysis_needs():
    payload = {"age": 62, "created_at": "2026-11-05T00:00:00Z", "screening_result": "suspected",
               "probability": 0.91, "symptom_pain": True, "total_uploads": 4}
    assert filter_payload(payload) == payload
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_copilot_deidentify.py -v`
Expected: FAIL, `ImportError`

- [ ] **Step 3: Implement the policy and `filter_payload(value: Any) -> Any` in `deidentify.py`**

`ALLOWED_FIELDS` holds the spec's allowed list plus the structural keys the tool responses wrap data in (`items`, `total`, `limit`, `offset`, `date`, `local_date`, `lookback_days`, `months`, `bucket_size`, `interval`, `_truncated`, `_truncated_note`). Recurse through dicts and lists; scalars pass through.

- [ ] **Step 4: Run to verify they pass**

Run: `python3 -m pytest tests/test_copilot_deidentify.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/services/copilot/deidentify.py apps/backend/tests/test_copilot_deidentify.py
git commit -m "feat(copilot): add allowlist field filter for LLM-bound payloads"
```

---

### Task 2: Handle registry and the de-identify entry point

**Files:**
- Create: `apps/backend/migrations/versions/20261105_11_add_copilot_identity_handles.py`
- Modify: `apps/backend/app/db/models.py` (append `CopilotIdentityHandle`)
- Modify: `apps/backend/app/services/copilot/deidentify.py`
- Modify: `apps/backend/tests/test_copilot_deidentify.py`

**Interfaces:**
- Consumes: `filter_payload` from Task 1
- Produces: `deidentify_payload(session: Session, *, copilot_session_id: int, payload: Any) -> Any`, and `CopilotIdentityHandle` with columns `session_id`, `handle`, `entity_type`, `entity_id`

- [ ] **Step 1: Write the failing tests**

```python
def test_patient_id_becomes_a_stable_handle(db_session):
    first = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412, "age": 62})
    second = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    assert first == {"patient_id": "P#1", "age": 62}
    assert second["patient_id"] == "P#1"

def test_handles_do_not_correlate_across_sessions(db_session):
    a = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    b = deidentify_payload(db_session, copilot_session_id=2, payload={"patient_id": 999})
    assert a["patient_id"] == b["patient_id"] == "P#1"   # same label, different patient

def test_reviewer_identity_uses_its_own_namespace(db_session):
    out = deidentify_payload(db_session, copilot_session_id=1,
                             payload={"reviewer_identity_id": 7, "patient_id": 412})
    assert out["reviewer_identity_id"] == "R#1" and out["patient_id"] == "P#1"

def test_upload_id_is_left_alone(db_session):
    assert deidentify_payload(db_session, copilot_session_id=1,
                              payload={"upload_id": 88})["upload_id"] == 88

def test_error_payloads_are_filtered_too(db_session):
    out = deidentify_payload(db_session, copilot_session_id=1,
                             payload={"error": True, "status": 403,
                                      "detail": {"case_number": "P123456"}})
    assert "P123456" not in json.dumps(out, ensure_ascii=False)
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_copilot_deidentify.py -v`
Expected: FAIL

- [ ] **Step 3: Add the `CopilotIdentityHandle` model and its migration**

Revision `20261105_11`, `down_revision = "20261104_10"`, guarded by `inspect`, empty `downgrade`. Unique on `(session_id, handle)` and on `(session_id, entity_type, entity_id)`.

- [ ] **Step 4: Implement `deidentify_payload` in `deidentify.py`**

Mint handles per `(copilot_session_id, entity_type, entity_id)`, numbering from 1 in insertion order within the session; reuse an existing row when present. Apply `filter_payload` first, then substitute identity keys — `patient_id` → `P#n`, `reviewer_identity_id` / `staff_identity_id` / `owner_identity_id` → `R#n`.

- [ ] **Step 5: Run to verify they pass, and that migrations stay linear**

Run: `python3 -m pytest tests/test_copilot_deidentify.py -v && python3 scripts/check_non_destructive_migrations.py`
Expected: PASS, and "single head"

- [ ] **Step 6: Commit**

```bash
git add apps/backend/app/db/models.py apps/backend/migrations/versions/20261105_11_add_copilot_identity_handles.py apps/backend/app/services/copilot/deidentify.py apps/backend/tests/test_copilot_deidentify.py
git commit -m "feat(copilot): map patient and reviewer ids to session-scoped handles"
```

---

### Task 3: Apply the boundary in the agent path, and prove no leak

**Files:**
- Modify: `apps/backend/app/services/copilot/tools.py` (`dispatch_tool_call`)
- Modify: `apps/backend/app/services/copilot/agent.py` (thread `copilot_session_id` through `run_agent_turn`)
- Modify: `apps/backend/app/api/routes/copilot.py` (pass the session id; proxy must NOT de-identify)
- Modify: `apps/backend/tests/test_copilot_api.py`

**Interfaces:**
- Consumes: `deidentify_payload` from Task 2
- Produces: `dispatch_tool_call(..., deidentify_for_session_id: int | None = None)` — `None` means return full data, which is what the proxy passes.

- [ ] **Step 1: Write the failing tests**

```python
PII = ("王小明", "P123456", "U_PATIENT_A")
PATIENT_LEVEL = [t.name for t in COPILOT_TOOLS if not t.name.startswith("get_cohort_")]

@pytest.mark.parametrize("tool_name", PATIENT_LEVEL)
def test_no_patient_level_tool_leaks_identifiers_to_the_model(tmp_path, tool_name):
    result = dispatch_for_test(tool_name, deidentify_for_session_id=1)   # helper seeds PII
    for needle in PII:
        assert needle not in result.content, f"{tool_name} leaked {needle}"

def test_proxy_still_returns_identified_data(tmp_path):
    body = post_proxy("list_patients", {})                               # helper, staff token
    assert "P123456" in json.dumps(body, ensure_ascii=False)

def test_agent_turn_sends_no_identifiers_to_the_api(tmp_path, monkeypatch):
    fake = install_fake_openai(monkeypatch, [...])                       # tool call, then text
    run_one_turn(...)
    sent = json.dumps(fake.responses.calls[1]["input"], ensure_ascii=False)
    for needle in PII:
        assert needle not in sent
```

The three helpers (`dispatch_for_test`, `post_proxy`, `run_one_turn`) wrap the seeding and
client setup already used in `test_copilot_api.py`; add them beside the existing fixtures.

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_copilot_api.py -k "leak or identified or no_identifiers" -v`
Expected: FAIL — identifiers present

- [ ] **Step 3: Add the parameter and call `deidentify_payload` in `dispatch_tool_call` before truncation**

De-identify both the success payload and the error payload. Thread the id from the route through `run_agent_turn` into each dispatch. The proxy route keeps passing `None`.

- [ ] **Step 4: Run to verify they pass**

Run: `python3 -m pytest tests/test_copilot_api.py -k "leak or identified or no_identifiers" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/services/copilot apps/backend/app/api/routes/copilot.py apps/backend/tests/test_copilot_api.py
git commit -m "feat(copilot): de-identify tool results on the agent path only"
```

---

### Task 4: Per-viewer re-identification API

**Files:**
- Modify: `apps/backend/app/schemas/copilot.py`
- Modify: `apps/backend/app/api/routes/copilot.py`
- Modify: `apps/backend/app/services/copilot/sessions.py`
- Modify: `apps/backend/tests/test_copilot_api.py`

**Interfaces:**
- Produces: `CopilotSessionDetailResponse.handles: dict[str, CopilotHandleLabel]` where `CopilotHandleLabel` is `{entity_type: str, label: str | None}`; a `handle` SSE event `{handle, entity_type, label}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_owner_sees_labels_for_assigned_patients(tmp_path):
    # handles == {"P#1": {"entity_type": "patient", "label": "王小明 (P123456)"}}
    ...

def test_unassigned_viewer_gets_no_label(tmp_path):
    # staff-visible session, viewer not assigned that patient
    # handles == {"P#1": {"entity_type": "patient", "label": None}}
    ...
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_copilot_api.py -k "label" -v`
Expected: FAIL — no `handles` key

- [ ] **Step 3: Implement `resolve_handles(session, *, copilot_session_id, principal) -> dict[str, CopilotHandleLabel]` in `sessions.py` and return it from the detail route**

Reuse `assert_patient_access` semantics to decide per handle whether to emit a label; on denial return `label=None` rather than raising. Emit the `handle` SSE event when a handle is first minted during a turn.

- [ ] **Step 4: Run to verify they pass**

Run: `python3 -m pytest tests/test_copilot_api.py -k "label" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/schemas/copilot.py apps/backend/app/api/routes/copilot.py apps/backend/app/services/copilot/sessions.py apps/backend/tests/test_copilot_api.py
git commit -m "feat(copilot): resolve identity handles to labels per viewer"
```

---

### Task 5: Render labels in the chat

**Files:**
- Create: `apps/frontend/app/admin/copilot/_components/handle-labels.ts`
- Create: `apps/frontend/app/admin/copilot/__tests__/handle-labels.test.ts`
- Modify: `apps/frontend/lib/api/copilot.ts` (types + `handle` stream event)
- Modify: `apps/frontend/app/admin/copilot/page.tsx` (hold the handle map)
- Modify: `apps/frontend/app/admin/copilot/_components/copilot-message.tsx` (substitute before rendering)

**Interfaces:**
- Consumes: the `handles` map and `handle` event from Task 4
- Produces: `applyHandleLabels(text: string, handles: Record<string, {label: string | null}>): string`

- [ ] **Step 1: Write the failing tests**

```ts
it("replaces a handle with its label", () => {
  expect(applyHandleLabels("P#3 近一個月上傳 5 次", { "P#3": { label: "王小明 (P123456)" } }))
    .toBe("王小明 (P123456) 近一個月上傳 5 次");
});

it("leaves a handle alone when no label is permitted", () => {
  expect(applyHandleLabels("P#3 需追蹤", { "P#3": { label: null } })).toBe("P#3 需追蹤");
});

it("does not partially match a longer handle", () => {
  expect(applyHandleLabels("P#1 and P#12", { "P#1": { label: "A" }, "P#12": { label: "B" } }))
    .toBe("A and B");
});

it("labels a handle that only arrives later in the stream", () => {
  // tokens render before the handle event lands; the map updates and the text re-renders
  expect(applyHandleLabels("P#3 需追蹤", {})).toBe("P#3 需追蹤");
  expect(applyHandleLabels("P#3 需追蹤", { "P#3": { label: "王小明" } })).toBe("王小明 需追蹤");
});

it("leaves handle-shaped text inside an html block alone", () => {
  const src = "見下表\n\n```html\n<p>P#3</p>\n```";
  expect(applyHandleLabels(src, { "P#3": { label: "王小明" } })).toBe(src);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest app/admin/copilot/__tests__/handle-labels.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `applyHandleLabels` and wire it into message rendering**

Substitute longest handle first so `P#12` is not clipped by `P#1`. Apply to assistant prose before Markdown parsing; leave fenced ```html blocks untouched, since a module's own code may legitimately contain a handle-shaped string.

- [ ] **Step 4: Run to verify they pass, plus the suite**

Run: `npx jest app/admin/copilot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/app/admin/copilot apps/frontend/lib/api/copilot.ts
git commit -m "feat(admin): show patient names in place of copilot handles"
```

---

### Task 6: Tell the model about handles, and verify on dev

**Files:**
- Modify: `apps/backend/app/services/copilot/prompt.py`
- Modify: `docs/product/pd-copilot.md`

- [ ] **Step 1: Add the handle convention to the system prompt**

State that patients appear as `P#n` and reviewers as `R#n`, that these are the only way to refer to a person, that the nurse's screen substitutes real names so the model must not apologise for not knowing them, and that a module reaches a specific patient through a runtime picker rather than a hard-coded id.

- [ ] **Step 2: Document the boundary**

In `docs/product/pd-copilot.md`, record the two paths, the allowlist, and that the nurse's own typed input is explicitly out of scope.

- [ ] **Step 3: Run the full backend suite and the frontend suite**

Run: `npm run test:backend && npm --prefix apps/frontend run test:unit && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/backend/app/services/copilot/prompt.py docs/product/pd-copilot.md
git commit -m "docs(copilot): describe the de-identification boundary and handles"
```

- [ ] **Step 5: Verify on dev after merge**

Open a session, ask a question that needs a patient-level tool, and confirm: the transcript shows real names, and `copilot_messages.content` plus the outgoing payload contain handles rather than identifiers.
