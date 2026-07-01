# K8s Cutover Follow-ups (Deferred)

Items intentionally deferred from the dual-environment cutover prep PR. Track here before the live DNS cutover.

## Compose env parity

Docker Compose sets optional backend env vars that are not yet in K8s manifests:

| Variable | Compose source | K8s status | Risk if omitted |
| --- | --- | --- | --- |
| `PILOT_ADMIN_IDENTITY_IDS` | `docker-compose.yml` | Not in ConfigMap/Secret | Pilot admin access control dropped on cutover |
| `PILOT_STAFF_IDENTITY_IDS` | `docker-compose.yml` | Not in ConfigMap/Secret | Pilot staff access control dropped on cutover |
| `HF_TOKEN` | `docker-compose.yml` / overlay secret | Placeholder in `secret.yaml.example` | Prescreen model download fails if HF repo is private |

`IMAGE_ACCESS_TOKEN_TTL_SECONDS` and `AUTH_TOKEN_TTL_SECONDS` are omitted from K8s manifests; backend defaults (300 / 28800) match Compose.

**Before cutover:** Copy values from the Compose `.env` into overlay secrets or ConfigMaps as appropriate.

## Real cluster readiness

Minikube prep uses local image tags and CPU-only scheduling. A real cluster needs:

| Gap | Current state | Follow-up |
| --- | --- | --- |
| Image supply chain | `pd-care-frontend:latest`, `imagePullPolicy: IfNotPresent` | Push to a registry; pin digests or immutable tags |
| GPU inference | `DEVICE: auto` in ConfigMap; no `nvidia.com/gpu` limits | Add node selectors / resource limits if matching `docker-compose.gpu.yml` latency |
| NetworkPolicies | None | Restrict pod-to-pod traffic within namespace (optional hardening) |
| Postgres `pg_hba` | Compose mounts `ops/security/postgres/pg_hba.remote.conf` | Document cluster-internal-only assumption or port equivalent |

## Observability

Grafana/Prometheus/Loki remain Compose-only. See [`docs/observability.md`](../observability.md) and [`k8s-minikube.md` §4.2](k8s-minikube.md#42-observability--grafana-deferred).
