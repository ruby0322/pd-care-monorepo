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
- Ingress host patches now include backend/frontend path routing (`/api` and `/`).
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
| Ingress backend paths (`/api`, `/`) | Pass | Pass |
| Secret `pd-care-secrets` present | Pass | Pass |
| PVCs bound | Pass | Pass |
| Backend `/healthz` + `/readyz` (pod-local) | Pass | Pass |
| TLS secret in namespace | Not present | Not present |

## Interpretation

- Kubernetes dual-namespace runtime is healthy for dev and prod.
- Data has been copied into `pd-care-prod` while leaving Docker Compose source data intact.
- TLS secrets are still pending certbot sync; this is expected to be completed in the later cutover step.
