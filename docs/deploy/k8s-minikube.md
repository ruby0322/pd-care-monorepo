# PD Care K8s (Minikube) Runbook

This runbook provides a minimal, maintainable Kubernetes workflow for two namespaces:

- `pd-care-dev`
- `pd-care-prod` (prod-like, still inside Minikube)

## 1) Prerequisites

- Minikube installed and running
- `kubectl` installed
- `docker` installed

Start Minikube and enable ingress:

```bash
minikube start
minikube addons enable ingress
```

Use Minikube's Docker daemon so local images are available to pods:

```bash
eval "$(minikube docker-env)"
```

Build images used by manifests:

```bash
docker build -t pd-care-frontend:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-uzPg8SgK \
  ./apps/frontend
docker build -t pd-care-backend:latest ./apps/backend
```

## 2) Domain and DNS prerequisites

Target domains:

- prod-like namespace (`pd-care-prod`): `https://pd.lu.im.ntu.edu.tw`
- test namespace (`pd-care-dev`): `https://test.pd.lu.im.ntu.edu.tw`

Ingress hosts are already set in overlays:

- [`k8s/overlays/prod/patch-ingress.yaml`](../../k8s/overlays/prod/patch-ingress.yaml)
- [`k8s/overlays/dev/patch-ingress.yaml`](../../k8s/overlays/dev/patch-ingress.yaml)

What the administrator must do (no sudo needed from your side):

1. Point DNS records to the operator host public IP (same host that runs minikube).
   - `pd.lu.im.ntu.edu.tw` — required for production
   - `test.pd.lu.im.ntu.edu.tw` — required for dev; site returns 200 via ingress when resolved to the host IP
2. Issue Let's Encrypt certificates with certbot for both domains.
3. Create the TLS secrets in each namespace (next section).
4. Start the HTTPS ingress bridge only (minikube docker driver does not bind :443 on the public NIC; leave :80 free for certbot):

```bash
docker compose -f docker-compose.ingress-bridge.yml up -d
```

See [`docker-compose.ingress-bridge.yml`](../../docker-compose.ingress-bridge.yml).

## 3) TLS secrets for ingress (certbot only)

Issue/renew certs on the operator host with certbot, then sync into namespace TLS secrets.

Example issue commands:

```bash
sudo certbot certonly --standalone -d test.pd.lu.im.ntu.edu.tw
sudo certbot certonly --standalone -d pd.lu.im.ntu.edu.tw
```

Create Kubernetes TLS secrets from certbot outputs:

```bash
kubectl create secret tls test-pd-lu-im-ntu-edu-tw-tls \
  --cert=/etc/letsencrypt/live/test.pd.lu.im.ntu.edu.tw/fullchain.pem \
  --key=/etc/letsencrypt/live/test.pd.lu.im.ntu.edu.tw/privkey.pem \
  -n pd-care-dev

kubectl create secret tls pd-lu-im-ntu-edu-tw-tls \
  --cert=/etc/letsencrypt/live/pd.lu.im.ntu.edu.tw/fullchain.pem \
  --key=/etc/letsencrypt/live/pd.lu.im.ntu.edu.tw/privkey.pem \
  -n pd-care-prod
```

If namespaces do not exist yet, apply overlays first, then create the TLS secrets.

After certbot renewal, refresh both TLS secrets:

```bash
kubectl -n pd-care-dev delete secret test-pd-lu-im-ntu-edu-tw-tls --ignore-not-found
kubectl create secret tls test-pd-lu-im-ntu-edu-tw-tls \
  --cert=/etc/letsencrypt/live/test.pd.lu.im.ntu.edu.tw/fullchain.pem \
  --key=/etc/letsencrypt/live/test.pd.lu.im.ntu.edu.tw/privkey.pem \
  -n pd-care-dev

kubectl -n pd-care-prod delete secret pd-lu-im-ntu-edu-tw-tls --ignore-not-found
kubectl create secret tls pd-lu-im-ntu-edu-tw-tls \
  --cert=/etc/letsencrypt/live/pd.lu.im.ntu.edu.tw/fullchain.pem \
  --key=/etc/letsencrypt/live/pd.lu.im.ntu.edu.tw/privkey.pem \
  -n pd-care-prod
```

## 4) Deploy

Create application secrets in each namespace before applying overlays (secrets are not committed to git):

