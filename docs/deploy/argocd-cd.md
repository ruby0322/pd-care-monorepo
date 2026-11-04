# Argo CD CD Runbook

This runbook defines the GitOps delivery path for PD Care with:

- Argo CD auto-sync for `pd-care-dev`
- Git-based promotion for `pd-care-prod` (no manual approval gate)
- One-shot migration hook before prod backend rollout

## 1) Repository and controller layout

- Argo CD project and applications:
  - `k8s/argocd/project.yaml`
  - `k8s/argocd/dev-application.yaml`
  - `k8s/argocd/prod-application.yaml`
- Source of truth overlays:
  - `k8s/overlays/dev/kustomization.yaml`
  - `k8s/overlays/prod/kustomization.yaml`
- Config-change restart controller (one namespace-scoped instance per overlay):
  - `k8s/base/reloader-deployment.yaml`
  - `k8s/base/reloader-rbac.yaml`
  - `k8s/base/reloader-serviceaccount.yaml`
  - See §10 for behaviour and RBAC.
- Baseline overlays omit GHCR `images:` entries and use local image names
  (`pd-care-frontend:latest`, `pd-care-backend:latest`) until CD writes
  `dev-sha-...` / `sha-...` or `prod-sha-...` tags. Infra-only merges therefore
  do not point Argo CD at nonexistent registry tags.
- **Platform layer** (cert-manager Issuer/Certificates, Argo CD ingress) is
  bootstrap-applied today, not an Argo Application. Deferred improvements:
  [`backlog/platform-gitops.md`](../backlog/platform-gitops.md).
- Repository URL used by Argo CD:
  - `https://github.com/ruby0322/pd-care-monorepo.git` (**public** — no Git credential required for Argo CD sync)

Apply Argo CD resources:

```bash
kubectl apply -f k8s/argocd/project.yaml
kubectl apply -f k8s/argocd/dev-application.yaml
kubectl apply -f k8s/argocd/prod-application.yaml
```

### Argo CD dashboard (UI)

`argocd-server` is ClusterIP only — use localhost port-forward for the web UI:

```bash
bash ops/deploy/argocd-ui-portforward.sh
# Open http://127.0.0.1:8080 (user: admin; HTTP when server.insecure is enabled)
```

See [argocd-dashboard.md](argocd-dashboard.md) for login, SSH tunnel, and external UI at
`https://argocd.pd.lu.im.ntu.edu.tw` (Ingress + cert-manager; port-forward fallback).

### Argo CD Git repository credentials

`pd-care-monorepo` is a **public** GitHub repository. Argo CD can clone
`https://github.com/ruby0322/pd-care-monorepo.git` without a deploy key or PAT.
**Skip `GITHUB_PAT` for the current setup.**

GHCR image pulls are separate from Git access: the cluster still needs
`ghcr-pull-secret` when packages are private (see §2).

If the repository is ever made private, configure read access with one of:

Option A — Argo CD CLI (PAT with `repo` read scope):

```bash
argocd repo add https://github.com/ruby0322/pd-care-monorepo.git \
  --username git \
  --password "<github-pat>"
```

Option B — Kubernetes secret (Argo CD reads `argocd` namespace repo secrets):

```bash
kubectl -n argocd create secret generic repo-pd-care-monorepo \
  --from-literal=type=git \
  --from-literal=url=https://github.com/ruby0322/pd-care-monorepo.git \
  --from-literal=username=git \
  --from-literal=password="<github-pat>"
kubectl -n argocd label secret repo-pd-care-monorepo \
  argocd.argoproj.io/secret-type=repository
```

Verify repository connectivity:

```bash
argocd repo list
argocd app get pd-care-dev
argocd app get pd-care-prod
```

## 2) Required cluster settings (GHCR pull auth)

Bootstrap helper (installs Argo CD if missing, applies apps, optional secrets):

```bash
# Local operator setup: put read:packages token in repo root .env as GHCR_TOKEN or GITHUB_PAT_TOKEN
bash ops/deploy/bootstrap-argocd-cd.sh
bash ops/deploy/verify-argocd-cd.sh
```

Both namespaces must be able to pull from GHCR.

Create the pull secret in each namespace:

```bash
GHCR_USER="ruby0322"
GHCR_TOKEN="<github-token-with-read:packages>"

kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username="${GHCR_USER}" \
  --docker-password="${GHCR_TOKEN}" \
  -n pd-care-dev

kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username="${GHCR_USER}" \
  --docker-password="${GHCR_TOKEN}" \
  -n pd-care-prod
```

Workloads reference this secret via `imagePullSecrets` in:

