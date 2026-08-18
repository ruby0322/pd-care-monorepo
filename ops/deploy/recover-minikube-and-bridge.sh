#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

PROFILE="${MINIKUBE_PROFILE:-minikube}"
KUBE_CONTEXT="${KUBE_CONTEXT:-${PROFILE}}"
NODE_NAME="${MINIKUBE_NODE_NAME:-minikube}"
BRIDGE_COMPOSE_FILE="${BRIDGE_COMPOSE_FILE:-docker-compose.ingress-bridge.yml}"
INGRESS_NAMESPACE="${INGRESS_NAMESPACE:-ingress-nginx}"
INGRESS_SERVICE="${INGRESS_SERVICE:-ingress-nginx-controller}"

DEV_HEALTH_URL="${DEV_HEALTH_URL:-https://test.pd.lu.im.ntu.edu.tw/api/healthz}"
PROD_READY_URL="${PROD_READY_URL:-https://pd.lu.im.ntu.edu.tw/api/readyz}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

deployment_replicas() {
  local namespace="$1"
  local deploy="$2"
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get deploy "${deploy}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0"
}

deployment_ready_replicas() {
  local namespace="$1"
  local deploy="$2"
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get deploy "${deploy}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0"
}

statefulset_replicas() {
  local namespace="$1"
  local statefulset="$2"
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get statefulset "${statefulset}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0"
}

statefulset_ready_replicas() {
  local namespace="$1"
  local statefulset="$2"
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get statefulset "${statefulset}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing required command: $1"
    exit 1
  }
}

probe_url() {
  local label="$1"
  local url="$2"
  local host="$3"
  local ingress_ip="$4"
  local attempts="${HEALTH_RETRIES:-5}"
  local sleep_seconds="${HEALTH_RETRY_SLEEP_SECONDS:-5}"

  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 10 "${url}" >/dev/null 2>&1; then
      log "${label}: ok"
      return 0
    fi

    if curl -fsSk --max-time 10 --resolve "${host}:443:${ingress_ip}" "${url}" >/dev/null 2>&1; then
      log "${label}: ok (resolved via ${ingress_ip})"
      return 0
    fi

    sleep "${sleep_seconds}"
  done

  log "${label}: failed after ${attempts} attempts"
  return 1
}

delete_stale_pods() {
  local namespace="$1"
  local stale_pods

  stale_pods="$(kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get pods --no-headers 2>/dev/null | awk '$3 == "Error" || $3 == "Completed" || $3 == "CrashLoopBackOff" {print $1}')"
  if [[ -z "${stale_pods}" ]]; then
    return 0
  fi

  log "${namespace}: deleting stale pods"
  while IFS= read -r pod; do
    [[ -z "${pod}" ]] && continue
    kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" delete pod "${pod}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  done <<< "${stale_pods}"
}

ensure_statefulset_ready() {
  local namespace="$1"
  local statefulset="$2"
  local timeout="${3:-600s}"
  local desired ready

  if ! kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get statefulset "${statefulset}" >/dev/null 2>&1; then
    log "${namespace}/${statefulset}: statefulset not found, skipping"
    return 0
  fi

  desired="$(statefulset_replicas "${namespace}" "${statefulset}")"
  ready="$(statefulset_ready_replicas "${namespace}" "${statefulset}")"
  if [[ "${ready}" == "${desired}" && "${desired}" != "0" ]]; then
    log "${namespace}/${statefulset}: already ready (${ready}/${desired})"
    return 0
  fi

  log "${namespace}/${statefulset}: not ready (${ready}/${desired}), restarting statefulset"
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" rollout restart "statefulset/${statefulset}" >/dev/null
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" rollout status "statefulset/${statefulset}" --timeout="${timeout}" >/dev/null
  log "${namespace}/${statefulset}: ready"
}

ensure_deployment_ready() {
  local namespace="$1"
  local deploy="$2"
  local timeout="${3:-600s}"
  local desired ready

  if ! kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" get deploy "${deploy}" >/dev/null 2>&1; then
    log "${namespace}/${deploy}: deployment not found, skipping"
    return 0
  fi

  desired="$(deployment_replicas "${namespace}" "${deploy}")"
  ready="$(deployment_ready_replicas "${namespace}" "${deploy}")"
  if [[ "${ready}" == "${desired}" && "${desired}" != "0" ]]; then
    log "${namespace}/${deploy}: already ready (${ready}/${desired})"
    return 0
  fi

  log "${namespace}/${deploy}: not ready (${ready}/${desired}), restarting deployment"
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" rollout restart "deploy/${deploy}" >/dev/null
  kubectl --context "${KUBE_CONTEXT}" -n "${namespace}" rollout status "deploy/${deploy}" --timeout="${timeout}" >/dev/null
  log "${namespace}/${deploy}: ready"
}

