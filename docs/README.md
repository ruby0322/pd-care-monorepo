# PD Care documentation

| Directory | Contents |
| --- | --- |
| [`product/`](product/) | PRDs, implementation roadmap, API contracts |
| [`backlog/`](backlog/) | Project-wide deferred work (indexed by zone) |
| [`deploy/`](deploy/) | Kubernetes, GitOps, TLS, and cutover runbooks |
| [`ops/`](ops/) | Day-2 operations (observability, host-side stacks) |
| [`architecture/`](architecture/) | System architecture (Markdown) |
| [`archive/`](archive/) | Superseded documents |

## Product

- [`curated-prd.md`](product/curated-prd.md) — clinical pilot product baseline
- [`admin-dashboard-prd.md`](product/admin-dashboard-prd.md) — admin dashboard scope and RBAC
- [`dev-plan.md`](product/dev-plan.md) — phased implementation roadmap
- [`history-overview-api-contract.md`](product/history-overview-api-contract.md) — staff 歷史總覽 API contract
- [`archive/prd.md`](archive/prd.md) — original human brief (historical)

## Backlog

Start at [`backlog/README.md`](backlog/README.md) for conventions and the open-items index.

## Deploy runbooks

| Doc | Purpose |
| --- | --- |
| [`k8s-minikube.md`](deploy/k8s-minikube.md) | Minikube dual-namespace deploy and verify |
| [`k8s-domain-handover.md`](deploy/k8s-domain-handover.md) | DNS/TLS cutover checklist |
| [`k8s-migration.md`](deploy/k8s-migration.md) | Data migration Compose → K8s |
| [`k8s-zero-downtime-rollout.md`](deploy/k8s-zero-downtime-rollout.md) | Prod rolling upgrades |
| [`k8s-validation.md`](deploy/k8s-validation.md) | Post-migration validation notes |
| [`argocd-cd.md`](deploy/argocd-cd.md) | GitOps CD and promotion |
| [`argocd-dashboard.md`](deploy/argocd-dashboard.md) | Argo CD UI access |
| [`tls-renewal.md`](deploy/tls-renewal.md) | cert-manager TLS operations |

## Architecture

- [`architecture/README.md`](architecture/README.md) — overview and diagrams
- [`architecture/application.md`](architecture/application.md) — clinical app, API, AI pipeline, data model
- [`architecture/platform.md`](architecture/platform.md) — Compose / K8s, ingress, TLS, GitOps CD

## Operations

- [`local-dev-without-line.md`](ops/local-dev-without-line.md) — host-local stub auth + personas (no LINE)
- [`observability.md`](ops/observability.md) — Prometheus, Loki, Grafana (Compose)
- [`k8s-minikube-volume-migration-and-recovery.md`](ops/k8s-minikube-volume-migration-and-recovery.md) — Minikube volume move + control-plane recovery
