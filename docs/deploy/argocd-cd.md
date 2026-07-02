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
- Baseline overlays omit GHCR `images:` entries and use local image names
  (`pd-care-frontend:latest`, `pd-care-backend:latest`) until CD writes
  `dev-sha-...` / `sha-...` or `prod-sha-...` tags. Infra-only merges therefore
  do not point Argo CD at nonexistent registry tags.
- Repository URL used by Argo CD:
  - `https://github.com/ruby0322/pd-care-monorepo.git` (**public** — no Git credential required for Argo CD sync)

Apply Argo CD resources:

```bash
kubectl apply -f k8s/argocd/project.yaml
kubectl apply -f k8s/argocd/dev-application.yaml
kubectl apply -f k8s/argocd/prod-application.yaml
```

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
  - `argocd.argoproj.io/sync-wave: "0"`
- `k8s/overlays/prod/patch-backend.yaml`:
  - `argocd.argoproj.io/sync-wave: "1"`

This ensures schema migration runs before backend deployment updates.

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
8. Confirm Argo CD syncs `pd-care-prod`, `backend-migrate` PreSync hook completes, and pods become healthy.

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
kubectl get deploy backend frontend -n pd-care-prod
curl -fsS https://pd.lu.im.ntu.edu.tw/api/readyz
curl -fsS https://pd.lu.im.ntu.edu.tw/
```

## 9) Rollback

Rollback is Git-first:

1. Revert the promotion commit that changed `k8s/overlays/prod/kustomization.yaml`.
2. Push revert to `main`.
3. Argo CD reconciles back to the prior image tags.

Do not delete PVCs or restart Postgres/SeaweedFS for frontend-only/backend-only rollbacks.