- `k8s/base/frontend-deployment.yaml`
- `k8s/base/backend-deployment.yaml`
- `k8s/overlays/prod/migrate-job.yaml`

## 3) Required GitHub settings

Repository variables for frontend build-time LIFF values:

- `PDCARE_DEV_LIFF_ID`
- `PDCARE_PROD_LIFF_ID`

The CD workflows use GHCR image paths:

- `ghcr.io/ruby0322/pd-care-frontend`
- `ghcr.io/ruby0322/pd-care-backend`

Repository secret (optional but recommended for backend model bake reliability):

- `HF_TOKEN`

Repository policy prerequisite:

- Ensure `main` branch rules allow automation commits from GitHub Actions, or configure an alternative write credential.

Operator-owned secrets (not stored in git):

| Item | Purpose | Required when |
| --- | --- | --- |
| `GHCR_TOKEN` or `GITHUB_PAT_TOKEN` (in root `.env`) | Cluster `ghcr-pull-secret` | GHCR packages are private (typical default) |
| `GITHUB_PAT` | Argo CD private repo access | Only if `pd-care-monorepo` is made private |
| `PDCARE_DEV_LIFF_ID` / `PDCARE_PROD_LIFF_ID` | Frontend image build args | Every CD image build |
| `HF_TOKEN` | Backend model bake reliability | Optional; recommended |

## 4) Dev delivery flow (auto, gated by CI success)

Workflow: `.github/workflows/cd-build-dev.yml`

After a successful `CI` workflow on `main` push, the workflow:

1. Builds and pushes backend image tag `sha-<12-char-commit>`.
2. Builds and pushes frontend dev image tag `dev-sha-<12-char-commit>`.
3. Builds and pushes frontend prod image tag `prod-sha-<12-char-commit>`.
4. Updates `k8s/overlays/dev/kustomization.yaml` image tags in Git.
5. Pushes that commit to `main`.
6. Argo CD auto-syncs `pd-care-dev`.

The workflow skips image rebuilds when the source commit does not touch `apps/frontend/**` or `apps/backend/**`.

## 5) Prod promotion flow (git-driven)

Workflow: `.github/workflows/cd-promote-prod.yml`

Trigger manually with:

- `backend_tag` (for `pd-care-backend`)
- `frontend_tag` (for `pd-care-frontend`, use `prod-sha-...`)

The workflow validates:

- input tag format (`sha-...`, `prod-sha-...`)
- image tag existence in GHCR

Then it updates only `k8s/overlays/prod/kustomization.yaml`, commits to `main`, and Argo CD syncs prod from Git state.

## 6) Migration and rollout ordering

Prod migration sequencing is encoded in manifests:

- `k8s/overlays/prod/migrate-job.yaml`:
  - `argocd.argoproj.io/hook: PreSync`
  - `argocd.argoproj.io/hook-delete-policy: BeforeHookCreation,HookSucceeded,HookFailed`
  - `argocd.argoproj.io/sync-wave: "0"`
  - `activeDeadlineSeconds: 7200` so `ImagePullBackOff` cannot leave the hook Running forever
- `k8s/overlays/prod/patch-backend.yaml`:
  - `argocd.argoproj.io/sync-wave: "1"`

This ensures schema migration runs before backend deployment updates.

**Do not** apply the Job manifest alone:

```bash
# Wrong: image stays pd-care-backend:latest → ImagePullBackOff; skips kustomize tag rewrite
kubectl apply -f k8s/overlays/prod/migrate-job.yaml -n pd-care-prod

# Prefer Argo CD sync of pd-care-prod. Manual fallback uses kustomize:
kubectl apply -k k8s/overlays/prod
```

`kubectl apply -k` is intentional for image-tag rewrite but applies the **entire** prod
overlay (deployments, ingress, Job), not a Job-only patch — prefer Argo CD when possible.

Alembic honors `DATABASE_URL` from the Job secret (Postgres). Job `Complete` alone is not
enough if an older image still preferred `alembic.ini` SQLite — after sync, confirm prod
Postgres head (see §8).

### Stuck `backend-migrate` hook

If a prod sync used a nonexistent GHCR tag (for example `ghcr.io/.../backend:latest`), the
PreSync Job can sit in `ImagePullBackOff` indefinitely. Argo CD then keeps the sync
operation in `Running` with `waiting for completion of hook batch/Job/backend-migrate`,
blocking later promotions.

Recovery:

