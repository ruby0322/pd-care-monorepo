---
name: ship-and-deploy
description: >-
  Stage, commit, push, and redeploy the PD Care monorepo using project git
  hooks. Supports Docker Compose and Kubernetes (pd-care-dev / pd-care-prod).
  Ask the user for deploy target when method or environment is unspecified.
  Prefer scoped redeploys. Protect production data (volumes, PVCs, Postgres).
  Use when the user asks to ship, commit, push, deploy, redeploy, or release.
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
- `kubectl delete pvc ...` in `pd-care-prod` or any command that removes K8s stateful volumes
- `kubectl delete namespace pd-care-prod`
- Destructive SQL (`DROP`, `TRUNCATE`, manual `DELETE` at scale) or credential rotation on live Postgres
- Changing `PDCARE_POSTGRES_PORT_BIND` to expose Postgres beyond localhost
- Full-stack `docker compose down` when a scoped service rebuild is sufficient
- Restarting stateful services (`postgres`, SeaweedFS) when the diff does not touch them

### Always prefer

- **Scoped redeploy** — rebuild/restart only services affected by the diff
- **Rolling recreate** — Compose: `docker compose up --build -d <service>`; K8s: `kubectl rollout restart deploy/<name> -n <namespace>`
- **Data authority follows the chosen deploy path** — Compose named volumes when Compose is active production; `pd-care-prod` PVCs when K8s is active production (see [k8s-minikube.md](../../../docs/deploy/k8s-minikube.md) §8)
- **Migration caution** — backend start runs Alembic; review new migrations before redeploying backend on production

See [reference.md](reference.md) for the path → service mapping and forbidden-command list.

## Workflow overview

```text
Inspect → Stage → Commit → Push → [Disambiguate deploy] → Deploy → Verify → Report
```

Copy this checklist and track progress:

```text
Ship Progress:
- [ ] Inspect git state (status, diff, log)
- [ ] Stage intended files only
- [ ] Commit with HEREDOC message
- [ ] Push to remote
- [ ] If deploying: confirm deploy method + environment (ask if not specified)
- [ ] Determine affected services from diff (do not default to full stack)
- [ ] Redeploy affected services only
- [ ] Verify health / container or pod status
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

### 5a. Deploy target disambiguation (mandatory)

**Never assume a default deploy path.** Do not default to Docker Compose or K8s prod.

If the user requests deploy/redeploy/ship without stating **both** deploy method and environment, use **AskQuestion** before running deploy commands:

| Question | Options |
| --- | --- |
| Deploy method | Docker Compose \| Kubernetes \| Commit/push only (no deploy) |
| Environment (if K8s) | `pd-care-dev` \| `pd-care-prod` |
| Scope (confirm if inferable from diff) | frontend \| backend \| both \| ingress-bridge only |

**Proceed without asking** only when the user is explicit, for example:

- "deploy to prod k8s" → Kubernetes, `pd-care-prod`
- "restart dev frontend on k8s" → Kubernetes, `pd-care-dev`, frontend only
- `docker compose up --build -d backend` → Compose, backend only
- "commit and push only" → skip deploy

See [reference.md](reference.md) for per-target commands and verification.

### 5b. Decide scope from the diff

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

When both frontend and backend changed, redeploy both — still without `docker compose down` or namespace-wide restarts on K8s prod.

### 5c. Scoped redeploy — Docker Compose

**Use when deploy target is Compose.** Rebuilds only the target service; leaves Postgres/SeaweedFS running:

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

### 5d. Scoped redeploy — Kubernetes

**Use when deploy target is K8s.** Rebuild images inside Minikube docker, then rollout restart the affected deployment only.

```bash
eval "$(minikube docker-env)"

# Prod frontend (pd-care-prod)
docker build -t pd-care-frontend:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=<prod-liff-id> \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-prod

# Dev frontend (pd-care-dev) — separate tag and LIFF ID
docker build -t pd-care-frontend:dev \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=<dev-liff-id> \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-dev

# Backend (dev first, then prod after verification)
docker build -t pd-care-backend:latest ./apps/backend
kubectl rollout restart deploy/backend -n pd-care-dev
# kubectl rollout restart deploy/backend -n pd-care-prod
```

`pd-care-backend` build now bakes model artifacts into the image. Set `HF_TOKEN` in the environment when private Hub access or rate limits require auth.

| Change scope | Namespace | Command pattern |
| --- | --- | --- |
| Frontend only | `pd-care-dev` | build `:dev` image → `rollout restart deploy/frontend` |
| Frontend only | `pd-care-prod` | build `:latest` image → `rollout restart deploy/frontend` |
| Backend only | either | build backend image → `rollout restart deploy/backend` |
| Ingress bridge only | host | `docker compose -f docker-compose.ingress-bridge.yml up -d` |
| Docs/skills only | — | Skip deploy |

Full runbook: [docs/deploy/k8s-minikube.md](../../../docs/deploy/k8s-minikube.md).

### 5e. Full-stack redeploy (exception)

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

After deploy, verify according to the **chosen deploy target**:

**Docker Compose:**

```bash
docker compose ps
curl -sf http://127.0.0.1:8000/healthz
curl -sf http://127.0.0.1:8000/readyz
```

**Kubernetes:**

```bash
kubectl get pods -n <namespace>
curl -fsS https://<domain>/api/healthz
curl -fsS https://<domain>/api/readyz
```

Use `test.pd.lu.im.ntu.edu.tw` for dev, `pd.lu.im.ntu.edu.tw` for prod (ingress bridge must be running for public DNS).

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
| "redeploy" / "deploy" | 5–6 (ask deploy target if unspecified; infer scope from diff) |
| "ship it" / "stage, commit, push, redeploy" | 1–6 (ask deploy target if method/env not stated) |

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
