# Operations documentation

Host-side and day-2 operational guides (distinct from [`../deploy/`](../deploy/) Kubernetes runbooks).

| Doc | Purpose |
| --- | --- |
| [`observability.md`](observability.md) | Prometheus, Loki, Grafana via Compose |
| [`local-dev-without-line.md`](local-dev-without-line.md) | Verify login/onboarding flows for any role without a real LINE account |
| [`k8s-minikube-volume-migration-and-recovery.md`](k8s-minikube-volume-migration-and-recovery.md) | Move Minikube/pd-care volumes to a large disk; recover after reboot or wiped container layer |

K8s observability migration: [PROD-001](../backlog/product.md#prod-001-observability-on-kubernetes).