```bash
# Dev
cp k8s/overlays/dev/secret.yaml.example k8s/overlays/dev/secret.yaml
# Edit k8s/overlays/dev/secret.yaml with real values (file is gitignored)
kubectl apply -f k8s/overlays/dev/secret.yaml -n pd-care-dev

# Prod
cp k8s/overlays/prod/secret.yaml.example k8s/overlays/prod/secret.yaml
# Edit k8s/overlays/prod/secret.yaml with real values (file is gitignored)
kubectl apply -f k8s/overlays/prod/secret.yaml -n pd-care-prod
```

Apply each overlay independently:

```bash
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/prod
```

## 4.1) API routing model (Compose-compatible)

Ingress routes all public traffic (`/`) to the frontend service. API calls use the same path model as Docker Compose:

- Browser/client calls `/api/v1/...`
- Next.js rewrites `/api/:path*` to `BACKEND_INTERNAL_URL/:path*` (see [`apps/frontend/next.config.mjs`](../../apps/frontend/next.config.mjs))
- Backend receives `/v1/...` (no `/api` prefix)

`BACKEND_INTERNAL_URL` is set in [`k8s/base/configmap.yaml`](../../k8s/base/configmap.yaml) (`http://backend:8000`). Do not add a separate ingress `/api` rule; that bypasses the rewrite and causes route-level 404s such as `POST /api/v1/auth/login`.

Verify API path translation after deploy:

```bash
# Should NOT return {"detail":"Not Found"} from FastAPI route mismatch
curl -sS -o /dev/null -w 'prod_login=%{http_code}\n' \
  -X POST https://pd.lu.im.ntu.edu.tw/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"line_id_token":"invalid"}'

curl -sS -o /dev/null -w 'dev_login=%{http_code}\n' \
  -X POST https://test.pd.lu.im.ntu.edu.tw/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"line_id_token":"invalid"}'
```

Expected: HTTP `400` or `401`/`403` (auth validation), not `404`.

Confirm rendered ingress has only `/` -> frontend:

```bash
kubectl kustomize k8s/overlays/dev | grep -E 'path:|name: (frontend|backend)'
kubectl kustomize k8s/overlays/prod | grep -E 'path:|name: (frontend|backend)'
```

## 4.2) Observability / Grafana (deferred)

Grafana is **not** part of the K8s manifests. It still lives in [`docker-compose.observability.yml`](../../docker-compose.observability.yml) (see [`docs/observability.md`](../observability.md)).

On K8s-hosted domains, `/grafana` and `/admin/monitoring` will fail until observability is migrated or `GRAFANA_INTERNAL_URL` is set to a reachable host-side endpoint. This is intentionally deferred; do not block app cutover on it.

## 5) Verify

Check workload readiness:

```bash
kubectl get pods -n pd-care-dev
kubectl get pods -n pd-care-prod
```

Check ingress and DNS target:

```bash
kubectl get ingress -n pd-care-dev
kubectl get ingress -n pd-care-prod
kubectl get ingress -A -o wide
```

Expected hosts:

- `test.pd.lu.im.ntu.edu.tw` -> dev ingress
- `pd.lu.im.ntu.edu.tw` -> prod ingress

If DNS is not ready yet, you can still verify routing without sudo by forcing Host header:

```bash
INGRESS_IP="<ingress-ip>"
curl -kI --resolve test.pd.lu.im.ntu.edu.tw:443:${INGRESS_IP} https://test.pd.lu.im.ntu.edu.tw/
curl -kI --resolve pd.lu.im.ntu.edu.tw:443:${INGRESS_IP} https://pd.lu.im.ntu.edu.tw/
```

Check backend probes:

```bash
kubectl get pods -n pd-care-dev -l app=backend
kubectl logs -n pd-care-dev deploy/backend
kubectl get pods -n pd-care-prod -l app=backend
kubectl logs -n pd-care-prod deploy/backend
```

## 6) Production cutover and rollback

Cutover sequence:

1. Verify `pd-care-dev` and `pd-care-prod` pods are healthy.
2. Complete data migration for `pd-care-prod` (see [`k8s-migration.md`](k8s-migration.md)).
3. Verify production namespace ingress/TLS and smoke tests before DNS switch.
4. Point `pd.lu.im.ntu.edu.tw` DNS/LB to K8s ingress.
5. Re-run smoke tests on production domain.
6. Stop Docker Compose production routing only after successful K8s validation.

Rollback sequence:

1. Revert `pd.lu.im.ntu.edu.tw` DNS/LB back to Docker Compose endpoint.
2. Keep K8s namespaces running for diagnostics.
3. Do not delete PVCs during rollback.

