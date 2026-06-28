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
docker build -t pd-care-frontend:latest ./apps/frontend
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

1. Point DNS records to the Kubernetes ingress external IP / load balancer.
2. Provide TLS certificates for both domains (or install cert-manager issuance).
3. Create the TLS secrets in each namespace (next section).

## 3) TLS secrets for ingress

Create per-namespace TLS secrets used by ingress resources.

Example with existing cert/key files:

```bash
kubectl create secret tls test-pd-lu-im-ntu-edu-tw-tls \
  --cert=/path/to/test.pd.lu.im.ntu.edu.tw.crt \
  --key=/path/to/test.pd.lu.im.ntu.edu.tw.key \
  -n pd-care-dev

kubectl create secret tls pd-lu-im-ntu-edu-tw-tls \
  --cert=/path/to/pd.lu.im.ntu.edu.tw.crt \
  --key=/path/to/pd.lu.im.ntu.edu.tw.key \
  -n pd-care-prod
```

If namespaces do not exist yet, apply overlays first, then create the TLS secrets.

## 4) Deploy

Apply each overlay independently:

```bash
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/prod
```

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

## 6) Scoped updates (default)

Only restart affected workloads.

Frontend-only change:

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:latest ./apps/frontend
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

## 7) Safety rules (production-data protection)

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

## 8) Config and secret management

The base secret file `k8s/base/secret.template.yaml` is a template.

Before production-like use:

1. Replace default secrets.
2. Update `DATABASE_URL` to use the real password.
3. Re-apply overlays:

```bash
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/prod
```

## 9) Troubleshooting

Render manifests to inspect final output:

```bash
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/prod
```

If pods fail because images are missing, rebuild inside Minikube docker:

```bash
eval "$(minikube docker-env)"
docker build -t pd-care-frontend:latest ./apps/frontend
docker build -t pd-care-backend:latest ./apps/backend
```
