---
name: report-with-demo
description: Defines a durable E2E acceptance contract before implementing a browser feature, then runs a deterministic Playwright scenario and records demo video, trace, and failure evidence. Use only when explicitly invoked as /report-with-demo.
disable-model-invocation: true
---

# Report With Demo

Use this skill only when the user explicitly invokes `/report-with-demo <feature request>`.

## Purpose

Turn a browser-facing feature request into:

1. a durable E2E acceptance contract written before feature implementation; and
2. reproducible evidence (video, trace, and diagnostics) generated from a deterministic Playwright scenario.

## Hard Rules

- Never use production data, real patient identities, real LINE accounts, or secrets.
- Never record or test against production hosts.
- Never widen scope beyond the requested feature and written acceptance contract.
- Never auto-commit, auto-push, or auto-deploy.
- Never run an unbounded retry loop. The maximum is **at most three** repair attempts.

## Required Workflow

### 1) Inspect and constrain before coding

Read the relevant frontend routes, backend endpoints, auth mode, existing tests, and available development personas.

If there is a material acceptance ambiguity, ask one focused question before implementation.

### 2) Write the acceptance contract first

Create and save:

`docs/e2e-contracts/<feature-slug>.md`

Use `.cursor/skills/report-with-demo/contract-template.md`.

The contract must include:

- outcome and explicit non-goals;
- environment and safety constraints;
- deterministic persona + seed/reset setup;
- Given/When/Then scenario steps;
- visible assertion per important step;
- required demo evidence outputs;
- known limitations.

### 3) Implement only contract-defined scope

Implement the requested feature according to the contract.

Add semantic selectors or `data-testid` only where needed for stable E2E interaction. Do not use fragile CSS selectors, layout classes, `nth-child`, or text concatenation as primary locators.

### 4) Write deterministic Playwright scenario

Create or update a feature-specific Playwright test that:

- uses development personas and deterministic setup;
- mirrors the contract steps exactly;
- asserts every contract-visible outcome;
- records video and trace through Playwright config.

Browser MCP can be used for exploration or smoke verification, but it is not completion evidence because it does not produce the required demo video artifact.

### 5) Execute, diagnose, and bounded retry

Run the scenario and classify failures before changing code:

| Failure class | Action |
| --- | --- |
| Contract assertion fails | Repair implementation or contract-derived setup and rerun. |
| Test harness or fixture failure | Repair deterministic harness/setup and rerun. |
| Environment/service unavailable | Retry only if transient recovery is plausible; otherwise report blocker. |
| Ambiguous product behavior | Stop and ask the user. |

Run at most three diagnose/fix/rerun attempts.

A video file alone is not success. Success requires scenario assertions to pass.

### 6) Report and wait for feedback

On success, report:

- acceptance contract path;
- changed files summary;
- executed E2E command and pass result;
- video, trace, and screenshot paths;
- limitations/deviations.

Then explicitly **wait for user feedback**.

On failure after max attempts, report:

- failed acceptance step;
- attempt history and diagnosis;
- artifact paths;
- smallest concrete blocker or decision needed from user.
