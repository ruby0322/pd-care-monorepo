# K8s Overlay Validation Notes

Date: 2026-06-28  
Scope: `k8s/overlays/dev`, `k8s/overlays/prod`

## Commands executed

```bash
kubectl kustomize k8s/overlays/dev > /tmp/pd-care-k8s-dev.yaml
kubectl kustomize k8s/overlays/prod > /tmp/pd-care-k8s-prod.yaml
kubectl apply --dry-run=client --validate=false -k k8s/overlays/dev
kubectl apply --dry-run=client --validate=false -k k8s/overlays/prod
wc -l /tmp/pd-care-k8s-dev.yaml /tmp/pd-care-k8s-prod.yaml
```

## Results

- `kubectl kustomize k8s/overlays/dev` -> **exit 0**
- `kubectl kustomize k8s/overlays/prod` -> **exit 0**
- `kubectl apply --dry-run=client --validate=false -k k8s/overlays/dev` -> **exit 0**
- `kubectl apply --dry-run=client --validate=false -k k8s/overlays/prod` -> **exit 0**
- `wc -l /tmp/pd-care-k8s-dev.yaml /tmp/pd-care-k8s-prod.yaml` -> **exit 0**

Rendered line counts:

```text
648 /tmp/pd-care-k8s-dev.yaml
618 /tmp/pd-care-k8s-prod.yaml
1266 total
```

Dry-run output summary:

```text
dev overlay: resources unchanged/configured (dry run)
prod overlay: resources created (dry run)
```

## Dual-env readiness matrix

| Check | Dev (`pd-care-dev`) | Prod (`pd-care-prod`) |
| --- | --- | --- |
| Overlay render (`kubectl kustomize`) | Pass | Pass |
| Dry-run apply (`--validate=false`) | Pass | Pass |
| Namespace exists | Pass | Not deployed |
| Pods ready | Pass | Not deployed |
| Ingress present | Pass (`test.pd.lu.im.ntu.edu.tw`) | Not deployed |
| Secret `pd-care-secrets` present | Pass | Not deployed |
| PVCs bound | Pass | Not deployed |

## Interpretation

- Overlay rendering and dry-run apply succeeded for both environments.
- Dev namespace is healthy and serving.
- Prod namespace has not yet been deployed to this cluster; readiness checks are pending actual apply.
