# GitOps Rollback Runbook (Argo CD)

This runbook defines rollback via Git revert and Argo CD reconciliation.

## Trigger Conditions

- Elevated 5xx error rate after production deploy
- Sustained latency regression beyond SLO
- Functional regression confirmed by on-call

## Rollback Procedure

1. Identify bad deploy commit on `main`
2. Revert commit on `main` (PR-based revert preferred)
3. Merge revert PR
4. Confirm Argo CD auto-sync starts for `pd-care-prod`
5. Verify deployment and health checks

## Commands (Reference)

```bash
git checkout main
git pull
git revert <bad_commit_sha>
git push origin main
```

If branch protection blocks direct push, use PR-based revert:

```bash
git checkout -b rollback/<incident-id>
git revert <bad_commit_sha>
git push -u origin rollback/<incident-id>
```

## Verification Checklist

- Argo CD app `pd-care-prod` reaches `Synced` and `Healthy`
- Deployment rollout succeeds (`maxUnavailable=0` respected)
- `/healthz` and `/readyz` healthy
- 5xx and latency metrics return to baseline

## Post-Incident

- Document root cause
- Add prevention action item (test, policy, or guardrail)
- Review whether canary strategy should be introduced
