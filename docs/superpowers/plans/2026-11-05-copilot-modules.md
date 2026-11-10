# PD Copilot Saved Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a nurse keep a generated report as a reusable module, browse saved modules on their own page, and re-run them with runtime parameters.

**Architecture:** A module stores HTML, never data. Every figure it shows is fetched at run time through the existing `/v1/copilot/proxy` under the viewer's own token, so sharing a module shares a capability rather than a dataset. The runner reuses `buildArtifactDocument` and the existing sandbox wholesale — no second rendering path.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, Alembic, pytest; Next.js 16 / React 19, Jest.

**Spec:** `docs/superpowers/specs/2026-11-05-copilot-deidentification-and-modules-design.md`

**Depends on:** `2026-11-05-copilot-deidentification.md` — land and verify that first. A module authored while the agent still saw identifiers could hard-code one.

## Global Constraints

- A module stores code only. No query results are persisted with it. (This constraint was
  stated without an enforcement point; the branch review found that a static snapshot could
  be saved and shared. A shared module is now rejected at save time unless it calls the
  bridge — see the spec.)
- Visibility is `private` / `staff` / `admin`, matching sessions; `admin` requires the admin role; writes are owner-only.
- A module invisible to the caller returns `404`, not `403`, so it is not discoverable.
- The runner must reuse `buildArtifactDocument` — no second sandbox implementation.
- Migrations are non-destructive and single-head.
- Alembic head after the de-identification plan is `20261105_11`. This migration revises it.
- Commit messages use `type(scope): summary` and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

- **A module saved by A and opened by B** must show only B's patients — the property the whole sharing model rests on. Task 2.
- **A module whose HTML exceeds the column limit** (a large inline SVG dashboard) must fail with a clear error, not a truncated page that renders wrong. Task 1.
- **Deleting the source session** must leave the module working; provenance is a reference, not a dependency. Task 1.
- **A module that throws at run time** has no live session, so auto-repair must stay off and the error must surface instead of silently blanking. Task 4.
- **An empty modules list** for a new user must read as an invitation, not as a loading failure. Task 4.

---

### Task 1: Module storage and CRUD

**Files:**
- Create: `apps/backend/migrations/versions/20261105_12_add_copilot_modules.py`
- Create: `apps/backend/tests/test_copilot_modules_api.py`
- Modify: `apps/backend/app/db/models.py` (append `CopilotModule`)
- Modify: `apps/backend/app/schemas/copilot.py`
- Modify: `apps/backend/app/api/routes/copilot.py`
- Modify: `apps/backend/app/services/copilot/sessions.py` (reuse visibility helpers)

**Interfaces:**
- Produces: `CopilotModule` with `owner_identity_id`, `title`, `description`, `html`, `visibility`, `source_session_id`, `source_message_id`, timestamps; schemas `CopilotModuleSummary`, `CopilotModuleDetail`, `CopilotModuleCreateRequest`, `CopilotModuleUpdateRequest`; routes under `/v1/copilot/modules`.

- [ ] **Step 1: Write the failing tests**

```python
def test_owner_can_save_and_fetch_a_module(tmp_path): ...

@pytest.mark.parametrize(("visibility", "other_staff", "other_admin"),
                         [("private", 404, 404), ("staff", 200, 200), ("admin", 404, 200)])
def test_module_visibility_matrix(tmp_path, visibility, other_staff, other_admin): ...

def test_non_owner_cannot_patch_or_delete(tmp_path): ...

def test_staff_cannot_create_admin_visible_module(tmp_path): ...

def test_module_survives_deletion_of_its_source_session(tmp_path):
    # delete the session; GET the module still returns 200 with its html
    ...

def test_oversized_html_is_rejected(tmp_path):
    # html beyond the documented limit -> 422, not a silent truncation
    ...
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_copilot_modules_api.py -v`
Expected: FAIL — 404 on every route

- [ ] **Step 3: Add the model, migration and routes**

Revision `20261105_12`, `down_revision = "20261105_11"`. `source_session_id` is `ON DELETE SET NULL` so provenance never blocks a session delete. Cap `html` at 512 KB and reject beyond it with `422`. Reuse `assert_visibility_allowed` and the `get_readable_*` / `get_owned_*` shape already used for sessions rather than writing new permission logic.

- [ ] **Step 4: Run to verify they pass, plus the migration guard**

Run: `python3 -m pytest tests/test_copilot_modules_api.py -v && python3 scripts/check_non_destructive_migrations.py`
Expected: PASS, "single head"

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/db/models.py apps/backend/migrations/versions/20261105_12_add_copilot_modules.py apps/backend/app/schemas/copilot.py apps/backend/app/api/routes/copilot.py apps/backend/tests/test_copilot_modules_api.py
git commit -m "feat(copilot): store and serve saved report modules"
```

---

### Task 2: Prove sharing grants a capability, not data

**Files:**
- Modify: `apps/backend/tests/test_copilot_modules_api.py`

**Interfaces:**
- Consumes: the module routes from Task 1 and the existing `/v1/copilot/proxy`

- [ ] **Step 1: Write the failing test**

```python
def test_a_shared_module_shows_each_viewer_only_their_own_patients(tmp_path):
    # A assigned patient X ("PX00001"), B assigned patient Y ("PY00002")
    module_id = create_module(as_=staff_a, visibility="staff", html=LIST_PATIENTS_HTML)

    assert get_module(module_id, as_=staff_b).status_code == 200      # code is shared

    body = post_proxy("list_patients", {}, as_=staff_b).json()["data"]
    cases = {item["case_number"] for item in body["items"]}
    assert cases == {"PY00002"}                                        # data is not
