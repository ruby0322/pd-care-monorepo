# PD Copilot: de-identification boundary and saved modules

**Date:** 2026-11-05
**Status:** Approved for implementation

## Problem

PD Copilot is enabled on dev and runs against real staff APIs. Ten of its fifteen tools
return patient-level records carrying `case_number`, `full_name`, `line_user_id`,
`line_display_name`, `birth_date` and reviewer `real_name`. Every one of those fields
currently enters the LLM context verbatim.

That blocks production: enabling Copilot on prod today would send identifiable patient data
to OpenAI, and data sent to a third party cannot be recalled.

The constraint is narrower than "no patient data in Copilot". Generated reports are allowed
to display identifiable data, because they execute in the signed-in nurse's browser and
render only to that nurse. What must not happen is identifiers entering the model's context.

Separately, a report the assistant produces is discarded when the conversation moves on.
There is no way to keep a useful one and run it again next week.

## Goals

- No direct identifier reaches LLM context, in any environment.
- The assistant can still reason coherently about an individual patient's history.
- Nurses still read real names in chat answers.
- Generated reports may still show identifiable data at run time.
- Useful reports can be saved, browsed and re-run as parameterised modules.
- Sharing a module shares a capability, never a dataset.

## Non-goals

- Scrubbing the nurse's own typed input. A nurse who types a patient name sends it to the
  model. Intercepting free text needs a patient picker and detection heuristics; the
  boundary here covers what the *system* feeds the model.
- Purging existing dev transcripts. Dev holds seeded fake patients.
- Enabling production. That is a separate change and a separate decision.
- A host-rendered parameter schema for modules. Speculative until modules proliferate.

## Architecture

Two data paths, separated by whether the data can reach the model.

```text
Agent path      agent → dispatch_tool_call → [DE-IDENTIFY] → model context
                                                 ↓
                                        handles: P#3, R#1

Runtime path    iframe → postMessage → parent → /v1/copilot/proxy → staff API
                (full PII; renders to the signed-in nurse; never returns to the model)
```

The runtime path is unchanged. Only the agent path gains a boundary.

### De-identification boundary

New module `app/services/copilot/deidentify.py`, applied inside `dispatch_tool_call`
before truncation — the single existing choke point between a tool and the model.

**Field policy is an allowlist.** The mechanism is deny-by-default: a field passes only if
it appears in the policy, so a field added upstream is withheld until someone adds it
deliberately. There is no deny-list to keep in sync.

Allowed: `age`, dates and timestamps, symptom flags, counts, `screening_result`,
`probability`, `threshold`, `model_version`, `tier`, `label`, `gender`, `is_active`.
Without these quasi-identifiers the analysis is worthless.

These direct identifiers must never be added to the allowlist, and a test asserts each stays
out: `case_number`, `full_name`, `patient_full_name`, `line_user_id`, `line_display_name`,
`real_name`, `birth_date`, `picture_url`.

**Identity becomes a handle.** `patient_id: 412` → `P#3`; reviewer identity → `R#1`.
Handles are stable within a session so the model can follow one patient across several
calls. `upload_id` is retained as-is: it is an opaque surrogate key, not an identifier, and
tools need it to correlate.

**Handle registry.** Table `copilot_identity_handles`:

| column | notes |
| --- | --- |
| `session_id` | FK, CASCADE |
| `handle` | `P#3` |
| `entity_type` | `patient` or `identity` |
| `entity_id` | real row id |

Unique on `(session_id, handle)` and `(session_id, entity_type, entity_id)`. Scoped to the
session so handles cannot be correlated across conversations, and persisted so a transcript
reopened later still renders.

**Re-identification in the browser.** `GET /v1/copilot/sessions/{id}` returns a handle map,
and the message stream emits a `handle` event as each is minted. The frontend substitutes
labels when rendering, so the nurse reads 王小明 where the model saw `P#3`.

The map is resolved **per viewer**: on a shared session, a viewer not assigned that patient
receives no label and sees the bare handle. Otherwise sharing a transcript would bypass
assignment scoping.

### Module subsystem

Table `copilot_modules`: owner, title, description, `html`, visibility
(`private` / `staff` / `admin`), timestamps, plus `source_session_id` and
`source_message_id` for provenance. Writes are owner-only, matching sessions.