```bash
# 1) Clear the stuck Argo operation (safe; does not delete app workloads)
kubectl -n argocd patch application pd-care-prod --type json \
  -p='[{"op": "remove", "path": "/operation"}]' 2>/dev/null || true
kubectl -n argocd patch application pd-care-prod --type json \
  -p='[{"op": "remove", "path": "/status/operationState"}]'

# 2) Delete the failed hook Job (BeforeHookCreation recreates it on next sync)
kubectl delete job backend-migrate -n pd-care-prod --ignore-not-found

# 3) Refresh and watch
kubectl -n argocd annotate application pd-care-prod argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd get application pd-care-prod -w
```

After the overlay fix and hook policy update land on `main`, failed hooks are deleted
automatically (`HookFailed`) or time out (`activeDeadlineSeconds`).

## 7) End-to-end dry run checklist

1. Merge an app change to `main`.
2. Confirm `CI` finishes successfully.
3. Confirm `CD Build Dev` runs and pushes:
   - backend: `sha-<12>`
   - frontend: `dev-sha-<12>`, `prod-sha-<12>`
4. Confirm `k8s/overlays/dev/kustomization.yaml` is auto-committed with new tags.
5. Confirm Argo CD syncs `pd-care-dev` healthy.
6. Trigger `CD Promote Prod` with matching tags.
7. Confirm `k8s/overlays/prod/kustomization.yaml` receives promotion commit.
8. Confirm Argo CD syncs `pd-care-prod`, `backend-migrate` PreSync hook completes (logs show `PostgresqlImpl`), pods become healthy, and prod `alembic_version` matches the promoted image head.

If bootstrap skipped `GHCR_TOKEN`, create `ghcr-pull-secret` first (§2), then re-run:

```bash
bash ops/deploy/verify-argocd-cd.sh
```

## 8) Verification checklist

After each dev sync or prod promotion:

```bash
kubectl get pods -n pd-care-dev
kubectl get pods -n pd-care-prod
kubectl get job/backend-migrate -n pd-care-prod
kubectl logs job/backend-migrate -n pd-care-prod | grep -E 'PostgresqlImpl|SQLiteImpl|Running upgrade'
kubectl exec -n pd-care-prod postgres-0 -- psql -U postgres -d pd_care -c "SELECT version_num FROM alembic_version;"
kubectl get deploy backend frontend -n pd-care-prod
curl -fsS https://pd.lu.im.ntu.edu.tw/api/readyz
curl -fsS https://pd.lu.im.ntu.edu.tw/
```

`/readyz` only checks model load — also verify Postgres `alembic_version` (and that migrate
logs used `PostgresqlImpl`, not `SQLiteImpl`).

## 9) Rollback

Rollback is Git-first:

1. Revert the promotion commit that changed `k8s/overlays/prod/kustomization.yaml`.
2. Push revert to `main`.
3. Argo CD reconciles back to the prior image tags.

Do not delete PVCs or restart Postgres/SeaweedFS for frontend-only/backend-only rollbacks.

## 10) ConfigMap and Secret changes (auto-restart via Reloader)

### What changed

Env vars sourced from a ConfigMap or Secret are injected **once, when the pod
starts**. They do not hot-reload.

- **Before:** editing `pd-care-config` (for example `THRESHOLD`) and merging it
  made Argo CD sync the ConfigMap and report `Synced / Healthy` — while every
  running pod kept the old value. The change only took effect after a manual
  `kubectl rollout restart deploy/backend -n pd-care-prod` (and `deploy/frontend`).
  Forgetting that step was silent: nothing in Argo CD looked wrong.
