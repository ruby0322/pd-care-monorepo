# Incident IOC Summary

## Evidence sources
- `postgres_logs_historical_snapshot.log` (4907 lines)
- `postgres_logs_2026-05-14_to_now.log` (11 lines)

## Confirmed suspicious indicators
- Ransom-note style database/table present: `readme_to_recover.readme`.
- Unexpected superuser login roles present: `pgg_superadmins`, `priv_esc`.
- High-volume auth failures and protocol-probe traffic found in PostgreSQL logs.

## Event counts
- auth_failed: 79
- db_missing: 4473
- proto_bad: 10
- no_user: 5
- scram_line: 84
- readme_db: 0

## First / Last seen
- auth_failed: first=`2026-05-14 05:54:08.511 UTC [5210] FATAL:  password authentication failed for user "postgres"` | last=`2026-05-14 16:16:44.990 UTC [25820] FATAL:  password authentication failed for user "postgres"`
- db_missing: first=`2026-05-14 00:00:08.737 UTC [38779] FATAL:  database "pd_care" does not exist` | last=`2026-05-14 16:16:47.220 UTC [25827] FATAL:  database "pd_care" does not exist`
- proto_bad: first=`2026-05-14 01:49:09.781 UTC [43798] FATAL:  unsupported frontend protocol 0.0: server supports 3.0 to 3.0` | last=`2026-05-14 13:30:29.583 UTC [18152] FATAL:  unsupported frontend protocol 255.255: server supports 3.0 to 3.0`
- no_user: first=`2026-05-14 01:49:10.627 UTC [43800] FATAL:  no PostgreSQL user name specified in startup packet` | last=`2026-05-14 13:30:30.047 UTC [18153] FATAL:  no PostgreSQL user name specified in startup packet`
- scram_line: first=`2026-05-14 05:54:08.511 UTC [5210] DETAIL:  Connection matched file "/var/lib/postgresql/data/pg_hba.conf" line 128: "host all all all scram-sha-256"` | last=`2026-05-14 16:16:44.990 UTC [25820] DETAIL:  Connection matched file "/var/lib/postgresql/data/pg_hba.conf" line 128: "host all all all scram-sha-256"`
- readme_db: first=`N/A` | last=`N/A`

## Top hours (UTC)
### auth_failed
- 2026-05-14 16:00 -> 44
- 2026-05-14 12:00 -> 19
- 2026-05-14 07:00 -> 13
- 2026-05-14 06:00 -> 2
- 2026-05-14 05:00 -> 1
### db_missing
- 2026-05-14 09:00 -> 372
- 2026-05-14 03:00 -> 360
- 2026-05-14 01:00 -> 359
- 2026-05-14 11:00 -> 359
- 2026-05-14 00:00 -> 358
- 2026-05-14 02:00 -> 358
- 2026-05-14 10:00 -> 358
- 2026-05-14 12:00 -> 358
### proto_bad
- 2026-05-14 01:00 -> 2
- 2026-05-14 07:00 -> 2
- 2026-05-14 10:00 -> 2
- 2026-05-14 12:00 -> 2
- 2026-05-14 13:00 -> 2
### no_user
- 2026-05-14 01:00 -> 1
- 2026-05-14 07:00 -> 1
- 2026-05-14 10:00 -> 1
- 2026-05-14 12:00 -> 1
- 2026-05-14 13:00 -> 1
### scram_line
- 2026-05-14 16:00 -> 44
- 2026-05-14 12:00 -> 19
- 2026-05-14 07:00 -> 13
- 2026-05-14 06:00 -> 2
- 2026-05-14 05:00 -> 1
### readme_db
- none

## Suspicious roles evidence
- `pgg_superadmins|t|f|f|t`
- `priv_esc|t|f|f|t`

## Initial assessment
- Pattern matches automated internet-exposed PostgreSQL ransomware/scanner activity.
- `readme_to_recover` and unauthorized superuser roles indicate successful compromise, not only failed scans.
- Recurrent service failures align with credential drift plus hostile modifications during exposure window.