**A module stores code, never data.** Every figure it shows is fetched at run time through
`/v1/copilot/proxy` under the viewer's own token, so opening a colleague's module shows only
patients assigned to the viewer.

This paragraph originally read "this falls out of the existing proxy; no new enforcement",
which was wrong, and the branch review caught it: nothing stopped a *static* report with an
inline snapshot of identified rows from being saved and shared, and such a report never
touches the proxy at all. A module shared beyond its owner is therefore rejected at save and
update time unless its HTML actually calls the bridge. That check is a filter, not a proof —
bridge-using HTML can still embed a snapshot — so the property holds by convention plus a
save-time floor, not by construction.

**Running a shared module is deliberate.** A module the viewer does not own is never
auto-selected and does not execute until the viewer asks it to, with the author named. The
first implementation auto-selected the newest visible module and ran it on page load, which
meant visiting the page executed a colleague's arbitrary JavaScript under the viewer's own
token. One deliberate click still does that, which is a sharing-posture question rather than
a bug, and is recorded as an open residual.

**Parameters are self-contained.** The module's own HTML renders its controls — a patient
`<select>` populated from `pdcare.query('list_patients')`, a date range, a lookback. The
bridge returns identified data at run time, which is what a picker needs. The system prompt
gains a layout convention so modules look consistent.

This also resolves a consequence of the boundary: the assistant only ever knows `P#3`, so it
cannot hard-code a chosen patient into module code even when asked for "王小明的報表". A
picker is the mechanism by which the module reaches a specific patient, and the nurse makes
that choice at run time.

**Endpoints** (`/v1/copilot/modules`, staff or admin):

| endpoint | behaviour |
| --- | --- |
| `GET` | modules visible to the caller |
| `POST` | save; `visibility=admin` requires admin |
| `GET /{id}` | fetch one, visibility-checked |
| `PATCH` / `DELETE /{id}` | owner only |

**UI.** A 「儲存為模組」 control beside the existing artifact buttons, opening a dialog for
title, description and visibility. A new `/admin/modules` page plus sidebar entry lists
visible modules and opens one full-width.

The runner reuses `buildArtifactDocument` and the existing sandbox wholesale: same CSP, same
postMessage bridge, same error capture. No second rendering path — forking security-critical
code is how two copies drift.

A saved module that throws shows the error and offers 「在 Copilot 中開啟修正」, seeding a new
session with the module HTML and the error. Automatic repair needs a live session and so
does not apply.

## Testing

The boundary is where a bug becomes a data-protection incident, so its tests are adversarial.

| test | pins |
| --- | --- |
| Leak sweep, parameterised over every patient-level tool: seed `王小明` / `P123456` / `U_TEST`, dispatch, assert absent from model input | a tool added without policy coverage fails loudly |
| Deny-by-default: inject an unknown field, assert it is dropped | the `labeled_uploads` failure mode, for PII |
| Handle stability: same patient twice in a session → same handle; across sessions → different | coherent reasoning; no cross-session correlation |
| Re-identification permission: unassigned viewer gets the bare handle | sharing a transcript cannot bypass assignment scoping |
| Agent payload: fake OpenAI, assert outgoing `input` carries no PII | end-to-end, same shape as the `status` regression test |
| Module visibility matrix; non-owner writes rejected | matches session semantics |
| A saves a module, B runs it, B sees only B's patients | the capability-not-data claim |
| Frontend: runner reuses sandbox attributes and CSP | no divergent rendering path |

## Rollout

1. De-identification, merged and verified on dev: a transcript showing handles, and the UI
   re-identifying them.
2. Production enablement — separate PR, separate decision. ConfigMap flag,
   `OPENAI_API_KEY` in the prod secret, rollout.
3. Modules, independent of the production question.

Two additive migrations off a single head. Existing dev transcripts are left alone: dev
holds seeded fake patients.

## Risks

- **The nurse's own input is out of scope.** Typing a patient name still sends it to the
  model. Worth telling pilot users plainly; a patient picker would be the follow-up.
- **Deny-by-default can hide a field the analysis wants.** The failure is visible (a missing
  number) rather than silent, and the fix is one allowlist entry.
- **Handles cost the model some fluency.** It can no longer say 王小明. Chat answers read
  naturally only after the frontend substitutes labels back.
