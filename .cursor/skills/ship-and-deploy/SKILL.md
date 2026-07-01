---
name: ship-and-deploy
description: >-
  Stage, commit, push, and redeploy the PD Care monorepo using project git
  hooks and Docker Compose. Prefer scoped redeploys of affected services only.
  Protect production data (volumes, Postgres, object storage). Use when the user
  asks to ship changes, commit, push, deploy, redeploy, or release.
---

# Ship and Deploy (PD Care)

End-to-end workflow for committing code and redeploying this repository.

**Before acting:** read [reference.md](reference.md) for current commands, ports, and hooks. If unsure whether facts are stale, run the audit script (see [Keep the skill current](#keep-the-skill-current)).

## Preconditions

- Only commit or push when the user explicitly asks.
- Never update git config, force-push to `main`/`master`, or skip hooks unless the user explicitly requests it.
- Do not commit secrets (`.env`, credentials, tokens).
- Follow [AGENTS.md](../../../AGENTS.md) test policy: hooks run lint on commit/push; do not run full tests during implementation unless the user asks or you are in final pre-ship verification.

## Production safety (mandatory)

**Goal:** do not harm production data, and do not spend unnecessary deploy time.

### Never without explicit user approval

- `docker compose down -v` or any command that removes named volumes
- `docker volume rm`, `docker system prune --volumes`
- Destructive SQL (`DROP`, `TRUNCATE`, manual `DELETE` at scale) or credential rotation on live Postgres
- Changing `PDCARE_POSTGRES_PORT_BIND` to expose Postgres beyond localhost
- Full-stack `docker compose down` when a scoped service rebuild is sufficient
- Restarting stateful services (`postgres`, SeaweedFS) when the diff does not touch them

### Always prefer

- **Scoped redeploy** — rebuild/restart only services affected by the diff
- **Rolling recreate** — `docker compose up --build -d <service>` without stopping unrelated containers
- **Volume preservation** — assume Postgres + SeaweedFS + model cache volumes contain production data
- **Migration caution** — backend start runs Alembic; review new migrations before redeploying backend on production

See [reference.md](reference.md) for the path → service mapping and forbidden-command list.

## Workflow overview

```text
Inspect → Stage → Commit → Push → Deploy → Verify → Report
```

Copy this checklist and track progress:

```text
Ship Progress:
- [ ] Inspect git state (status, diff, log)
- [ ] Stage intended files only
- [ ] Commit with HEREDOC message
- [ ] Push to remote
- [ ] Determine affected services from diff (do not default to full stack)
- [ ] Redeploy affected services only
- [ ] Verify health / container status
- [ ] Report commit hash, push result, deploy scope + result
```

## Step 1 — Inspect (parallel)

Run in parallel from repo root:

```bash
git status --short
git diff && git diff --staged
git log -5 --oneline
```

Analyze all staged and unstaged changes. Match recent commit style (`feat(scope):`, `fix(scope):`, `refactor(scope):`).

## Step 2 — Stage

Stage only files that belong to the requested change:

```bash
git add <paths>
```

Exclude secret files. Warn the user if they asked to commit sensitive paths.

## Step 3 — Commit

Use a HEREDOC commit message focused on **why**:

```bash
git commit -m "$(cat <<'EOF'
fix(scope): short summary

One or two sentences explaining intent.
EOF
)"
```

### Hook failures

- `pre-commit` runs `npm run lint` (frontend eslint + migration policy check).
- If the hook modifies files, fix issues and create a **new** commit (do not amend unless all amend rules from user instructions are satisfied).
- If commit is rejected, never amend a failed commit — fix and commit again.

## Step 4 — Push

```bash
git push
```

- `pre-push` also runs `npm run lint`.
- Push only when the user asked. Use `-u origin HEAD` for new branches.
- Do not push with `--force` to `main`/`master` unless explicitly requested (and warn).

## Step 5 — Deploy

### 5a. Decide scope from the diff

Inspect changed paths (`git diff --name-only` against the deploy baseline, usually `HEAD~1` or the pushed commits). Map to services:

| Changed paths | Redeploy | Do **not** restart |
| --- | --- | --- |
| `apps/frontend/**` | `frontend` | backend, postgres, SeaweedFS |
| `apps/backend/**` (incl. migrations) | `backend` | postgres, SeaweedFS (unless explicitly required) |
| `docker-compose.yml`, env defaults | Ask user; often `frontend` + `backend` | postgres, SeaweedFS unless compose changed their service defs |
| `docker-compose.gpu.yml` | `backend` via GPU override | unrelated services |
| `docker-compose.observability.yml` | observability stack only | app services |
| docs, skills, tests only | **Skip deploy** | everything |
| `ops/security/**` | **Ask user** — usually no redeploy | — |

When both frontend and backend changed, redeploy both — still without `docker compose down`.

### 5b. Scoped redeploy (default)

**Prefer this.** Rebuilds only the target service; leaves Postgres/SeaweedFS running:

```bash
# frontend-only example
docker compose up --build -d frontend

# backend-only example
docker compose up --build -d backend

# both changed
docker compose up --build -d frontend backend
```

| Change scope | Command | Notes |
| --- | --- | --- |
| Frontend only | `docker compose up --build -d frontend` | Next.js + TLS gateway |
| Backend only | `docker compose up --build -d backend` | Runs Alembic on start — review migrations first |
| Frontend + backend | `docker compose up --build -d frontend backend` | No full-stack stop |
| GPU host backend | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d backend` | GPU override |
| Observability | `npm run docker:up:obs` | Does not touch app data services |
| Foreground dev stack | `npm run docker:up` | Local dev only; blocks terminal |

### 5c. Full-stack redeploy (exception)

Use only when the user explicitly requests it **or** compose/network changes require recreating every service:

```bash
docker compose down && docker compose up --build -d
```

Before full-stack down on a production-like host:

1. Confirm no safer scoped redeploy works.
2. Never add `-v`.
3. Warn about brief downtime for frontend/backend (Postgres/SeaweedFS volumes persist, but app goes offline during down).

**Data safety:** `docker compose down` without `-v` preserves named volumes, but still causes unnecessary downtime if scoped redeploy would suffice.

See [reference.md](reference.md) for ports, health endpoints, and the full safety checklist.

## Step 6 — Verify

After deploy:

```bash
docker compose ps
curl -sf http://127.0.0.1:8000/healthz
curl -sf http://127.0.0.1:8000/readyz
```

Report:

- Commit hash and message
- Push target branch and result
- **Deploy scope** (which services rebuilt and why, based on diff)
- Services rebuilt and their status (`healthy` / `up`)
- Any hook warnings or orphan containers noted by compose
- Explicit confirmation that no volume-destructive commands were run

## Partial workflows

| User request | Steps |
| --- | --- |
| "stage, commit, push" | Steps 1–4 + verify clean tree |
| "commit and push" | 1–4 |
| "redeploy" / "deploy" | 5–6 (infer scope from diff; ask if ambiguous) |
| "ship it" / "stage, commit, push, redeploy" | 1–6 |

## Keep the skill current

When any file listed in [MANIFEST.json](MANIFEST.json) changes, update the skill in the **same PR**:

1. Run audit:

   ```bash
   .cursor/skills/ship-and-deploy/scripts/audit-sources.sh
   ```

2. Update affected sections in `reference.md` / `SKILL.md`.
3. Bump `MANIFEST.json`:
   - `last_audited_commit` → current `HEAD`
   - `last_audited_at` → today (ISO date)
   - `version` → patch bump if deploy behavior changed
4. Append a row to [CHANGELOG.md](CHANGELOG.md).

The audit script exits non-zero when sources changed after `last_audited_commit`, signaling required skill updates.

## Additional resources

- [reference.md](reference.md) — commands, ports, hooks, verification
- [MANIFEST.json](MANIFEST.json) — tracked source files
- [CHANGELOG.md](CHANGELOG.md) — skill revision history
- [scripts/audit-sources.sh](scripts/audit-sources.sh) — drift detector
