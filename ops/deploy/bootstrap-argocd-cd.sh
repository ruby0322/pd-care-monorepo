#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
ARGOCD_INSTALL_URL="${ARGOCD_INSTALL_URL:-https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml}"
CERT_MANAGER_INSTALL_URL="${CERT_MANAGER_INSTALL_URL:-https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml}"
GHCR_USER="${GHCR_USER:-ruby0322}"
GHCR_TOKEN="${GHCR_TOKEN:-${GITHUB_PAT_TOKEN:-}}"
GITHUB_PAT="${GITHUB_PAT:-}"
REPO_URL="https://github.com/ruby0322/pd-care-monorepo.git"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd kubectl

echo "==> Ensuring Argo CD namespace and controller"
if ! kubectl get namespace "${ARGOCD_NAMESPACE}" >/dev/null 2>&1; then
  kubectl create namespace "${ARGOCD_NAMESPACE}"
fi

if ! kubectl get crd applications.argoproj.io >/dev/null 2>&1; then
  echo "Installing Argo CD from ${ARGOCD_INSTALL_URL}"
  set +e
  kubectl apply -n "${ARGOCD_NAMESPACE}" -f "${ARGOCD_INSTALL_URL}"
  install_status=$?
  set -e
  if ! kubectl get crd applications.argoproj.io >/dev/null 2>&1; then
    echo "Argo CD install failed: applications.argoproj.io CRD missing (exit ${install_status})" >&2
    exit 1
  fi
  if [[ "${install_status}" -ne 0 ]]; then
    echo "WARN: Argo CD install returned ${install_status}; continuing because core CRDs exist"
  fi
  kubectl -n "${ARGOCD_NAMESPACE}" rollout status deploy/argocd-server --timeout=300s
  kubectl -n "${ARGOCD_NAMESPACE}" rollout status deploy/argocd-repo-server --timeout=300s
  kubectl -n "${ARGOCD_NAMESPACE}" rollout status statefulset/argocd-application-controller --timeout=300s
else
  echo "Argo CD CRDs already present; skipping install"
fi

echo "==> Ensuring PD Care namespaces"
for ns in pd-care-dev pd-care-prod; do
  kubectl get namespace "${ns}" >/dev/null 2>&1 || kubectl create namespace "${ns}"
done

echo "==> Ensuring cert-manager controller"
if ! kubectl get crd certificates.cert-manager.io >/dev/null 2>&1; then
  echo "Installing cert-manager from ${CERT_MANAGER_INSTALL_URL}"
  set +e
  kubectl apply -f "${CERT_MANAGER_INSTALL_URL}"
  cert_manager_install_status=$?
  set -e
  if ! kubectl get crd certificates.cert-manager.io >/dev/null 2>&1; then
    echo "cert-manager install failed: certificates.cert-manager.io CRD missing (exit ${cert_manager_install_status})" >&2
    exit 1
  fi
  if [[ "${cert_manager_install_status}" -ne 0 ]]; then
    echo "WARN: cert-manager install returned ${cert_manager_install_status}; continuing because core CRDs exist"
  fi
else
  echo "cert-manager CRDs already present; skipping install"
fi
kubectl -n cert-manager rollout status deploy/cert-manager --timeout=300s
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=300s

if [[ -d k8s/cert-manager ]]; then
  echo "==> Applying cert-manager issuer and certificates"
  kubectl apply -k k8s/cert-manager
fi

echo "==> Applying PD Care Argo CD project and applications"
kubectl apply -f k8s/argocd/project.yaml
kubectl apply -f k8s/argocd/dev-application.yaml
kubectl apply -f k8s/argocd/prod-application.yaml

echo "==> Argo CD server ingress (Phase 2 UI)"
if [[ -f k8s/argocd/cmd-params-patch.yaml ]]; then
  kubectl apply -f k8s/argocd/cmd-params-patch.yaml
  kubectl -n "${ARGOCD_NAMESPACE}" rollout restart deploy/argocd-server
  kubectl -n "${ARGOCD_NAMESPACE}" rollout status deploy/argocd-server --timeout=300s
fi
if [[ -f k8s/argocd/ingress.yaml ]]; then
  kubectl apply -f k8s/argocd/ingress.yaml
  if ! kubectl -n "${ARGOCD_NAMESPACE}" get secret argocd-pd-lu-im-ntu-edu-tw-tls >/dev/null 2>&1; then
    echo "WARN: TLS secret argocd-pd-lu-im-ntu-edu-tw-tls missing in ${ARGOCD_NAMESPACE}"
    echo "      Waiting for cert-manager Certificate/argocd-pd-lu-im-ntu-edu-tw to become Ready"
  fi
fi

for ns in pd-care-dev pd-care-prod; do
  echo "==> Namespace ${ns}"
  if [[ -n "${GHCR_TOKEN}" ]]; then
    kubectl -n "${ns}" delete secret ghcr-pull-secret --ignore-not-found
    kubectl -n "${ns}" create secret docker-registry ghcr-pull-secret \
      --docker-server=ghcr.io \
      --docker-username="${GHCR_USER}" \
      --docker-password="${GHCR_TOKEN}"
    echo "Created ghcr-pull-secret in ${ns}"
  else
    echo "SKIP: GHCR_TOKEN not set; create ghcr-pull-secret in ${ns} manually (see docs/deploy/argocd-cd.md §2)"
  fi
done

if [[ -n "${GITHUB_PAT}" ]]; then
  echo "==> Configuring Argo CD repository credentials"
  kubectl -n "${ARGOCD_NAMESPACE}" delete secret repo-pd-care-monorepo --ignore-not-found
  kubectl -n "${ARGOCD_NAMESPACE}" create secret generic repo-pd-care-monorepo \
    --from-literal=type=git \
    --from-literal=url="${REPO_URL}" \
    --from-literal=username=git \
    --from-literal=password="${GITHUB_PAT}"
  kubectl -n "${ARGOCD_NAMESPACE}" label secret repo-pd-care-monorepo \
    argocd.argoproj.io/secret-type=repository --overwrite
  echo "Created Argo CD repository secret repo-pd-care-monorepo"
else
  echo "SKIP: GITHUB_PAT not set; not required while pd-care-monorepo is public (see docs/deploy/argocd-cd.md)"
fi

echo
echo "Bootstrap complete."
echo "Next: run ops/deploy/verify-argocd-cd.sh"
echo "UI:   bash ops/deploy/argocd-ui-portforward.sh  (see docs/deploy/argocd-dashboard.md)"
echo "      or https://argocd.pd.lu.im.ntu.edu.tw when TLS secret is configured"
