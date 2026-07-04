# K8s & infrastructure backlog

Deferred items from dual-environment cutover prep and real-cluster readiness.
Deploy runbooks: [`k8s-minikube.md`](../deploy/k8s-minikube.md),
[`k8s-domain-handover.md`](../deploy/k8s-domain-handover.md).

| ID | Title | Priority | Status | Trigger | Outcome |
| --- | --- | --- | --- | --- | --- |
| [K8S-001](#k8s-001-compose-env-parity) | Compose env parity on K8s | P1 | `backlog` | Before pilot access control on K8s-only | — |
| [K8S-002](#k8s-002-image-supply-chain) | Image supply chain for real clusters | P1 | `backlog` | Leaving Minikube / multi-node cluster | — |
| [K8S-003](#k8s-003-gpu-inference) | GPU inference scheduling | P2 | `backlog` | GPU nodes available | — |
| [K8S-004](#k8s-004-network-policies) | NetworkPolicies | P3 | `backlog` | Security review or multi-tenant cluster | — |
| [K8S-005](#k8s-005-postgres-pg_hba) | Postgres `pg_hba` on K8s | P3 | `backlog` | Exposing Postgres beyond cluster network | — |

---

### K8S-001: Compose env parity

| | |
| --- | --- |
| **Priority** | P1 |
| **Status** | `backlog` |

Docker Compose sets optional backend env vars not yet in K8s manifests:

| Variable | Compose source | K8s status | Risk if omitted |
| --- | --- | --- | --- |
| `PILOT_ADMIN_IDENTITY_IDS` | `docker-compose.yml` | Not in ConfigMap/Secret | Pilot admin access control dropped on cutover |
| `PILOT_STAFF_IDENTITY_IDS` | `docker-compose.yml` | Not in ConfigMap/Secret | Pilot staff access control dropped on cutover |
| `HF_TOKEN` | `docker-compose.yml` / overlay secret | Placeholder in `secret.yaml.example` | Prescreen model download fails if HF repo is private |

`IMAGE_ACCESS_TOKEN_TTL_SECONDS` and `AUTH_TOKEN_TTL_SECONDS` are omitted from K8s
manifests; backend defaults (300 / 28800) match Compose.

**Before cutover:** Copy values from the Compose `.env` into overlay secrets or
ConfigMaps as appropriate.

---

### K8S-002: Image supply chain

| | |
| --- | --- |
| **Priority** | P1 |
| **Status** | `backlog` |
| **Current** | `pd-care-frontend:latest`, `imagePullPolicy: IfNotPresent` on Minikube |
| **Follow-up** | Push to a registry; pin digests or immutable tags (GHCR tags via CD are in progress for app images) |

---

### K8S-003: GPU inference

| | |
| --- | --- |
| **Priority** | P2 |
| **Status** | `backlog` |
| **Current** | `DEVICE: auto` in ConfigMap; no `nvidia.com/gpu` limits |
| **Follow-up** | Add node selectors / GPU resource limits on clusters with GPU nodes |

---

### K8S-004: NetworkPolicies

| | |
| --- | --- |
| **Priority** | P3 |
| **Status** | `backlog` |
| **Current** | None |
| **Follow-up** | Restrict pod-to-pod traffic within namespace (optional hardening) |

---

### K8S-005: Postgres `pg_hba`

| | |
| --- | --- |
| **Priority** | P3 |
| **Status** | `backlog` |
| **Current** | Compose mounts `ops/security/postgres/pg_hba.remote.conf` |
| **Follow-up** | Document cluster-internal-only assumption or port equivalent for K8s Postgres |
