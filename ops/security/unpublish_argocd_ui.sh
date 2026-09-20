#!/usr/bin/env bash
# Remove the public Argo CD Ingress so the GitOps UI is no longer reachable on
# the operator host's campus IP (80/443 via the ingress bridge).
#
# NTU CERT 2026 資安攻防演練 commonly flags public management consoles.
# After this, use: bash ops/deploy/argocd-ui-portforward.sh
set -euo pipefail

NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
INGRESS_NAME="${ARGOCD_INGRESS_NAME:-argocd-server}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

if kubectl -n "${NAMESPACE}" get ingress "${INGRESS_NAME}" >/dev/null 2>&1; then
  kubectl -n "${NAMESPACE}" delete ingress "${INGRESS_NAME}"
  echo "Deleted ingress/${INGRESS_NAME} in ${NAMESPACE}"
else
  echo "No ingress/${INGRESS_NAME} in ${NAMESPACE} (already unpublished)"
fi

echo "Argo CD UI: bash ops/deploy/argocd-ui-portforward.sh"
echo "Do not re-apply k8s/argocd/ingress.yaml on a public campus IP."
