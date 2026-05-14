# Incident Timeline (UTC)

## Scope
- Source logs: `artifacts/postgres_logs_historical_snapshot.log`
- Service snapshots: `artifacts/docker_ps_snapshot.txt`
- DB state snapshots: `artifacts/db_list.txt`, `artifacts/roles_and_privileges.txt`

## Timeline
- `2026-05-14 00:00:08` First repeated healthcheck-level symptom appears: `database "pd_care" does not exist`.
- `2026-05-14 01:49:09` First protocol-probe style event appears: `unsupported frontend protocol`.
- `2026-05-14 01:49:10` `no PostgreSQL user name specified in startup packet` begins appearing.
- `2026-05-14 05:54:08` First explicit password attack signal: `password authentication failed for user "postgres"` and `scram-sha-256` rule match.
- `2026-05-14 07:00-13:30` Repeated mixed probing and failed auth events continue.
- `2026-05-14 16:08` Backend startup failure event window #1 (auth failure + `pd_care` missing).
- `2026-05-14 16:13` Backend startup failure event window #2 (same symptom chain).
- `2026-05-15 00:xx` Live triage confirms:
  - ransomware note DB/table present (`readme_to_recover.readme`)
  - unauthorized superuser login roles present (`pgg_superadmins`, `priv_esc`)
  - backend failed auth path reproducible before recovery.

## Findings
- Incident pattern is consistent with public Postgres exposure + automated ransomware/scanner exploitation.
- Service crash windows align with compromised DB state plus credential drift effects after restarts.
- Evidence supports successful compromise, not just opportunistic scans.
