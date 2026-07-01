# Compose to K8s Migration Runbook

Migrate production data from Docker Compose services into Kubernetes `pd-care-prod`.

## Scope

- Postgres metadata DB (`pd_care`)
- SeaweedFS object storage bucket content
- Optional: model cache warm-up

## Preconditions

1. `pd-care-prod` namespace is deployed.
2. All required PVCs in `pd-care-prod` are `Bound`.
3. Destination secrets/config in `pd-care-prod` are finalized.
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

Use one method only (`aws s3 sync` or `mc mirror`).

### Option A: aws cli

```bash
aws --endpoint-url http://<compose-seaweed-endpoint>:8333 \
  s3 sync s3://pd-care-private s3://pd-care-prod-private
```

### Option B: mc (MinIO client)

```bash
mc alias set compose http://<compose-seaweed-endpoint>:8333 <access_key> <secret_key>
mc alias set k8s http://<k8s-seaweed-endpoint>:8333 <access_key> <secret_key>
mc mirror --overwrite compose/pd-care-private k8s/pd-care-prod-private
```

Verify object count/sample keys:

```bash
aws --endpoint-url http://<k8s-seaweed-endpoint>:8333 s3 ls s3://pd-care-prod-private --recursive | head
```

## 4) Model cache handling

`model-cache` does not require strict data migration.

- If omitted, backend will re-download models from configured sources.
- If startup speed is critical, pre-seed model files into `/models` on the backend PVC/pod.

## 5) Cutover verification in `pd-care-prod`

1. Backend readiness:
   - `/healthz` returns 200
   - `/readyz` returns 200
2. Representative patient history endpoint works.
3. Image access URLs resolve objects from the migrated bucket.
4. Logs show no repeated storage/database initialization errors.

## 6) Rollback note

If verification fails after DNS switch:

1. Revert DNS/LB to Docker Compose endpoint.
2. Keep migrated K8s data for debugging (do not delete PVCs).
3. Document divergence window before re-attempting migration/cutover.
