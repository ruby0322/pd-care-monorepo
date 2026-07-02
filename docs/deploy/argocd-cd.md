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

Apply Argo CD resources:

```bash
kubectl apply -f k8s/argocd/project.yaml
kubectl apply -f k8s/argocd/dev-application.yaml
kubectl apply -f k8s/argocd/prod-application.yaml
```

## 2) Required GitHub settings

Repository variables for frontend build-time LIFF values:

- `PDCARE_DEV_LIFF_ID`
- `PDCARE_PROD_LIFF_ID`

The CD workflows use GHCR image paths:

- `ghcr.io/ruby0322/pd-care-frontend`
- `ghcr.io/ruby0322/pd-care-backend`

## 3) Dev delivery flow (auto)

Workflow: `.github/workflows/cd-build-dev.yml`

On merge to `main`, the workflow:

1. Builds and pushes backend image tag `sha-<12-char-commit>`.
2. Builds and pushes frontend dev image tag `dev-sha-<12-char-commit>`.
3. Builds and pushes frontend prod image tag `prod-sha-<12-char-commit>`.
4. Updates `k8s/overlays/dev/kustomization.yaml` image tags in Git.
5. Pushes that commit to `main`.
6. Argo CD auto-syncs `pd-care-dev`.

## 4) Prod promotion flow (git-driven)

Workflow: `.github/workflows/cd-promote-prod.yml`

Trigger manually with:

- `backend_tag` (for `pd-care-backend`)
- `frontend_tag` (for `pd-care-frontend`, use `prod-sha-...`)

The workflow updates only `k8s/overlays/prod/kustomization.yaml`, commits to `main`, and Argo CD syncs prod from Git state.

## 5) Migration and rollout ordering

Prod migration sequencing is encoded in manifests:

- `k8s/overlays/prod/migrate-job.yaml`:
  - `argocd.argoproj.io/hook: PreSync`
  - `argocd.argoproj.io/sync-wave: "0"`
- `k8s/overlays/prod/patch-backend.yaml`:
  - `argocd.argoproj.io/sync-wave: "1"`

This ensures schema migration runs before backend deployment updates.

## 6) Verification checklist

After each dev sync or prod promotion:

```bash
kubectl get pods -n pd-care-dev
kubectl get pods -n pd-care-prod
kubectl get job/backend-migrate -n pd-care-prod
kubectl get deploy backend frontend -n pd-care-prod
curl -fsS https://pd.lu.im.ntu.edu.tw/api/readyz
curl -fsS https://pd.lu.im.ntu.edu.tw/
```

## 7) Rollback

Rollback is Git-first:

1. Revert the promotion commit that changed `k8s/overlays/prod/kustomization.yaml`.
2. Push revert to `main`.
3. Argo CD reconciles back to the prior image tags.

Do not delete PVCs or restart Postgres/SeaweedFS for frontend-only/backend-only rollbacks.
