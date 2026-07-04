# TLS renewal (cert-manager)

Ingress TLS is managed by cert-manager. Certificates and TLS Secrets are renewed
inside the cluster automatically.

## Source of truth

- ClusterIssuer: [`k8s/cert-manager/cluster-issuer-letsencrypt-prod.yaml`](../../k8s/cert-manager/cluster-issuer-letsencrypt-prod.yaml)
- Certificates: [`k8s/cert-manager/`](../../k8s/cert-manager/)

Managed hosts:

| Domain | Secret | Namespace |
| --- | --- | --- |
| `test.pd.lu.im.ntu.edu.tw` | `test-pd-lu-im-ntu-edu-tw-tls` | `pd-care-dev` |
| `pd.lu.im.ntu.edu.tw` | `pd-lu-im-ntu-edu-tw-tls` | `pd-care-prod` |
| `argocd.pd.lu.im.ntu.edu.tw` | `argocd-pd-lu-im-ntu-edu-tw-tls` | `argocd` |

## One-time setup

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager --timeout=300s
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=300s

kubectl apply -k k8s/cert-manager
```

## Verification

```bash
kubectl get certificate -A
kubectl get challenge -A
kubectl describe certificate test-pd-lu-im-ntu-edu-tw -n pd-care-dev
kubectl describe certificate pd-lu-im-ntu-edu-tw -n pd-care-prod
kubectl describe certificate argocd-pd-lu-im-ntu-edu-tw -n argocd
```

## Operations notes

- No manual `certbot renew` or `kubectl create secret tls` rotation is required.
- If renewal fails, inspect cert-manager logs/events:

```bash
kubectl logs -n cert-manager deploy/cert-manager --tail=200
kubectl get orders,challenges -A
```

- ACME HTTP-01 requires public HTTP reachability on host `:80` (see
  [`docker-compose.ingress-bridge.yml`](../../docker-compose.ingress-bridge.yml)).

## Deprecated path

These scripts are retained only for emergency rollback to host-managed certbot and
should not be used in normal operation:

- `ops/deploy/sync-ingress-tls-secrets.sh`
- `ops/deploy/sync-argocd-tls-secret.sh`

Removal is tracked as [PLAT-004](../backlog/platform-gitops.md#plat-004-remove-deprecated-certbot-sync-scripts).

## Project backlog

Platform hardening and other deferred work: [`backlog/`](../backlog/README.md).
