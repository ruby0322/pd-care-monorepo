# Deploy runbooks

Kubernetes, GitOps, TLS, and environment cutover for `pd-care-dev` and `pd-care-prod`.

| Doc | Purpose |
| --- | --- |
| [`k8s-minikube.md`](k8s-minikube.md) | Minikube dual-namespace deploy and verify |
| [`k8s-domain-handover.md`](k8s-domain-handover.md) | DNS/TLS cutover checklist |
| [`k8s-migration.md`](k8s-migration.md) | Data migration Compose → K8s |
| [`k8s-zero-downtime-rollout.md`](k8s-zero-downtime-rollout.md) | Prod rolling upgrades |
| [`k8s-validation.md`](k8s-validation.md) | Post-migration validation notes |
| [`argocd-cd.md`](argocd-cd.md) | GitOps CD and promotion |
| [`argocd-dashboard.md`](argocd-dashboard.md) | Argo CD UI access |
| [`tls-renewal.md`](tls-renewal.md) | cert-manager TLS operations |

Host storage moves and Minikube control-plane recovery (reboot / bind-mount / wiped container layer): [`../ops/k8s-minikube-volume-migration-and-recovery.md`](../ops/k8s-minikube-volume-migration-and-recovery.md).

Deferred platform and cutover items: [`../backlog/README.md`](../backlog/README.md).