```

- [ ] **Step 2: Run to verify it fails or passes for the right reason**

Run: `python3 -m pytest tests/test_copilot_modules_api.py -k capability -v`
Expected: PASS once Task 1 lands — this test pins behaviour that must never regress, so confirm it fails if the proxy is made to use the module owner's token.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/tests/test_copilot_modules_api.py
git commit -m "test(copilot): pin that a shared module grants no extra data access"
```

---

### Task 3: Save a report as a module

**Files:**
- Create: `apps/frontend/app/admin/copilot/_components/save-module-dialog.tsx`
- Modify: `apps/frontend/lib/api/copilot.ts`
- Modify: `apps/frontend/app/admin/copilot/_components/copilot-html-artifact.tsx`
- Modify: `apps/frontend/app/admin/copilot/_components/copilot-message.tsx`
- Modify: `apps/frontend/app/admin/copilot/__tests__/copilot-message.test.tsx`

**Interfaces:**
- Consumes: routes from Task 1
- Produces: `createCopilotModule`, `fetchCopilotModules`, `fetchCopilotModule`, `deleteCopilotModule` in `lib/api/copilot.ts`; an `onSaveAsModule?: (html: string) => void` prop on the artifact.

- [ ] **Step 1: Write the failing test**

```tsx
it("offers to save a rendered report as a module", async () => {
  // render an assistant message containing an html block, click 儲存為模組,
  // fill the title, submit, assert createCopilotModule called with that html
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest app/admin/copilot/__tests__/copilot-message.test.tsx`
Expected: FAIL — no such control

- [ ] **Step 3: Add the API functions, the dialog, and a 儲存為模組 button beside the existing artifact controls**

The dialog collects title, description and visibility, with the `admin` option shown only to admins — mirroring `copilot-new-session-dialog.tsx`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest app/admin/copilot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/app/admin/copilot apps/frontend/lib/api/copilot.ts
git commit -m "feat(admin): save a generated report as a reusable module"
```

---

### Task 4: The modules page

**Files:**
- Create: `apps/frontend/app/admin/modules/page.tsx`
- Create: `apps/frontend/app/admin/modules/__tests__/page.test.tsx`
- Modify: `apps/frontend/app/admin/admin-layout-client.tsx` (sidebar entry, both mobile and desktop nav)

**Interfaces:**
- Consumes: `fetchCopilotModules`, `fetchCopilotModule`, `deleteCopilotModule` from Task 3; `CopilotHtmlArtifact` for rendering

- [ ] **Step 1: Write the failing tests**

```tsx
it("lists modules the viewer can see, with an owner badge on shared ones", ...)
it("renders a chosen module in the sandboxed frame with live data on", ...)
it("shows an invitation rather than an error when the list is empty", ...)
it("keeps auto-repair off, since a saved module has no live session", ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest app/admin/modules`
Expected: FAIL, module not found

- [ ] **Step 3: Build the page and add the sidebar entry**

Reuse `CopilotHtmlArtifact` with `liveEnabled` forced on and `onAutoRepair` omitted; a broken module shows its error plus 「在 Copilot 中開啟修正」, which opens a new session seeded with the HTML and the error. Follow the existing nav markup in `admin-layout-client.tsx` for both breakpoints (lucide `Blocks`).

- [ ] **Step 4: Run to verify they pass, plus lint, types and build**

Run: `npx jest && npx eslint && npx tsc --noEmit && npm run build`
Expected: PASS; `/admin/modules` present in the build output

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/app/admin/modules apps/frontend/app/admin/admin-layout-client.tsx
git commit -m "feat(admin): browse and run saved copilot modules"
```

---

### Task 5: Teach the model the module conventions

**Files:**
- Modify: `apps/backend/app/services/copilot/prompt.py`
- Modify: `docs/product/pd-copilot.md`

- [ ] **Step 1: Add the module layout convention to the system prompt**

A report meant to be kept should render its own controls in a header — a patient `<select>` populated from `pdcare.query('list_patients')`, a date range, a lookback — rather than hard-coding values, so it stays useful when re-run. Restate that a specific patient is reached through a picker, never a hard-coded id.

- [ ] **Step 2: Document modules in `docs/product/pd-copilot.md`**

What a module is, that it stores code rather than data, and why that makes sharing safe.

- [ ] **Step 3: Run the full suites**

Run: `npm run test:backend && npm --prefix apps/frontend run test:unit && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/backend/app/services/copilot/prompt.py docs/product/pd-copilot.md
git commit -m "docs(copilot): document saved modules and their layout convention"
```
