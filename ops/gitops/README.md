# PD Care GitOps (Argo CD)

This directory contains the baseline GitOps setup for:

- `dev` -> SIT (`pd-care-sit`)
- `main` -> PROD (`pd-care-prod`)

## Repository Mapping

- Git repository: `https://github.com/ruby0322/pd-care-monorepo`
- Helm chart path: `charts/pd-care`
- Environment values:
  - `environments/sit/values.yaml`
  - `environments/prod/values.yaml`

## Argo CD Resources

- Projects:
  - `argocd/projects/sit-project.yaml`
  - `argocd/projects/prod-project.yaml`
- Applications:
  - `argocd/apps/sit-app.yaml`
  - `argocd/apps/prod-app.yaml`

## Apply Order

1. Apply AppProjects
2. Apply Applications

```bash
kubectl apply -n argocd -f ops/gitops/argocd/projects/sit-project.yaml
kubectl apply -n argocd -f ops/gitops/argocd/projects/prod-project.yaml
kubectl apply -n argocd -f ops/gitops/argocd/apps/sit-app.yaml
kubectl apply -n argocd -f ops/gitops/argocd/apps/prod-app.yaml
```

## Central Argo CD Notes

- SIT destination currently points to in-cluster API server (`https://kubernetes.default.svc`).
- PROD destination currently uses a placeholder (`https://prod-cluster.example.internal`).
- Update PROD destination server to the real registered cluster server before go-live.

## Promotion Flow

1. Push to `dev` branch.
2. `build-backend-image.yml` builds and pushes `ghcr.io/ruby0322/pd-care-backend:<dev_sha>`.
3. `update-sit-image-tag.yml` updates `environments/sit/values.yaml` to `<dev_sha>`.
4. Argo CD auto-sync deploys SIT.
5. Open PR from `dev` to `main`.
6. After merge to `main`, `promote-prod-image-tag.yml` copies SIT tag into `environments/prod/values.yaml`.
7. Argo CD auto-sync deploys PROD with the same image SHA.

## GitHub Workflows

- `.github/workflows/build-backend-image.yml`
- `.github/workflows/update-sit-image-tag.yml`
- `.github/workflows/promote-prod-image-tag.yml`
- `.github/workflows/gitops-validate.yml`

## GitHub Setup Prerequisites

See `ops/gitops/github-setup-required.md` for required repository settings, permissions, and secrets.
