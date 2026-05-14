# PostgreSQL Security Incident Runbook

This runbook standardizes the four operational phases:
- `forensics`
- `containment`
- `credential-rotate`
- `verify`

## 1) Forensics (preserve evidence first)

1. Create a case ID (example: `2026-05-15-ransomware-incident`).
2. Collect artifacts:

```bash
./ops/security/collect_forensics.sh 2026-05-15-ransomware-incident
```

3. Do not delete suspicious roles or ransom-note databases until artifacts and hashes are saved.

## 2) Containment

1. Ensure PostgreSQL is not publicly exposed (`127.0.0.1:5432` bind default).
2. Confirm no unknown direct DB clients should connect from public networks.
3. If emergency containment is needed, stop backend write traffic before schema-level cleanup.

## 3) Credential Rotation + Cleanup

1. Rotate `postgres` password and sync:
   - root `.env` key `PDCARE_POSTGRES_PASSWORD`
   - root `.env` key `PDCARE_DATABASE_URL`
2. Apply SQL cleanup (after forensics):
   - drop suspicious login roles
   - remove ransom-note database/table
3. Recreate services:

```bash
docker compose up -d postgres backend
```

## 4) Verify

1. Service health:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

2. Security baseline check:

```bash
./ops/security/postgres_audit.sh
```

3. Backend DB connectivity check:

```bash
set -a && . ./.env && set +a
docker run --rm --network pd-care_default -e PGPASSWORD="$PDCARE_POSTGRES_PASSWORD" \
  postgres:16-alpine psql -h pd-care-postgres-1 -U postgres -d pd_care -c 'select 1;'
```

## Recurring Maintenance

- Run `./ops/security/postgres_audit.sh` weekly.
- Keep DB credentials out of source control and rotate on incident or credential leakage suspicion.
- Re-run `collect_forensics.sh` on every suspicious event before cleanup.
