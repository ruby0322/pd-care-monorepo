# Stage-commit-push reference

## Authorized identity

| Field | Value |
| --- | --- |
| Name | `ruby0322` |
| Email | `ruby0322@ntu.im` |

Commits pushed under this skill should show this author. Use `git log -1 --format='%an <%ae>'` to verify after commit.

## Git hooks (Husky)

| Hook | Command | When |
| --- | --- | --- |
| `pre-commit` | `npm run lint` | Every commit |
| `pre-push` | `npm run lint` | Every push |

`npm run lint` = frontend eslint + backend migration policy check.

## Commit message style

Recent examples from this repo:

- `feat(k8s): add prod zero-downtime rolling rollout`
- `fix(k8s): bake backend model artifacts and remove model-cache pvc`
- `docs: resolve Compose/K8s contradictions and ask-first deploy skill`

Format: `type(scope): imperative summary` with optional body explaining **why**.

## Files to never commit

- `.env`, `apps/backend/.env`
- `k8s/overlays/*/secret.yaml`
- credentials, tokens, API keys

## Forbidden without explicit user approval

| Action | Risk |
| --- | --- |
| `git push --force` to `main`/`master` | Rewrites shared history |
| `git commit --no-verify` | Skips lint and migration checks |
| `git config --global ...` | Changes identity for all repos |
| Committing secret files | Credential leak |

## New branch push

```bash
git push -u origin HEAD
```

## After push

Confirm clean tree or report remaining unstaged files:

```bash
git status --short
```
