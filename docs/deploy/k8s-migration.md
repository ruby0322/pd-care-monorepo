# Compose to K8s Migration Runbook

Migrate production data from Docker Compose services into Kubernetes `pd-care-prod`.

## Scope

- Postgres metadata DB (`pd_care`)
- SeaweedFS object storage bucket content
- Optional: model cache warm-up

## Preconditions

1. `pd-care-prod` namespace is deployed.
2. All required PVCs in `pd-care-prod` are `Bound`.
3. Destination secrets/config in `pd-care-prod` are finalized (see [`k8s-minikube.md` §9](k8s-minikube.md#9-config-and-secret-management)).
4. Migration window approved (write traffic freeze or maintenance mode recommended).

## 1) Export Postgres from Docker Compose

On the current Docker host:

```bash
docker compose exec -T postgres pg_dump -U postgres -d pd_care -Fc > /tmp/pd_care.dump
```

Validate dump file exists:

```bash
ls -lh /tmp/pd_care.dump
```

## 2) Import Postgres into Kubernetes

Find postgres pod in `pd-care-prod`:

```bash
POSTGRES_POD="$(kubectl get pod -n pd-care-prod -l app=postgres -o jsonpath='{.items[0].metadata.name}')"
echo "$POSTGRES_POD"
```

Copy and restore:

```bash
kubectl cp /tmp/pd_care.dump "pd-care-prod/${POSTGRES_POD}:/tmp/pd_care.dump"
kubectl exec -n pd-care-prod "$POSTGRES_POD" -- \
  pg_restore -U postgres -d pd_care --clean --if-exists /tmp/pd_care.dump
```

Quick row-count sanity check:

```bash
kubectl exec -n pd-care-prod "$POSTGRES_POD" -- \
  psql -U postgres -d pd_care -c "\dt"
```

## 3) Migrate SeaweedFS bucket objects

**Recommended:** Option B (`mc mirror`) with **separate** Compose and K8s endpoints. Do not use a single `aws s3 sync` against one endpoint to copy from Compose to K8s — both buckets must be reachable on different hosts/ports.

### Option A: aws cli (same endpoint only — not Compose → K8s)

Use only when source and destination buckets live on the **same** Seaweed S3 endpoint (for example, renaming buckets within one cluster). For Compose → K8s migration, use Option B.

```bash
aws --endpoint-url http://<single-seaweed-endpoint>:8333 \
  s3 sync s3://<source-bucket> s3://<dest-bucket>
```

### Option B: mc (MinIO client) — recommended for Compose → K8s

```bash
mc alias set compose http://<compose-seaweed-endpoint>:8333 <access_key> <secret_key>
mc alias set k8s http://<k8s-seaweed-endpoint>:8333 <access_key> <secret_key>
mc mirror --overwrite compose/pd-care-private k8s/pd-care-prod-private
```

Verify object count/sample keys:

```bash
aws --endpoint-url http://<k8s-seaweed-endpoint>:8333 s3 ls s3://pd-care-prod-private --recursive | head
```

## 4) Model artifacts handling

Backend model artifacts are baked into the backend image at build time (checkpoint, prescreen bundle, and CLIP cache).

- No `model-cache` PVC migration is required for K8s.
- Ensure the backend image is rebuilt before rollout when model artifacts change.

## 5) Cutover verification in `pd-care-prod`

1. Backend readiness (via ingress, with bridge running):
   - `curl -fsS https://pd.lu.im.ntu.edu.tw/api/healthz` returns 200
   - `curl -fsS https://pd.lu.im.ntu.edu.tw/api/readyz` returns 200
   - Or pod-local: `kubectl exec -n pd-care-prod deploy/backend -- curl -fsS http://localhost:8000/healthz`
2. Representative patient history endpoint works.
3. Image access URLs resolve objects from the migrated bucket.
4. Logs show no repeated storage/database initialization errors.

## 6) Rollback note

If verification fails after DNS switch:

1. Revert DNS/LB to Docker Compose endpoint.
2. Keep migrated K8s data for debugging (do not delete PVCs).
3. Document divergence window before re-attempting migration/cutover.
