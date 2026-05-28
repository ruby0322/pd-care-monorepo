# Branch Protection Checklist (GitOps)

Use this checklist to enforce `dev -> SIT` and `main -> PROD` safely.

## `dev` Branch

- Require pull request for merges
- Require at least 1 approval
- Require status checks to pass before merge
- Dismiss stale approvals on new commits
- Restrict force-push and branch deletion

## `main` Branch

- Require pull request for merges
- Require CODEOWNERS review (release/platform owners)
- Require all status checks before merge
- Require branch to be up to date before merge
- Restrict direct pushes (admins included if possible)
- Restrict force-push and branch deletion

## Required Checks (Recommended)

- Frontend lint (`npm run lint`)
- Backend migration safety check (`npm run check:migrations`)
- GitOps manifest validation (`helm template` dry-run in CI)

## Optional Hardening

- Add merge queue for `main`
- Add signed-commit requirement for `main`
- Add deployment freeze rules during sensitive windows
