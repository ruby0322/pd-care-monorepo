# K8s Prod Zero-Downtime Rollout

This runbook verifies rolling upgrades for `pd-care-prod` frontend/backend without user-visible downtime.

## Preconditions

- `k8s/overlays/prod` includes:
  - frontend and backend `replicas: 2`
  - `RollingUpdate` with `maxUnavailable: 0`, `maxSurge: 1`
  - backend `RUN_DB_MIGRATIONS=false`
  - `backend-migrate` Job manifest
- Minikube resources can briefly handle 3 backend pods during surge.

## Backend deploy sequence (prod)

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-backend:latest ./apps/backend
# Prefer Argo CD sync for prod. Manual migrate must use kustomize so the image tag is rewritten
# (raw `kubectl apply -f .../migrate-job.yaml` leaves pd-care-backend:latest → ImagePullBackOff).
# Note: apply -k updates the entire prod overlay (deployments/ingress/Job), not Job-only.
kubectl delete job backend-migrate -n pd-care-prod --ignore-not-found
kubectl apply -k k8s/overlays/prod
kubectl wait --for=condition=complete job/backend-migrate -n pd-care-prod --timeout=300s
# Confirm migrate hit Postgres (not container SQLite):
kubectl logs job/backend-migrate -n pd-care-prod | grep PostgresqlImpl
kubectl exec -n pd-care-prod postgres-0 -- psql -U postgres -d pd_care -c "SELECT version_num FROM alembic_version;"
kubectl rollout restart deploy/backend -n pd-care-prod
kubectl rollout status deploy/backend -n pd-care-prod --timeout=600s
```

## Frontend deploy sequence (prod)

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-uzPg8SgK \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-prod
kubectl rollout status deploy/frontend -n pd-care-prod --timeout=300s
```

## Continuous availability check

Run this in a separate terminal while rollout is in progress:

```bash
while true; do
  date -Is
  curl -fsS -o /dev/null -w 'readyz=%{http_code} time=%{time_total}\n' \
    https://pd.lu.im.ntu.edu.tw/api/readyz || echo FAIL
  curl -fsS -o /dev/null -w 'frontend=%{http_code}\n' \
    https://pd.lu.im.ntu.edu.tw/ || echo FAIL
  sleep 1
done
```

## Acceptance criteria

- `readyz` has no sustained failures during rollout.
- Backend endpoint set never drops to zero:

```bash
kubectl get endpoints backend -n pd-care-prod -w
```

- New backend pods do not log runtime model checkpoint download.
- Post rollout:

```bash
kubectl get deploy backend frontend -n pd-care-prod
```

Expected: `backend 2/2` and `frontend 2/2`.
