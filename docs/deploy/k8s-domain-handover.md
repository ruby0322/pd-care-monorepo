# K8s Domain Handover Checklist

Use this checklist to complete DNS/TLS cutover from Docker Compose to Kubernetes ingress without cert-manager.

## Target domains

- Production namespace `pd-care-prod`: `pd.lu.im.ntu.edu.tw`
- Test namespace `pd-care-dev`: `test.pd.lu.im.ntu.edu.tw`

Ingress host mappings are defined in:

- [`k8s/overlays/prod/patch-ingress.yaml`](../../k8s/overlays/prod/patch-ingress.yaml)
- [`k8s/overlays/dev/patch-ingress.yaml`](../../k8s/overlays/dev/patch-ingress.yaml)

## Required preconditions

1. DNS records are set:
   - **Minikube (this repo):** `pd.lu.im.ntu.edu.tw` and `test.pd.lu.im.ntu.edu.tw` → **operator host public IP**; start [`docker-compose.ingress-bridge.yml`](../../docker-compose.ingress-bridge.yml) to forward host `:443` to ingress NodePort (see [`k8s-minikube.md` §2.1](k8s-minikube.md#21-ingress-architecture-two-layers)).
   - **Cloud LB (future):** DNS → Kubernetes ingress external IP/load balancer.
2. Ingress controller class `nginx` is active.
3. Namespace secrets are distinct and applied out-of-band (not committed to git):
   - Dev template: [`k8s/overlays/dev/secret.yaml.example`](../../k8s/overlays/dev/secret.yaml.example)
   - Prod template: [`k8s/overlays/prod/secret.yaml.example`](../../k8s/overlays/prod/secret.yaml.example)
   - Apply with `kubectl apply -f k8s/overlays/<env>/secret.yaml -n <namespace>` before overlay deploy (see [`k8s-minikube.md` §9](k8s-minikube.md#9-config-and-secret-management))
4. Data migration prep is complete (see [`docs/deploy/k8s-migration.md`](k8s-migration.md)).

## Certbot issuance (no cert-manager)

Issue certificates on the operator host:

```bash
sudo certbot certonly --standalone -d test.pd.lu.im.ntu.edu.tw
sudo certbot certonly --standalone -d pd.lu.im.ntu.edu.tw
```

Create namespace TLS secrets from certbot outputs:

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

Renewal refresh (run after `certbot renew`):

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

## Cutover order

1. Deploy and verify `pd-care-dev`.
2. Deploy `pd-care-prod` and verify pods/probes/PVC readiness.
3. Complete data migration into `pd-care-prod` (Postgres + object storage).
4. Point `pd.lu.im.ntu.edu.tw` DNS/LB to K8s ingress.
5. Run smoke tests on production domain.
6. Only after successful smoke tests, stop Docker Compose production frontend/backend routing.

## Rollback

If post-cutover smoke tests fail:

1. Revert `pd.lu.im.ntu.edu.tw` DNS/LB target back to Docker Compose endpoint.
2. Keep K8s namespaces running for diagnosis.
3. Do not delete PVCs during rollback.

## Go / no-go checklist

Go only if all are true:

- `kubectl get pods -n pd-care-dev` and `-n pd-care-prod` are healthy.
- `kubectl get pvc -n pd-care-prod` shows all required PVCs `Bound`.
- TLS secrets exist in both namespaces.
- Data migration verification passes in `pd-care-prod`.
- Through production ingress (with bridge running): `curl -fsS https://pd.lu.im.ntu.edu.tw/api/healthz` and `curl -fsS https://pd.lu.im.ntu.edu.tw/api/readyz` return 200.

No-go if any of the above fails.

## Non-sudo verification

You can verify domain routing without editing `/etc/hosts` by using `--resolve`.

`INGRESS_IP` depends on what you are testing:

- `INGRESS_IP=$(minikube ip)` — direct ingress NodePort (bridge not required).
- `INGRESS_IP=<host-public-ip>` — full path through the ingress bridge (matches real DNS).

```bash
INGRESS_IP="$(minikube ip)"
curl -kI --resolve test.pd.lu.im.ntu.edu.tw:443:${INGRESS_IP} https://test.pd.lu.im.ntu.edu.tw/
curl -kI --resolve pd.lu.im.ntu.edu.tw:443:${INGRESS_IP} https://pd.lu.im.ntu.edu.tw/
```
