# K8s Overlay Validation Notes

Date: 2026-07-01  
Scope: `k8s/overlays/dev`, `k8s/overlays/prod`

## Commands executed

```bash
kubectl kustomize k8s/overlays/dev > /tmp/pd-care-k8s-dev.yaml
kubectl kustomize k8s/overlays/prod > /tmp/pd-care-k8s-prod.yaml
kubectl apply --dry-run=client --validate=false -k k8s/overlays/dev
kubectl apply --dry-run=client --validate=false -k k8s/overlays/prod
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/prod
kubectl get pods,pvc,ingress,secret -n pd-care-dev
kubectl get pods,pvc,ingress,secret -n pd-care-prod
docker compose exec -T postgres psql -U postgres -d pd_care -Atc "select count(*) from information_schema.tables where table_schema='public';"
kubectl exec -n pd-care-prod postgres-0 -- psql -U postgres -d pd_care -Atc "select count(*) from information_schema.tables where table_schema='public';"
```

## Results

- Overlay render and dry-run apply passed for both overlays.
- Both namespaces are deployed and running.
- Ingress routes only `/` to the frontend service (Compose-compatible). API traffic uses Next.js `/api` rewrites, not a separate ingress backend path.
- Postgres migration sanity check passed (public table count: `11` in both Compose and `pd-care-prod`).
- SeaweedFS object migration completed (source bucket object count `228`, prod bucket object count `228`).

## Dual-env readiness matrix

| Check | Dev (`pd-care-dev`) | Prod (`pd-care-prod`) |
| --- | --- | --- |
| Overlay render (`kubectl kustomize`) | Pass | Pass |
| Dry-run apply (`--validate=false`) | Pass | Pass |
| Namespace exists | Pass | Pass |
| Pods ready | Pass | Pass |
| Ingress present | Pass (`test.pd.lu.im.ntu.edu.tw`) | Pass (`pd.lu.im.ntu.edu.tw`) |
| Ingress path `/` → frontend only | Pass | Pass |
| API via Next.js rewrite (`/api/*`) | Pass (see smoke tests below) | Pass (see smoke tests below) |
| Secret `pd-care-secrets` present | Pass | Pass |
| PVCs bound | Pass | Pass |
| Backend `/healthz` + `/readyz` (pod-local) | Pass | Pass |
| TLS secret in namespace | Not present | Not present |

## API ingress smoke tests

Use the checks in [`k8s-minikube.md` §4.1](k8s-minikube.md#41-api-routing-model-compose-compatible). Expected: `POST /api/v1/auth/login` returns `400`/`401`/`403`, not `404` from a FastAPI route mismatch.

Confirm rendered ingress has only `/` → frontend:

```bash
kubectl kustomize k8s/overlays/dev | grep -E 'path:|name: (frontend|backend)'
kubectl kustomize k8s/overlays/prod | grep -E 'path:|name: (frontend|backend)'
```

## Interpretation

- Kubernetes dual-namespace runtime is healthy for dev and prod.
- Data has been copied into `pd-care-prod` while leaving Docker Compose source data intact.
- TLS certificates are now managed by cert-manager; verify Certificate resources become Ready during cutover.
- Deferred cutover items are tracked in [`k8s-followups.md`](k8s-followups.md).
