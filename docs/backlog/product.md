# Product backlog

Deferred product and operator-facing work. Active phased delivery:
[`dev-plan.md`](../product/dev-plan.md).

| ID | Title | Priority | Status | Trigger | Outcome |
| --- | --- | --- | --- | --- | --- |
| [PROD-001](#prod-001-observability-on-kubernetes) | Observability on Kubernetes | P2 | `backlog` | K8s cutover complete; staff need `/grafana` on cluster domains | — |

---

### PROD-001: Observability on Kubernetes

| | |
| --- | --- |
| **Priority** | P2 |
| **Status** | `backlog` |
| **Problem** | Grafana, Prometheus, and Loki remain Compose-only. On K8s-hosted domains, `/grafana` and `/admin/monitoring` fail until the stack is migrated or `GRAFANA_INTERNAL_URL` points at a reachable host-side endpoint. |
| **Proposal** | Migrate or sidecar the observability stack for K8s; align ingress paths with [`observability.md`](../ops/observability.md). |
| **Acceptance** | Staff can open monitoring from prod/dev cluster URLs without Compose-only routing |
| **Related** | [`k8s-minikube.md` §4.2](../deploy/k8s-minikube.md#42-observability--grafana-deferred), [`observability.md`](../ops/observability.md) |