## 7) Scoped updates (default)

Only restart affected workloads.

Frontend-only change:

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-uzPg8SgK \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-dev
```

Dev namespace uses a separate image tag and LIFF ID:

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:dev \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-B0JCWwiu \
  ./apps/frontend
kubectl rollout restart deploy/frontend -n pd-care-dev
```

Backend-only change:

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-backend:latest ./apps/backend
kubectl rollout restart deploy/backend -n pd-care-dev
```

Promote to prod-like namespace only after dev verification:

```bash
kubectl rollout restart deploy/frontend -n pd-care-prod
# or
kubectl rollout restart deploy/backend -n pd-care-prod
```

## 8) Safety rules (production-data protection)

Never run these during routine updates:

- `kubectl delete pvc ...` in `pd-care-prod`
- `kubectl delete namespace pd-care-prod`
- Any command that removes stateful volumes as a side effect

Data-bearing PVCs:

- `postgres-data`
- `model-cache`
- `seaweed-master-data`
- `seaweed-volume-data`
- `seaweed-filer-data`

Treat `pd-care-prod` as production-like:

- no destructive cleanup commands
- no namespace-wide recycle for frontend-only/backend-only updates

## 9) Config and secret management

### Application secrets (not in git)

Overlay secrets are **not** committed. Use the examples as templates:

- Dev: [`k8s/overlays/dev/secret.yaml.example`](../../k8s/overlays/dev/secret.yaml.example)
- Prod: [`k8s/overlays/prod/secret.yaml.example`](../../k8s/overlays/prod/secret.yaml.example)
- Base reference: [`k8s/base/secret.template.yaml`](../../k8s/base/secret.template.yaml)

Workflow:

1. Copy `secret.yaml.example` to `secret.yaml` in the target overlay directory (`secret.yaml` is gitignored).
2. Replace all placeholder values. Ensure dev/prod values are distinct (`DATABASE_URL`, token secrets, S3 credentials).
3. Apply the secret before the overlay:

```bash
kubectl apply -f k8s/overlays/dev/secret.yaml -n pd-care-dev
kubectl apply -f k8s/overlays/prod/secret.yaml -n pd-care-prod
```

4. Apply overlays:

```bash
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/prod
```

**Credential rotation:** If secrets were ever committed to git, rotate all affected credentials before cutover:

```bash
./ops/security/rotate_k8s_secrets.sh          # generate new secret.yaml + apply when cluster is up
./ops/security/rotate_k8s_secrets.sh --apply-only   # apply existing gitignored secret.yaml files
```

The script updates `pd-care-secrets`, runs `ALTER USER` on Postgres, and restarts backend (invalidates auth/image tokens). Old values remain in git history until history rewrite — treat leaked commits as compromised even after rotation.

Alternative: `kubectl create secret generic pd-care-secrets --from-literal=... -n <namespace>` with the same key names expected by deployments.

### Frontend build args (`NEXT_PUBLIC_*`)

`NEXT_PUBLIC_LIFF_ID` and `NEXT_PUBLIC_API_BASE_URL` are **build-time** values. Next.js inlines them during `docker build` (see [`apps/frontend/Dockerfile`](../../apps/frontend/Dockerfile)); runtime ConfigMap env vars do not change client bundles.

Build a separate image per environment:

| Namespace | Image tag | `NEXT_PUBLIC_LIFF_ID` |
| --- | --- | --- |
| `pd-care-prod` | `pd-care-frontend:latest` | prod LIFF ID |
| `pd-care-dev` | `pd-care-frontend:dev` | dev LIFF ID |

Both use `NEXT_PUBLIC_API_BASE_URL=/api`. See §1 and §7 for build commands.

Deferred cutover items (Compose env parity, registry/GPU): [`k8s-followups.md`](k8s-followups.md).

## 10) Troubleshooting

### API returns 404 `{"detail":"Not Found"}`

Usually means ingress is forwarding `/api/*` directly to backend without stripping `/api`. Keep ingress frontend-only and let Next.js rewrite `/api/:path*` to backend `/:path*`. `POST /api/v1/auth/login` should reach backend as `/v1/auth/login`.

Render manifests to inspect final output:

```bash
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/prod
```

If pods fail because images are missing, rebuild inside Minikube docker:

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:latest \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_PUBLIC_LIFF_ID=1657724367-uzPg8SgK \
  ./apps/frontend
docker build -t pd-care-backend:latest ./apps/backend
```
