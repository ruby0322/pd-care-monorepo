#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:-pd-care-postgres-1}"

echo "[audit] container=${CONTAINER_NAME}"
echo "[audit] started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "== Container port exposure =="
docker ps --format '{{.Names}} {{.Ports}}' | awk -v c="$CONTAINER_NAME" '$1==c {print}'
echo

echo "== Suspicious databases =="
docker exec "$CONTAINER_NAME" sh -lc \
  "psql -U postgres -d postgres -Atc \"select datname from pg_database where datname in ('readme_to_recover') order by datname;\""
echo

echo "== Suspicious roles =="
docker exec "$CONTAINER_NAME" sh -lc \
  "psql -U postgres -d postgres -Atc \"select rolname, rolsuper, rolcanlogin from pg_roles where rolname in ('pgg_superadmins','priv_esc') order by rolname;\""
echo

echo "== Recent auth/probe signals (last 24h) =="
docker logs --since 24h "$CONTAINER_NAME" 2>&1 | \
  awk '
    /password authentication failed for user "postgres"/ {auth++}
    /unsupported frontend protocol/ {proto++}
    /no PostgreSQL user name specified in startup packet/ {nouser++}
    END {
      printf("auth_failed=%d\n", auth+0);
      printf("proto_probe=%d\n", proto+0);
      printf("startup_packet_no_user=%d\n", nouser+0);
    }'
echo

echo "[audit] completed"
