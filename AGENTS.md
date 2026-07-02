# Agent guide (PD Care)

Concise instructions for coding agents working in this monorepo. For product and architecture detail, start with [README.md](README.md).

## What this repo is

Peritoneal dialysis exit-site imaging platform: Next.js frontend (`apps/frontend`), FastAPI backend with ML inference (`apps/backend`), PostgreSQL, and SeaweedFS. Runs via Docker Compose locally or Kubernetes (`k8s/overlays/dev`, `k8s/overlays/prod`).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/frontend/` | Next.js patient/staff UI (LIFF, TLS gateway in Compose) |
| `apps/backend/` | FastAPI API, Alembic migrations, inference services |
| `k8s/` | Kustomize overlays for `pd-care-dev` and `pd-care-prod` |
| `docs/deploy/` | K8s runbooks (minikube, zero-downtime rollout, migration) |
| `.cursor/skills/ship-and-deploy/` | Commit, push, and deploy workflow for agents |

## How to work

- **Minimize scope** — smallest correct change; do not refactor unrelated code.
- **Match conventions** — read surrounding files first; reuse existing patterns, names, and abstractions.
- **Comments** — only for non-obvious business logic; code should mostly speak for itself.
- **Secrets** — never commit `.env`, `k8s/overlays/*/secret.yaml`, tokens, or credentials.
- **Commits** — only when the user asks. Use `type(scope): summary` messages; explain *why* in the body.
- **Frontend deps** — use `npx` when installing/updating npm packages in `apps/frontend`.

## Common commands

```bash
# Local dev (frontend + backend with reload)
npm run dev

# Lint (same as pre-commit / pre-push hooks)
npm run lint

# Backend tests (see test policy below)
npm run test

# Compose (detached, scoped)
docker compose up --build -d frontend
docker compose up --build -d backend
```

Deploy and production operations are **not** defaulted here — use [.cursor/skills/ship-and-deploy/SKILL.md](.cursor/skills/ship-and-deploy/SKILL.md) and ask the user for target (Compose vs K8s, dev vs prod) when shipping.

## Test execution policy

**Goal:** avoid long, repeated test runs during implementation.

- Do **not** run full test suites during normal coding (`npm test`, `pytest`, etc.) unless the user asks.
- Run tests when:
  - the user explicitly requests them,
  - you are in final verification immediately before commit/push, or
  - a git hook runs them (hooks currently run **lint only**, not full tests).
- Prefer lightweight checks while iterating (syntax, focused lint, reading related tests).

## Production safety

Treat production data as authoritative. Without explicit user approval, do **not**:

- `docker compose down -v`, `docker volume rm`, or `docker system prune --volumes`
- `kubectl delete pvc` or `kubectl delete namespace` in `pd-care-prod`
- Full-stack restarts when a scoped service redeploy suffices
- Restart Postgres or SeaweedFS for frontend-only changes

On K8s prod, backend schema changes use the `backend-migrate` Job before rollout; pods run with `RUN_DB_MIGRATIONS=false`. See [docs/deploy/k8s-zero-downtime-rollout.md](docs/deploy/k8s-zero-downtime-rollout.md).

## When setup changes

If you edit git hooks, `package.json` deploy scripts, Docker Compose files, or deploy docs, update the ship-and-deploy skill in the same PR and run:

```bash
.cursor/skills/ship-and-deploy/scripts/audit-sources.sh
```

See [.cursor/rules/maintain-ship-deploy-skill.mdc](.cursor/rules/maintain-ship-deploy-skill.mdc).

## Further reading

- [README.md](README.md) — features, architecture, local startup
- [apps/backend/README.md](apps/backend/README.md) — API, migrations, model bake
- [docs/deploy/k8s-minikube.md](docs/deploy/k8s-minikube.md) — K8s deploy and verification
- [docs/deploy/k8s-zero-downtime-rollout.md](docs/deploy/k8s-zero-downtime-rollout.md) — prod rolling upgrades
