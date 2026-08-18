# `/report-with-demo` skill design

## Goal

Create a PD Care project skill invoked as `/report-with-demo <feature request>`. It turns the requested feature into a recorded, testable E2E acceptance contract before implementation, then delivers a reproducible demo video and diagnostic artifacts after implementation.

## Scope

- Project skill location: `.cursor/skills/report-with-demo/`.
- The skill is explicit-invocation only; it does not run for every feature automatically.
- It applies to feature work that has a user-observable browser flow.
- It uses development-only personas and synthetic data. It must never record production, real patient data, real LINE accounts, secrets, or external production services.
- It does not commit, push, deploy, or widen the requested feature scope.

## Workflow

### 1. Define the acceptance contract before editing application code

The skill inspects the relevant route, API, auth mode, existing tests, and available development personas. It saves an acceptance contract at:

`docs/e2e-contracts/<feature-slug>.md`

The contract records:

- user outcome and explicit non-goals;
- persona, seed data, and test environment;
- Given/When/Then steps;
- a visible assertion after every important action;
- the required successful final state for the demo;
- intended viewport(s);
- expected video, trace, and screenshot artifact names;
- known limitations and dependencies.

If a material product decision is ambiguous, the skill asks one focused question before implementation. Otherwise it states the contract and continues.

### 2. Implement only the contract

The implementation must include stable semantic selectors or `data-testid` attributes only where the E2E flow needs them. It must not use CSS layout classes or text concatenation as test selectors.

The E2E scenario uses deterministic development fixtures:

- existing dev personas or a documented equivalent;
- isolated seed/reset data;
- no real LINE login;
- predictable inference, storage, and notification behavior where required.

### 3. Verify and record

The skill uses Playwright as the primary E2E runner. The scenario records:

- a `.webm` video of the full successful flow;
- a Playwright trace;
- screenshots on failure;
- console and network evidence when a failure needs diagnosis.

Browser MCP may be used for interactive discovery, accessibility snapshots, screenshots, and smoke verification. It is not evidence of a completed demo because it cannot produce the required video artifact.

### 4. Bounded repair loop

The skill runs the scenario, diagnoses failures from artifacts, applies the smallest correct repair, and reruns it at most three times.

It classifies every failure before changing code:

| Failure class | Response |
| --- | --- |
| Contract assertion fails | Repair implementation or contract-derived test setup, then rerun. |
| Test harness/fixture failure | Repair deterministic development setup, then rerun. |
| Environment/service unavailable | Retry only when a transient recovery is plausible; otherwise stop and report the blocker. |
| Ambiguous product behavior | Stop and ask the user; do not guess. |

The skill must not treat a video file alone as success. Success requires the recorded scenario's assertions to pass.

### 5. Handoff

On success, the final response contains:

- acceptance contract path;
- changed files summary;
- E2E command and pass result;
- video, trace, and screenshot artifact paths;
- any intentional deviations or limitations;
- an explicit request for user feedback.

On failure after three attempts, the final response contains:

- the acceptance step that failed;
- diagnosis and attempt history;
- artifact paths;
- the smallest concrete blocker or user decision needed.

## Playwright bootstrap

This repository does not currently have a first-class Playwright configuration or E2E script. The first use of the skill must add the minimal local Playwright harness:

- explicit Playwright development dependency under `apps/frontend`;
- a Playwright configuration that stores artifacts outside source directories;
- an E2E script;
- a deterministic dev server launch strategy;
- one initial golden journey for the feature invoked with the skill.

The bootstrap is part of feature delivery only when the requested feature has a browser flow. It must not enable E2E in CI until a follow-up decision defines runtime, service fixtures, artifact retention, and cost.

## Non-goals

- Full visual-regression coverage.
- Recording a demo from a live or production deployment.
- Testing every invalid input in a browser; unit and API tests remain responsible for most branch coverage.
- Automatic product decisions, database destruction, data mutations outside development fixtures, or unbounded retry loops.

## Success criteria

1. A new `/report-with-demo` invocation writes a durable, reviewable contract before feature implementation.
2. A successful browser feature delivery includes a passed Playwright scenario, a video, and a trace tied to that contract.
3. Failures are diagnosed with artifacts and stop after three repair attempts rather than silently passing or looping indefinitely.
4. The workflow does not expose patient data or rely on real LINE authentication.
