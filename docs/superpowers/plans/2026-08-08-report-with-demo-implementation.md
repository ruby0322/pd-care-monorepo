# Report With Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `/report-with-demo` project skill and the minimal Playwright harness needed to create deterministic, recorded E2E acceptance evidence for future browser features.

**Architecture:** The project skill writes a durable E2E contract before modifying feature code, then derives a feature-specific Playwright scenario from that contract. A generic frontend Playwright configuration records video, traces, and failure screenshots into ignored local artifact directories. The skill owns the workflow; individual feature tests own their personas, seed/reset calls, and assertions.

**Tech Stack:** Cursor Agent Skills, Next.js development server, Playwright Chromium, existing development personas, FastAPI local development environment.

## Global Constraints

- The skill is invoked explicitly as `/report-with-demo`; it must not run automatically.
- Never use production, real patient data, real LINE accounts, secrets, or external production services.
- Use deterministic development personas and data; tests must not use CSS classes, `nth-child`, or fragile text concatenation as selectors.
- Record a `.webm` video and Playwright trace only after the contract's assertions pass.
- Limit diagnose/fix/rerun loops to three attempts; stop for product ambiguity or non-transient environmental blockers.
- Do not add E2E execution to CI in this change.
- Do not commit, push, or deploy as part of the skill workflow.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `.cursor/skills/report-with-demo/SKILL.md` | Explicit slash-command workflow from contract through bounded recorded verification and handoff. |
| `.cursor/skills/report-with-demo/contract-template.md` | Required durable contract structure for every invocation. |
| `apps/frontend/playwright.config.ts` | Local Chromium project, base URL, video/trace/screenshot artifact policy, and test discovery. |
| `apps/frontend/e2e/support/dev-persona.ts` | Reusable helper that opens a deterministic existing dev persona without real LIFF. |
| `apps/frontend/e2e/example-contract.spec.ts` | Non-production example that proves the test harness can record a simple dev-persona navigation; future feature scenarios replace it with contract-specific assertions. |
| `apps/frontend/package.json` | Explicit Playwright dependency and `test:e2e` / `test:e2e:demo` scripts. |
| `apps/frontend/.gitignore` | Ignore Playwright reports, traces, videos, screenshots, and test results. |
| `docs/e2e-contracts/README.md` | Explains contract naming, data-safety requirements, and artifact linking. |

### Task 1: Add the explicit acceptance-and-demo skill

**Files:**
- Create: `.cursor/skills/report-with-demo/SKILL.md`
- Create: `.cursor/skills/report-with-demo/contract-template.md`
- Create: `docs/e2e-contracts/README.md`
- Test: `.cursor/skills/report-with-demo/SKILL.md`

**Interfaces:**
- Consumes: an explicit user invocation in the form `/report-with-demo <feature request>`.
- Produces: `docs/e2e-contracts/<feature-slug>.md`, a feature-local Playwright scenario, and local artifact paths.

- [ ] **Step 1: Write the contract template**

Create `.cursor/skills/report-with-demo/contract-template.md` with these required sections:

```markdown
# <Feature> E2E acceptance contract

## Outcome
## Non-goals
## Environment and safety
- Persona:
- Seed/reset command or fixture:
- Browser viewport:
- Prohibited data/services:

## Scenario
| Step | Given / When / Then | Visible assertion |
| --- | --- | --- |

## Demo evidence
- Video:
- Trace:
- Failure screenshots:

## Known limitations
```

- [ ] **Step 2: Write the skill workflow**

Create `.cursor/skills/report-with-demo/SKILL.md` with frontmatter:

```markdown
---
name: report-with-demo
description: Defines a durable E2E acceptance contract before implementing a browser feature, then runs a deterministic Playwright scenario and records demo video, trace, and failure evidence. Use only when explicitly invoked as /report-with-demo.
disable-model-invocation: true
---
```

Require this exact execution order:

1. Inspect relevant routes, APIs, auth mode, tests, and development personas.
2. Save the completed contract under `docs/e2e-contracts/`.
3. Ask one question only if a material acceptance decision is ambiguous; otherwise state the contract and begin implementation.
4. Implement the requested scope and add only the semantic or `data-testid` selectors required by the contract.
5. Write a feature-specific Playwright scenario that uses deterministic development data and the contract's exact assertions.
6. Run the scenario with video and trace enabled.
7. On failure, inspect artifacts, classify the failure, apply the smallest repair, and retry at most three total attempts.
8. On success, report contract, command, video, trace, screenshots, limitations, and wait for user feedback.
9. On final failure, report the failed step, diagnosis, attempt history, artifacts, and smallest blocker; do not claim success.

Include a failure-class table matching the design specification: contract assertion failure, fixture/harness failure, transient/unavailable service, and ambiguous product behavior.

- [ ] **Step 3: Document durable contract conventions**

Create `docs/e2e-contracts/README.md`:

