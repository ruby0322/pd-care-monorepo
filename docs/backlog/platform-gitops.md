# Platform & GitOps backlog

Platform-layer work deferred from day-0 bootstrap. Application CD (`pd-care-dev` /
`pd-care-prod`) is documented in [`argocd-cd.md`](../deploy/argocd-cd.md).

## Current baseline (cert-manager migration)

| Layer | Install path | Day-2 reconciliation |
| --- | --- | --- |
| Argo CD controller | Bootstrap (`ops/deploy/bootstrap-argocd-cd.sh`) | Manual upgrade / re-bootstrap |
| cert-manager controller | Bootstrap (upstream `cert-manager.yaml`) | cert-manager renews certs in-cluster |
| `k8s/cert-manager/` (Issuer, Certificates) | Bootstrap `kubectl apply -k` | Git is source of truth; **no Argo sync** |
| Argo CD ingress / cmd-params | Bootstrap | Same as above |
| pd-care dev/prod overlays | Argo CD Applications | Full GitOps |

Acceptable for single-cluster Minikube: controllers avoid chicken-and-egg with
Argo; cert renewal does not require GitOps. Items below close drift and upgrade
gaps when platform config changes often.

| ID | Title | Priority | Status | Trigger | Outcome |
| --- | --- | --- | --- | --- | --- |
| [PLAT-001](#plat-001-pd-care-platform-argo-application) | `pd-care-platform` Argo Application | P2 | `backlog` | New hosts, frequent cert edits, or drift | — |
| [PLAT-002](#plat-002-pin-cert-manager-controller-version) | Pin cert-manager controller version | P1 | `backlog` | Before next cert-manager upgrade | — |
| [PLAT-003](#plat-003-persist-acme-http-01-solver-nameservers) | Persist ACME HTTP-01 solver nameservers | P2 | `backlog` | Cluster rebuild without live patch | — |
| [PLAT-004](#plat-004-remove-deprecated-certbot-sync-scripts) | Remove deprecated certbot sync scripts | P3 | `backlog` | cert-manager stable ≥30 days | — |

---

### PLAT-001: `pd-care-platform` Argo Application

| | |
| --- | --- |
| **Priority** | P2 |
| **Status** | `backlog` |
| **Problem** | `k8s/cert-manager/` and `k8s/argocd/{ingress,cmd-params}` are in git but applied only at bootstrap. Manual `kubectl edit` or forgotten re-apply causes drift. |
| **Proposal** | Add Argo CD Application (e.g. `pd-care-platform`) syncing **repo-owned** manifests only — not the upstream cert-manager install bundle. |
| **In scope** | `k8s/cert-manager/`, `k8s/argocd/ingress.yaml`, `k8s/argocd/cmd-params-patch.yaml` |
| **Out of scope** | cert-manager controller Deployment/CRD install (stay in bootstrap or Helm with pinned version) |
| **Acceptance** | PR changing a `Certificate` merges → Argo syncs → `kubectl get certificate` reflects change; bootstrap still idempotent for first install |
| **Related** | [`bootstrap-argocd-cd.sh`](../../ops/deploy/bootstrap-argocd-cd.sh), [`k8s/argocd/project.yaml`](../../k8s/argocd/project.yaml) |

---

### PLAT-002: Pin cert-manager controller version

| | |
| --- | --- |
| **Priority** | P1 |
| **Status** | `backlog` |
| **Problem** | Bootstrap uses `cert-manager/releases/latest/download/cert-manager.yaml`. Re-bootstrap may install an untested version. |
| **Proposal** | Pin a tested release (e.g. `v1.16.x`) via `CERT_MANAGER_INSTALL_URL` default; document upgrade runbook. |
| **Acceptance** | Fixed default in bootstrap; [`tls-renewal.md`](../deploy/tls-renewal.md) mentions the pin |
| **Related** | [`bootstrap-argocd-cd.sh`](../../ops/deploy/bootstrap-argocd-cd.sh) |

---

### PLAT-003: Persist ACME HTTP-01 solver nameservers

| | |
| --- | --- |
| **Priority** | P2 |
| **Status** | `backlog` |
| **Problem** | cert-manager may need `--acme-http01-solver-nameservers=8.8.8.8:53,1.1.1.1:53` when public DNS propagates before the local resolver. Currently a live Deployment patch only. |
| **Proposal** | Encode in git: Helm values, kustomize merge on `deploy/cert-manager`, or overlay under `k8s/cert-manager/`. |
| **Acceptance** | Fresh bootstrap succeeds without manual `kubectl patch`; HTTP-01 challenges reach `valid` |
| **Related** | [`docker-compose.ingress-bridge.yml`](../../docker-compose.ingress-bridge.yml), [`cluster-issuer-letsencrypt-prod.yaml`](../../k8s/cert-manager/cluster-issuer-letsencrypt-prod.yaml) |

---

### PLAT-004: Remove deprecated certbot sync scripts

| | |
| --- | --- |
| **Priority** | P3 |
| **Status** | `backlog` |
| **Problem** | `sync-ingress-tls-secrets.sh` and `sync-argocd-tls-secret.sh` are emergency rollback stubs. |
| **Proposal** | Delete scripts or move to `docs/deploy/archive/` with a dated note. |
| **Acceptance** | No references in active runbooks |
| **Related** | [`tls-renewal.md`](../deploy/tls-renewal.md) § Deprecated path |