recover_namespace() {
  local namespace="$1"

  if ! kubectl --context "${KUBE_CONTEXT}" get namespace "${namespace}" >/dev/null 2>&1; then
    log "${namespace}: namespace not found, skipping"
    return 0
  fi

  log "${namespace}: beginning workload recovery"
  delete_stale_pods "${namespace}"

  # Stateful dependency first: backend depends on Postgres availability.
  ensure_statefulset_ready "${namespace}" "postgres" "${POSTGRES_READY_TIMEOUT:-600s}"

  for deploy in seaweedfs-master seaweedfs-volume seaweedfs-filer seaweedfs-s3; do
    ensure_deployment_ready "${namespace}" "${deploy}" "${STORAGE_READY_TIMEOUT:-600s}"
  done

  for deploy in backend frontend; do
    ensure_deployment_ready "${namespace}" "${deploy}" "${APP_READY_TIMEOUT:-600s}"
  done

  log "${namespace}: workload recovery completed"
}

require_cmd minikube
require_cmd kubectl
require_cmd docker
require_cmd curl

log "starting minikube profile '${PROFILE}'"
minikube start -p "${PROFILE}"

log "waiting for kubernetes api access on context '${KUBE_CONTEXT}'"
api_attempts="${API_RETRIES:-60}"
api_sleep="${API_RETRY_SLEEP_SECONDS:-5}"
for _ in $(seq 1 "${api_attempts}"); do
  if kubectl --context "${KUBE_CONTEXT}" get nodes >/dev/null 2>&1; then
    break
  fi
  sleep "${api_sleep}"
done

if ! kubectl --context "${KUBE_CONTEXT}" get nodes >/dev/null 2>&1; then
  log "kubernetes api did not become available in time"
  exit 1
fi

log "waiting for node readiness"
if ! kubectl --context "${KUBE_CONTEXT}" wait --for=condition=Ready "node/${NODE_NAME}" --timeout=300s >/dev/null 2>&1; then
  ready_nodes="$(kubectl --context "${KUBE_CONTEXT}" get nodes --no-headers 2>/dev/null | awk '$2 == "Ready" {count++} END {print count+0}')"
  if [[ "${ready_nodes}" -lt 1 ]]; then
    log "no ready nodes found"
    exit 1
  fi
fi

log "reading ingress nodeports"
http_nodeport="$(kubectl --context "${KUBE_CONTEXT}" -n "${INGRESS_NAMESPACE}" get svc "${INGRESS_SERVICE}" -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}')"
https_nodeport="$(kubectl --context "${KUBE_CONTEXT}" -n "${INGRESS_NAMESPACE}" get svc "${INGRESS_SERVICE}" -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}')"

if [[ -z "${http_nodeport}" || -z "${https_nodeport}" ]]; then
  log "failed to read ingress nodeports from ${INGRESS_NAMESPACE}/${INGRESS_SERVICE}"
  exit 1
fi

ingress_ip="$(minikube ip -p "${PROFILE}")"
if [[ -z "${ingress_ip}" ]]; then
  log "failed to read minikube ip"
  exit 1
fi

log "restarting ingress bridge with MINIKUBE_IP=${ingress_ip}, http=${http_nodeport}, https=${https_nodeport}"
MINIKUBE_IP="${ingress_ip}" \
INGRESS_HTTP_NODEPORT="${http_nodeport}" \
INGRESS_HTTPS_NODEPORT="${https_nodeport}" \
docker compose -f "${BRIDGE_COMPOSE_FILE}" up -d

log "recovering application workloads in namespaces"
recover_namespace "pd-care-dev"
recover_namespace "pd-care-prod"

log "running post-start health probes"
probe_url "dev healthz" "${DEV_HEALTH_URL}" "test.pd.lu.im.ntu.edu.tw" "${ingress_ip}"
probe_url "prod readyz" "${PROD_READY_URL}" "pd.lu.im.ntu.edu.tw" "${ingress_ip}"

log "minikube and ingress bridge recovery completed"
