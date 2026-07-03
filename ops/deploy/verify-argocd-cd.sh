#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
FAILURES=0

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; FAILURES=$((FAILURES + 1)); }
skip() { echo "SKIP: $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd kubectl

echo "==> Argo CD controller"
if kubectl get crd applications.argoproj.io >/dev/null 2>&1; then
  pass "applications.argoproj.io CRD present"
else
  fail "Argo CD not installed (missing applications.argoproj.io)"
fi

if kubectl get namespace "${ARGOCD_NAMESPACE}" >/dev/null 2>&1; then
  pass "namespace ${ARGOCD_NAMESPACE} exists"
else
  fail "namespace ${ARGOCD_NAMESPACE} missing"
fi

echo "==> Argo CD applications"
for app in pd-care-dev pd-care-prod; do
  if kubectl -n "${ARGOCD_NAMESPACE}" get application "${app}" >/dev/null 2>&1; then
    sync_status="$(kubectl -n "${ARGOCD_NAMESPACE}" get application "${app}" -o jsonpath='{.status.sync.status}' 2>/dev/null || true)"
    health_status="$(kubectl -n "${ARGOCD_NAMESPACE}" get application "${app}" -o jsonpath='{.status.health.status}' 2>/dev/null || true)"
    if [[ "${sync_status}" == "Synced" && "${health_status}" == "Healthy" ]]; then
      pass "application ${app} synced and healthy"
    else
      fail "application ${app} sync=${sync_status:-unknown} health=${health_status:-unknown}"
    fi
  else
    fail "application ${app} not found"
  fi
done

echo "==> GHCR pull secrets"
for ns in pd-care-dev pd-care-prod; do
  if kubectl -n "${ns}" get secret ghcr-pull-secret >/dev/null 2>&1; then
    pass "ghcr-pull-secret present in ${ns}"
  else
    fail "ghcr-pull-secret missing in ${ns}"
  fi
done

echo "==> Workload health"
for ns in pd-care-dev pd-care-prod; do
  for deploy in frontend backend; do
    if kubectl -n "${ns}" get deploy "${deploy}" >/dev/null 2>&1; then
      ready="$(kubectl -n "${ns}" get deploy "${deploy}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)"
      desired="$(kubectl -n "${ns}" get deploy "${deploy}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
      if [[ "${ready:-0}" == "${desired}" && "${desired}" != "0" ]]; then
        pass "${ns}/${deploy} ${ready}/${desired} ready"
      else
        fail "${ns}/${deploy} ${ready:-0}/${desired} ready"
      fi
    else
      skip "${ns}/${deploy} deployment not found"
    fi
  done
done

echo "==> Prod migration job (if present)"
if kubectl -n pd-care-prod get job backend-migrate >/dev/null 2>&1; then
  job_status="$(kubectl -n pd-care-prod get job backend-migrate -o jsonpath='{.status.succeeded}' 2>/dev/null || echo 0)"
  if [[ "${job_status}" == "1" ]]; then
    pass "pd-care-prod/backend-migrate succeeded"
  else
    fail "pd-care-prod/backend-migrate not succeeded (succeeded=${job_status})"
  fi
else
  skip "pd-care-prod/backend-migrate job not present"
fi

check_ingress_health() {
  local label="$1"
  local url="$2"
  local host="$3"
  local namespace="$4"

  if curl -fsS "${url}" >/dev/null 2>&1; then
    pass "${label}"
    return 0
  fi

  local ingress_ip=""
  if kubectl get ingress -n "${namespace}" >/dev/null 2>&1; then
    ingress_ip="$(kubectl get ingress -n "${namespace}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  fi
  if [[ -z "${ingress_ip}" ]] && command -v minikube >/dev/null 2>&1; then
    ingress_ip="$(minikube ip 2>/dev/null || true)"
  fi
  if [[ -n "${ingress_ip}" ]] && curl -fsSk --resolve "${host}:443:${ingress_ip}" "${url}" >/dev/null 2>&1; then
    pass "${label} (via ingress ${ingress_ip})"
    return 0
  fi

  fail "${label}"
  return 1
}

echo "==> Ingress health checks"
if command -v curl >/dev/null 2>&1; then
  check_ingress_health \
    "dev ingress /api/healthz" \
    "https://test.pd.lu.im.ntu.edu.tw/api/healthz" \
    "test.pd.lu.im.ntu.edu.tw" \
    "pd-care-dev"
  check_ingress_health \
    "prod ingress /api/readyz" \
    "https://pd.lu.im.ntu.edu.tw/api/readyz" \
    "pd.lu.im.ntu.edu.tw" \
    "pd-care-prod"
else
  skip "curl not available for ingress checks"
fi

echo
if [[ "${FAILURES}" -eq 0 ]]; then
  echo "Verification passed."
  exit 0
fi

echo "Verification failed with ${FAILURES} issue(s)."
exit 1