```markdown
# E2E acceptance contracts

Create one contract per `/report-with-demo` invocation at `<feature-slug>.md`.
Contracts and feature test source are committed with the feature. Generated videos,
traces, screenshots, Playwright reports, and test results are local artifacts and
must not be committed.

Use only local development personas and synthetic seed data. Never record a
production host, a real LINE account, a patient record, a secret, or a token.
```

- [ ] **Step 4: Verify skill structure**

Run:

```bash
test -s .cursor/skills/report-with-demo/SKILL.md
test -s .cursor/skills/report-with-demo/contract-template.md
test -s docs/e2e-contracts/README.md
```

Expected: all commands exit `0`.

### Task 2: Add the local Playwright recording harness

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/playwright.config.ts`
- Modify: `apps/frontend/.gitignore`
- Create: `apps/frontend/e2e/support/dev-persona.ts`
- Create: `apps/frontend/e2e/example-contract.spec.ts`
- Test: `apps/frontend/e2e/example-contract.spec.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_LIFF_ID` unset, local frontend at `http://127.0.0.1:3000`, and seeded development personas.
- Produces: `apps/frontend/test-results/`, `apps/frontend/playwright-report/`, and `apps/frontend/e2e-artifacts/` local-only evidence.
- Exports: `openDevPersona(page: Page, personaId: string, expectedPath: string): Promise<void>`.

- [ ] **Step 1: Add Playwright and scripts**

From `apps/frontend`, add the current `@playwright/test` development dependency with `npx`, then add:

```json
"test:e2e": "playwright test",
"test:e2e:demo": "playwright test --project=chromium"
```

Run:

```bash
npx playwright install chromium
```

Expected: Chromium browser installation completes successfully.

- [ ] **Step 2: Write the deterministic Playwright configuration**

Create `apps/frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on",
    video: "on",
    screenshot: "only-on-failure",
    viewport: { width: 390, height: 844 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 3: Write a reusable development-persona helper**

Create `apps/frontend/e2e/support/dev-persona.ts`:

```ts
import { expect, type Page } from "@playwright/test";

export async function openDevPersona(page: Page, personaId: string, expectedPath: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(expectedPath)}&dev_line_user_id=${encodeURIComponent(personaId)}`);
  await page.waitForURL(new RegExp(`${expectedPath.replace("/", "\\/")}(?:\\?.*)?$`));
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replace("/", "\\/")}(?:\\?.*)?$`));
}
```

- [ ] **Step 4: Write a recording smoke scenario**

Create `apps/frontend/e2e/example-contract.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { openDevPersona } from "./support/dev-persona";

test("development patient persona reaches the patient dashboard", async ({ page }) => {
  await openDevPersona(page, "U_DEV_PAT_MATCH", "/patient");
  await expect(page.getByRole("main")).toBeVisible();
});
```

- [ ] **Step 5: Ignore generated evidence**

Append to `apps/frontend/.gitignore`:

```gitignore
# Playwright local evidence
/test-results/
/playwright-report/
/e2e-artifacts/
```

- [ ] **Step 6: Start deterministic local dependencies**

Run in separate terminals:

```bash
npm run dev:infra
npm run seed:dev-personas
npm run dev
```

Expected: frontend is reachable on `http://127.0.0.1:3000`, backend is reachable on `http://127.0.0.1:8000`, and the seeded `U_DEV_PAT_MATCH` persona exists.

- [ ] **Step 7: Run the recorded scenario**

Run:

```bash
npm --prefix apps/frontend run test:e2e:demo
```

Expected: Playwright reports one passed test, and `apps/frontend/test-results/` contains a `.webm` video and `trace.zip`.

### Task 3: Verify documentation, lint, and feature handoff behavior

**Files:**
- Modify: `.cursor/skills/report-with-demo/SKILL.md`
- Test: `apps/frontend/e2e/example-contract.spec.ts`

**Interfaces:**
- Consumes: the Task 1 skill and Task 2 Playwright configuration.
- Produces: a verified documented workflow that does not overstate success when only an artifact exists.

- [ ] **Step 1: Run focused frontend lint**

Run:

```bash
npm --prefix apps/frontend run lint
```

Expected: exit `0` with no errors in `playwright.config.ts` or `e2e/`.

- [ ] **Step 2: Verify recorded artifact policy**

Run:

```bash
git check-ignore apps/frontend/test-results/example-contract-development-patient-persona-reaches-the-patient-dashboard-chromium/video.webm
git check-ignore apps/frontend/playwright-report/index.html
```

Expected: both paths are reported as ignored.

- [ ] **Step 3: Perform the skill dry-run review**

Read `.cursor/skills/report-with-demo/SKILL.md` and confirm it contains all of:

```text
docs/e2e-contracts/
at most three
video
trace
real LINE
wait for user feedback
```

Expected: every required phrase is present and the skill never authorizes automatic commit, push, deployment, production access, or unbounded retries.
