# PD Care Backlog

Project-wide tracker for **deferred** work: intentional gaps, hardening, and
follow-ups that are out of active delivery scope. Phased product delivery and
acceptance criteria remain in [`dev-plan.md`](../product/dev-plan.md).

All zones live in this directory (`docs/backlog/`).

## Zones

| Zone | File | ID prefix | Scope |
| --- | --- | --- | --- |
| Product & clinical | [`product.md`](product.md) | `PROD-` | Features, observability UX, pilot ops not in the current phase |
| K8s & infrastructure | [`k8s-infrastructure.md`](k8s-infrastructure.md) | `K8S-` | Cutover parity, real-cluster readiness, data plane gaps |
| Platform & GitOps | [`platform-gitops.md`](platform-gitops.md) | `PLAT-` | Argo CD, cert-manager, TLS, bootstrap vs GitOps layering |

## Conventions

| Field | Values |
| --- | --- |
| **ID** | `{PREFIX}-###` — cite in PRs and issues |
| **Priority** | `P0` blocker · `P1` before next related change · `P2` worthwhile · `P3` nice-to-have |
| **Status** | `backlog` · `ready` · `in_progress` · `done` · `wont_fix` |
| **Trigger** | When to pull this item (optional but preferred over vague priority) |

When starting work: set **Status** to `in_progress`, link the PR in **Outcome**,
then mark `done` with a one-line result.

## Open items (index)

| ID | Title | Zone | Priority | Status |
| --- | --- | --- | --- | --- |
| [PROD-001](product.md#prod-001-observability-on-kubernetes) | Observability on Kubernetes | product | P2 | `backlog` |
| [K8S-001](k8s-infrastructure.md#k8s-001-compose-env-parity) | Compose env parity on K8s | k8s | P1 | `backlog` |
| [K8S-002](k8s-infrastructure.md#k8s-002-image-supply-chain) | Image supply chain for real clusters | k8s | P1 | `backlog` |
| [K8S-003](k8s-infrastructure.md#k8s-003-gpu-inference) | GPU inference scheduling | k8s | P2 | `backlog` |
| [K8S-004](k8s-infrastructure.md#k8s-004-network-policies) | NetworkPolicies (optional hardening) | k8s | P3 | `backlog` |
| [K8S-005](k8s-infrastructure.md#k8s-005-postgres-pg_hba) | Postgres `pg_hba` on K8s | k8s | P3 | `backlog` |
| [PLAT-001](platform-gitops.md#plat-001-pd-care-platform-argo-application) | `pd-care-platform` Argo Application | platform | P2 | `backlog` |
| [PLAT-002](platform-gitops.md#plat-002-pin-cert-manager-controller-version) | Pin cert-manager controller version | platform | P1 | `backlog` |
| [PLAT-003](platform-gitops.md#plat-003-persist-acme-http-01-solver-nameservers) | Persist ACME HTTP-01 solver nameservers | platform | P2 | `backlog` |
| [PLAT-004](platform-gitops.md#plat-004-remove-deprecated-certbot-sync-scripts) | Remove deprecated certbot sync scripts | platform | P3 | `backlog` |

## Adding items

1. Pick the zone file and next ID in that prefix series.
2. Add a row to the index table above.
3. Add a detail block in the zone file (copy an existing `### PREFIX-###` section).

Do not duplicate [`dev-plan.md`](../product/dev-plan.md) phase tasks here unless they are
explicitly deferred past the phase they were introduced in.
