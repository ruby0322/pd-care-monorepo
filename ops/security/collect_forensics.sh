#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <case-id> [postgres-container-name]"
  exit 1
fi

CASE_ID="$1"
CONTAINER_NAME="${2:-pd-care-postgres-1}"
ROOT_DIR="ops/security/forensics/${CASE_ID}"
ARTIFACT_DIR="${ROOT_DIR}/artifacts"

mkdir -p "${ARTIFACT_DIR}" "${ROOT_DIR}/reports"

echo "[forensics] collecting into ${ROOT_DIR}"

docker logs --since 48h "${CONTAINER_NAME}" > "${ARTIFACT_DIR}/postgres_logs_last_48h.log" 2>&1
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' > "${ARTIFACT_DIR}/docker_ps_snapshot.txt"
docker inspect "${CONTAINER_NAME}" > "${ARTIFACT_DIR}/postgres_container_inspect.json"

docker exec "${CONTAINER_NAME}" sh -lc \
  "psql -U postgres -d postgres -Atc \"select datname from pg_database order by datname;\"" \
  > "${ARTIFACT_DIR}/db_list.txt"

docker exec "${CONTAINER_NAME}" sh -lc \
  "psql -U postgres -d postgres -Atc \"select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin from pg_roles order by rolname;\"" \
  > "${ARTIFACT_DIR}/roles_and_privileges.txt"

docker exec "${CONTAINER_NAME}" sh -lc \
  "psql -U postgres -d postgres -c \"select datname, pg_catalog.pg_get_userbyid(datdba) as owner from pg_database order by datname;\"" \
  > "${ARTIFACT_DIR}/db_owner_snapshot.txt"

(
  cd "${ROOT_DIR}"
  sha256sum $(find . -type f ! -name SHA256SUMS.txt | sort) > SHA256SUMS.txt
)

echo "[forensics] done"
