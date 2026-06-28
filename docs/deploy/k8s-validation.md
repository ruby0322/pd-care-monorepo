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
647 /tmp/pd-care-k8s-dev.yaml
617 /tmp/pd-care-k8s-prod.yaml
1264 total
```

Dry-run output summary:

```text
dev overlay: resources unchanged/configured (dry run)
prod overlay: resources created (dry run)
```

## Interpretation

- Overlay rendering succeeded for both environments.
- Client-side dry-run succeeded for both overlays in active Minikube context.
- Earlier API discovery errors were environment/context-specific and are no longer present.