- **Now:** [Stakater Reloader](https://github.com/stakater/Reloader) runs in each
  app namespace and performs the rolling restart itself. **No manual
  `rollout restart` is needed for config or secret changes.**

### How it is wired

| Piece | Where |
| --- | --- |
| Controller Deployment (pinned `ghcr.io/stakater/reloader:v1.4.23`) | [`k8s/base/reloader-deployment.yaml`](../../k8s/base/reloader-deployment.yaml) |
| `Role` + `RoleBinding` + `ServiceAccount` | [`k8s/base/reloader-rbac.yaml`](../../k8s/base/reloader-rbac.yaml), [`k8s/base/reloader-serviceaccount.yaml`](../../k8s/base/reloader-serviceaccount.yaml) |
| Opt-in annotation `reloader.stakater.com/auto: "true"` | [`k8s/base/backend-deployment.yaml`](../../k8s/base/backend-deployment.yaml), [`k8s/base/frontend-deployment.yaml`](../../k8s/base/frontend-deployment.yaml) |
| Argo CD `ignoreDifferences` | [`k8s/argocd/dev-application.yaml`](../../k8s/argocd/dev-application.yaml), [`k8s/argocd/prod-application.yaml`](../../k8s/argocd/prod-application.yaml) |

Reloader is part of `k8s/base`, so both Argo Applications already own and
reconcile it — no extra Application, no bootstrap step, and nothing to add to
`k8s/argocd/project.yaml`. The overlay `namespace:` field places one instance in
`pd-care-dev` and one in `pd-care-prod`.

**Opt-in, not cluster-wide.** Reloader only restarts workloads that carry
`reloader.stakater.com/auto: "true"`; today that is `backend` and `frontend`, the
two Deployments that consume `pd-care-config` via `envFrom`. `postgres` is not
annotated on purpose (its only secret key is `initdb`-time, so a restart would
drop connections and change nothing), and `--ignored-workload-types=jobs,cronjobs`
guarantees the `backend-migrate` PreSync hook is never re-run by Reloader.

### Scoping and RBAC

Each instance is pinned to its own namespace by setting `KUBERNETES_NAMESPACE`
from `metadata.namespace` (leaving it unset is what makes upstream Reloader watch
the whole cluster). Consequently its permissions are a **namespaced `Role`, never
a `ClusterRole`** — it has no cluster-wide read or write access at all, and the
dev instance cannot see or touch `pd-care-prod`.

| API group | Resources | Verbs | Why |
| --- | --- | --- | --- |
| `""` | `configmaps`, `secrets` | `get`, `list`, `watch` | Detect content changes and hash them |
| `apps` | `deployments`, `daemonsets`, `statefulsets` | `get`, `list`, `update`, `patch` | Patch the pod template of annotated workloads |
| `batch` | `jobs`, `cronjobs` | `get`, `list` | Reloader lists them on every change event, then skips them |
| `""` | `events` | `create`, `patch` | Reload shows up in `kubectl describe deploy/backend` |

Narrower than the upstream Helm chart in three places:

- no `configmaps: create/update` — upstream needs it only to publish Reloader's
  own meta-info ConfigMap. We leave `RELOADER_NAMESPACE` unset, so it skips that
  write (one log warning at startup) and cannot write any ConfigMap.
- no `batch/jobs: create/delete` — Reloader cannot delete or recreate a Job, so
  it cannot touch `backend-migrate` even by accident.
- no `extensions/deployments` — that API group was removed in Kubernetes 1.16.

Reloader does need `get/list/watch` on **all** Secrets in its namespace,
including `pd-care-secrets` and `ghcr-pull-secret`. That is inherent to hashing
secret content; it is read-only and namespace-local.

### Argo CD `selfHeal` interaction

Reloader's default `env-vars` strategy injects a `STAKATER_*_CONFIGMAP` container
env var. With `selfHeal: true` Argo CD would revert that immediately and the two
controllers would fight, restarting pods in a loop. Two settings prevent that:

- `--reload-strategy=annotations` — Reloader writes the pod-template annotation
  `reloader.stakater.com/last-reloaded-from` instead of mutating the container.
- `spec.ignoreDifferences` on `apps/Deployment` for
  `/spec/template/metadata/annotations/reloader.stakater.com~1last-reloaded-from`,
  plus `RespectIgnoreDifferences=true` in `syncOptions` so an unrelated sync does
  not strip the annotation (which would itself bounce the pods).

The Argo CD Applications are bootstrap-applied, not synced by an Application, so
re-apply them after this change lands:

```bash
kubectl apply -f k8s/argocd/dev-application.yaml
kubectl apply -f k8s/argocd/prod-application.yaml
```

### Verify

```bash
kubectl -n pd-care-prod get deploy reloader
kubectl -n pd-care-prod logs deploy/reloader | head -20   # expect scoped-namespace startup lines

# After a pd-care-config change syncs:
kubectl -n pd-care-prod rollout status deploy/backend --timeout=600s
kubectl -n pd-care-prod get deploy backend \
  -o jsonpath='{.spec.template.metadata.annotations.reloader\.stakater\.com/last-reloaded-from}{"\n"}'
kubectl -n pd-care-prod exec deploy/backend -- printenv THRESHOLD
```

If Reloader is down, the old manual path still works as a fallback:
`kubectl rollout restart deploy/backend -n pd-care-prod`.

### Upgrading Reloader

The image tag is pinned in `k8s/base/reloader-deployment.yaml` and must never be
`latest` — Argo CD auto-sync would otherwise push an unreviewed controller
straight into prod. Bump the tag in a PR, confirm `pd-care-dev` stays healthy and
a dev ConfigMap edit still restarts `backend`, then promote.
