---
name: ship-and-deploy
description: >-
  Stage, commit, push, and redeploy the PD Care monorepo using project git
  hooks. Supports Docker Compose and Kubernetes (pd-care-dev / pd-care-prod).
  Prod K8s uses zero-downtime rolling (replicas 2, migrate Job for backend).
  Ask the user for deploy target when method or environment is unspecified.
  Prefer scoped redeploys. Protect production data (volumes, PVCs, Postgres).
  Use when the user asks to ship, commit, push, deploy, redeploy, or release.
---

# Ship and Deploy (PD Care)

End-to-end workflow for committing code and redeploying this repository.

**Before acting:** read [reference.md](reference.md) for current commands, ports, and hooks. If unsure whether facts are stale, run the audit script (see [Keep the skill current](#keep-the-skill-current)).

## Preconditions

- Only commit or push when the user explicitly asks — or use [stage-commit-push](../stage-commit-push/SKILL.md) for git-only ship on ruby0322's behalf.
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
- **Migration caution** — review new Alembic migrations before backend deploy; on K8s prod run `backend-migrate` Job once before rollout (pods use `RUN_DB_MIGRATIONS=false`)
- **Prod zero-downtime rolling** — `pd-care-prod` FE/BE use `replicas: 2`, `maxUnavailable: 0`, `maxSurge: 1`; see [k8s-zero-downtime-rollout.md](../../../docs/deploy/k8s-zero-downtime-rollout.md)

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
| Deploy method | Docker Compose \| Kubernetes (direct rollout) \| Kubernetes (Argo CD GitOps) \| Commit/push only (no deploy) |
| Environment (if K8s) | `pd-care-dev` \| `pd-care-prod` |
| Scope (confirm if inferable from diff) | frontend \| backend \| both \| ingress-bridge only |

**Proceed without asking** only when the user is explicit, for example:

- "deploy to prod k8s" → Kubernetes, `pd-care-prod`
- "restart dev frontend on k8s" → Kubernetes, `pd-care-dev`, frontend only
- "promote prod via Argo CD" → Kubernetes (Argo CD GitOps), `pd-care-prod`
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
| `docker-compose.observability.yml` | observability stack only | app services |
| `k8s/**` | `kubectl apply -k k8s/overlays/<env>` if manifests changed, then affected deploy rollouts | postgres, SeaweedFS unless their manifests changed |
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
| Observability | `npm run docker:up:obs` | Does not touch app data services |
| Foreground dev stack | `npm run docker:up` | Local dev only; blocks terminal |

### 5d. Scoped redeploy — Kubernetes

**Use when deploy target is K8s.** Rebuild images inside Minikube docker, then rollout restart the affected deployment only.

If `k8s/**` changed, apply manifests first:

```bash
kubectl apply -k k8s/overlays/prod   # or k8s/overlays/dev
```

#### Prod frontend (`pd-care-prod`) — zero-downtime rolling

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-uzPg8SgK \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-prod
kubectl rollout status deploy/frontend -n pd-care-prod --timeout=300s
```

No migration Job. Prod frontend runs `replicas: 2` with `maxUnavailable: 0`.

#### Prod backend (`pd-care-prod`) — zero-downtime rolling

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-backend:latest ./apps/backend

# Run migrations once via Job (required when apps/backend/migrations/** changed)
kubectl delete job backend-migrate -n pd-care-prod --ignore-not-found
kubectl apply -f k8s/overlays/prod/migrate-job.yaml -n pd-care-prod
kubectl wait --for=condition=complete job/backend-migrate -n pd-care-prod --timeout=300s

kubectl rollout restart deploy/backend -n pd-care-prod
kubectl rollout status deploy/backend -n pd-care-prod --timeout=600s
```

Prod backend pods set `RUN_DB_MIGRATIONS=false`; Alembic runs only in the Job. If the diff has **no** migration files, the Job is still safe (idempotent `upgrade head`) but can be skipped when you are certain schema is unchanged.

`pd-care-backend` bakes model artifacts at build time. Set `HF_TOKEN` when private Hub access or rate limits require auth.

#### Dev (`pd-care-dev`)

```bash
eval "$(minikube docker-env)"

# Dev frontend — separate tag and LIFF ID
docker build -t pd-care-frontend:dev \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-B0JCWwiu \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-dev

# Dev backend — single replica; migrations run on pod start
docker build -t pd-care-backend:latest ./apps/backend
kubectl rollout restart deploy/backend -n pd-care-dev
```

| Change scope | Namespace | Command pattern |
| --- | --- | --- |
| Frontend only | `pd-care-dev` | build `:dev` image → `rollout restart deploy/frontend` |
| Frontend only | `pd-care-prod` | build `:latest` image → `rollout restart deploy/frontend` → `rollout status` |
| Backend only | `pd-care-dev` | build backend image → `rollout restart deploy/backend` |
| Backend only | `pd-care-prod` | build backend image → migrate Job → `rollout restart deploy/backend` → `rollout status` |
| `k8s/**` manifests | either | `kubectl apply -k k8s/overlays/<env>` then service rollout as above |
| Ingress bridge only | host | `docker compose -f docker-compose.ingress-bridge.yml up -d` |
| Docs/skills only | — | Skip deploy |

Runbooks: [k8s-minikube.md](../../../docs/deploy/k8s-minikube.md), [k8s-zero-downtime-rollout.md](../../../docs/deploy/k8s-zero-downtime-rollout.md).

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
kubectl get deploy backend frontend -n <namespace>
kubectl get pods -n <namespace>
curl -fsS https://<domain>/api/healthz
curl -fsS https://<domain>/api/readyz
```

Use `test.pd.lu.im.ntu.edu.tw` for dev, `pd.lu.im.ntu.edu.tw` for prod (ingress bridge must be running for public DNS).

For prod rolling deploys, expect `backend 2/2` and `frontend 2/2`. Optional continuous probe during rollout: see [k8s-zero-downtime-rollout.md](../../../docs/deploy/k8s-zero-downtime-rollout.md).

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
- [k8s-zero-downtime-rollout.md](../../../docs/deploy/k8s-zero-downtime-rollout.md) — prod rolling upgrade runbook
- [MANIFEST.json](MANIFEST.json) — tracked source files
- [CHANGELOG.md](CHANGELOG.md) — skill revision history
- [scripts/audit-sources.sh](scripts/audit-sources.sh) — drift detector
