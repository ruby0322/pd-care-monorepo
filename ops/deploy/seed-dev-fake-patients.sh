#!/usr/bin/env bash
# Seed fake patients + uploads into pd-care-dev (runs inside backend pod).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAMESPACE="${PDCARE_DEV_NAMESPACE:-pd-care-dev}"
SCRIPT_LOCAL="${ROOT}/apps/backend/sql/manual/seed_dev_fake_patients.py"

if [[ ! -f "${SCRIPT_LOCAL}" ]]; then
  echo "Missing ${SCRIPT_LOCAL}" >&2
  exit 1
fi

POD="$(kubectl -n "${NAMESPACE}" get pod -l app=backend -o jsonpath='{.items[0].metadata.name}')"
if [[ -z "${POD}" ]]; then
  echo "No backend pod in namespace ${NAMESPACE}" >&2
  exit 1
fi

REMOTE="/tmp/seed_dev_fake_patients.py"
echo "Copying seed script to ${NAMESPACE}/${POD}:${REMOTE}"
kubectl cp "${SCRIPT_LOCAL}" "${NAMESPACE}/${POD}:${REMOTE}"

echo "Running seed in backend pod (model + S3 from cluster env)…"
kubectl exec -n "${NAMESPACE}" "${POD}" -- python "${REMOTE}" --clear "$@"
