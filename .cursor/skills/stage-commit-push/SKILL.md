---
name: stage-commit-push
description: >-
  Stage, commit, and push PD Care changes on ruby0322's behalf
  (ruby0322 <ruby0322@ntu.im>). Use when the user asks to stage, commit, push,
  ship code without deploy, or push on their behalf. Does not redeploy services.
---

# Stage, Commit, Push (PD Care)

Git-only workflow for shipping code to the remote. **No deploy** — use [ship-and-deploy](../ship-and-deploy/SKILL.md) when redeploy is also requested.

## Authorization

When this skill applies, the user has authorized the agent to:

- stage intended files
- create commits
- **push to the remote on their behalf** as **ruby0322** (`ruby0322@ntu.im`)

Proceed with push when the user asks to stage/commit/push (or equivalent). Do not wait for a second confirmation.

## Preconditions

- Verify repo git identity before committing:

  ```bash
  git config user.name
  git config user.email
  ```

  Expected: `ruby0322` and `ruby0322@ntu.im`. If wrong, set **local** config only:

  ```bash
  git config user.name "ruby0322"
  git config user.email "ruby0322@ntu.im"
  ```

- Never commit secrets (`.env`, `k8s/overlays/*/secret.yaml`, tokens, credentials).
- Never update global git config unless the user explicitly asks.
- Never skip hooks (`--no-verify`) unless the user explicitly requests it.
- Never force-push to `main`/`master` unless explicitly requested (warn first).
- Follow [AGENTS.md](../../../AGENTS.md) test policy: hooks run lint; do not run full tests unless the user asks or you are in final pre-push verification.

See [reference.md](reference.md) for hooks, commit style, and safety rules.

## Workflow

```text
Inspect → Stage → Commit → Push → Report
```

```text
Progress:
- [ ] Inspect git state (status, diff, log, branch/upstream)
- [ ] Stage intended files only
- [ ] Verify author identity
- [ ] Commit with HEREDOC message
- [ ] Push to remote
- [ ] Report hash, branch, author, push result
```

## Step 1 — Inspect (parallel)

```bash
git status --short
git diff && git diff --staged
git log -5 --oneline
git status -sb
```

Analyze all changes. Match recent commit style (`feat(scope):`, `fix(scope):`, `refactor(scope):`).

## Step 2 — Stage

```bash
git add <paths>
```

Stage only files for the requested change. Exclude secret files; warn if the user asked to commit sensitive paths.

## Step 3 — Commit

Use a HEREDOC message focused on **why**:

```bash
git commit -m "$(cat <<'EOF'
fix(scope): short summary

One or two sentences explaining intent.
EOF
)"
```

### Hook failures

- `pre-commit` runs `npm run lint`.
- If the hook modifies files, fix issues and create a **new** commit (do not amend unless all amend rules are satisfied).
- If commit is rejected, never amend a failed commit — fix and commit again.

## Step 4 — Push

```bash
git push
```

- `pre-push` also runs `npm run lint`.
- New branch: `git push -u origin HEAD`
- Confirm author on the new commit:

  ```bash
  git log -1 --format='%h %an <%ae> %s'
  ```

## Step 5 — Report

Return:

- commit hash and message
- author (`ruby0322 <ruby0322@ntu.im>`)
- branch and remote push result
- any hook warnings
- explicit note that deploy was **not** run (offer [ship-and-deploy](../ship-and-deploy/SKILL.md) if the user also wants redeploy)

## Partial requests

| User request | Steps |
| --- | --- |
| "stage and commit" | Inspect → stage → commit → report (no push) |
| "commit and push" / "push on my behalf" | Full workflow |
| "stage, commit, push" | Full workflow |
| "ship / deploy / redeploy" | Use [ship-and-deploy](../ship-and-deploy/SKILL.md) instead |

## Additional resources

- [reference.md](reference.md) — hooks, commit patterns, forbidden actions
- [ship-and-deploy/SKILL.md](../ship-and-deploy/SKILL.md) — deploy after push
