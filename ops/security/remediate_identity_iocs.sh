#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:-pd-care-postgres-1}"
MODE="${2:---dry-run}"

if [[ "$MODE" != "--dry-run" && "$MODE" != "--apply" ]]; then
  echo "usage: $0 [postgres-container-name] [--dry-run|--apply]" >&2
  exit 1
fi

echo "[identity-remediation] container=${CONTAINER_NAME}"
echo "[identity-remediation] mode=${MODE}"
echo "[identity-remediation] started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

SUMMARY_SQL="
WITH suspicious AS (
  SELECT id
  FROM liff_identities
  WHERE patient_id IS NULL
    AND role = 'patient'
    AND line_user_id !~ '^U[0-9a-fA-F]{32}$'
)
SELECT
  (SELECT count(*) FROM suspicious) AS suspicious_identities,
  (SELECT count(*) FROM healthcare_access_requests har WHERE har.requester_identity_id IN (SELECT id FROM suspicious) AND har.status = 'pending') AS pending_access_requests,
  (SELECT count(*) FROM pending_bindings pb WHERE pb.line_user_id IN (SELECT li.line_user_id FROM liff_identities li JOIN suspicious s ON s.id = li.id) AND pb.status = 'pending') AS pending_bindings;
"

echo "== Current IOC summary =="
docker exec "$CONTAINER_NAME" sh -lc "psql -U postgres -d pd_care -P pager=off -c \"$SUMMARY_SQL\""
echo

echo "== Sample suspicious identities (latest 20) =="
docker exec "$CONTAINER_NAME" sh -lc \
  "psql -U postgres -d pd_care -P pager=off -c \"SELECT id, line_user_id, is_active, created_at FROM liff_identities WHERE patient_id IS NULL AND role='patient' AND line_user_id !~ '^U[0-9a-fA-F]{32}$' ORDER BY created_at DESC LIMIT 20;\""
echo

if [[ "$MODE" == "--dry-run" ]]; then
  echo "[identity-remediation] dry-run complete (no data changed)"
  exit 0
fi

echo "== Applying remediation updates =="
docker exec "$CONTAINER_NAME" sh -lc "
psql -v ON_ERROR_STOP=1 -U postgres -d pd_care <<'SQL'
BEGIN;

WITH suspicious AS (
  SELECT id
  FROM liff_identities
  WHERE patient_id IS NULL
    AND role = 'patient'
    AND line_user_id !~ '^U[0-9a-fA-F]{32}$'
),
reject_requests AS (
  UPDATE healthcare_access_requests har
  SET status = 'rejected',
      reject_reason = COALESCE(har.reject_reason, 'auto-rejected: security remediation (invalid LINE subject format)'),
      decision_role = NULL,
      decided_at = COALESCE(har.decided_at, now())
  WHERE har.requester_identity_id IN (SELECT id FROM suspicious)
    AND har.status = 'pending'
  RETURNING har.id
),
deactivate_identity AS (
  UPDATE liff_identities li
  SET is_active = FALSE
  WHERE li.id IN (SELECT id FROM suspicious)
  RETURNING li.id
)
SELECT
  (SELECT count(*) FROM reject_requests) AS rejected_access_requests,
  (SELECT count(*) FROM deactivate_identity) AS deactivated_identities;

COMMIT;
SQL
"
echo

echo "== Post-remediation summary =="
docker exec "$CONTAINER_NAME" sh -lc "psql -U postgres -d pd_care -P pager=off -c \"$SUMMARY_SQL\""
echo
echo "[identity-remediation] completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
