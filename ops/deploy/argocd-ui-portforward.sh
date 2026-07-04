#!/usr/bin/env bash
set -euo pipefail

ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
LOCAL_PORT="${ARGOCD_UI_LOCAL_PORT:-8080}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd kubectl

if ! kubectl get svc argocd-server -n "${ARGOCD_NAMESPACE}" >/dev/null 2>&1; then
  echo "argocd-server not found in namespace ${ARGOCD_NAMESPACE}." >&2
  echo "Run: bash ops/deploy/bootstrap-argocd-cd.sh" >&2
  exit 1
fi

echo "==> Argo CD UI (localhost port-forward)"

insecure="$(kubectl -n "${ARGOCD_NAMESPACE}" get configmap argocd-cmd-params-cm \
  -o jsonpath='{.data.server\.insecure}' 2>/dev/null || true)"
if [[ "${insecure}" == "true" ]]; then
  target_port=80
  url_scheme="http"
else
  target_port=443
  url_scheme="https"
fi

echo "URL:      ${url_scheme}://127.0.0.1:${LOCAL_PORT}"
echo "User:     admin"
echo "Password: (from argocd-initial-admin-secret; rotate after first login)"
if [[ "${insecure}" == "true" ]]; then
  echo "Note:     server.insecure is enabled (ingress-terminated TLS); port-forward uses HTTP."
fi
echo

if kubectl get secret argocd-initial-admin-secret -n "${ARGOCD_NAMESPACE}" >/dev/null 2>&1; then
  initial_password="$(kubectl -n "${ARGOCD_NAMESPACE}" get secret argocd-initial-admin-secret \
    -o jsonpath='{.data.password}' 2>/dev/null | base64 -d 2>/dev/null || true)"
  if [[ -n "${initial_password}" ]]; then
    echo "Initial admin password: ${initial_password}"
    echo
  fi
fi

echo "Press Ctrl+C to stop. See docs/deploy/argocd-dashboard.md for details."
echo

exec kubectl port-forward "svc/argocd-server" -n "${ARGOCD_NAMESPACE}" "${LOCAL_PORT}:${target_port}"
