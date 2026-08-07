---
name: stage-commit-push
description: >-
  Stage, commit, and push PD Care changes on ruby0322's behalf
  (ruby0322 <ruby0322@ntu.im>). Commits atomically by default (one logical
  change per commit). Use when the user asks to stage, commit, push, ship code
  without deploy, or push on their behalf. Does not redeploy services.
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
Inspect → Plan units → (Stage → Commit)* → Push → Report
```

**Default: atomic commits** — one logical, reviewable change per commit. Push once after all commits unless the user asked to stop after commit.

```text
Progress:
- [ ] Inspect git state (status, diff, log, branch/upstream)
- [ ] Plan commit units (see Atomic commits below)
- [ ] Verify author identity
- [ ] For each unit: stage only its paths → commit with HEREDOC message
- [ ] Confirm working tree clean (or report intentional leftovers)
- [ ] Push to remote
- [ ] Report all commit hashes, branch, author, push result
- [ ] If branch is not `main`/`master`, include pre-filled PR creation URL
```

### Atomic commits (default)

Unless the user asks for a **single commit** (see overrides below), split the working tree into **commit units** — each unit is one concern that could stand alone in review history.

| One unit | Examples |
| --- | --- |
| Feature slice | backend endpoint + schema for that endpoint |
| Bug fix | isolated fix + its regression test |
| Test-only follow-up | CI mock/fix when tests were broken separately from the feature |
| Refactor / perf | typing cleanup, query optimization without behavior change |
| Docs / skill | documentation or agent skill updates only |

**Plan before staging.** After inspect, list the intended units (paths + summary) in the agent response, then commit them **in dependency order** (e.g. shared backend helper → API route → frontend consumer → test fix).

**Per unit:**

1. `git add <only this unit's paths>`
2. Commit with a focused HEREDOC message (`type(scope): …`, **why** in body)
3. If `pre-commit` modifies files, include hook fixes in **that same unit** before moving on
4. Repeat until all intended changes are committed

**Do not** leave unrelated hunks unstaged across cycles unless the user asked to commit only part of the work.

**Single-commit overrides** — use one commit for everything when the user says e.g. "single commit", "one commit", "don't split", or "squash into one commit". Then stage all intended paths once and commit once.

See [reference.md](reference.md) for unit-splitting examples.

## Step 1 — Inspect (parallel)

```bash
git status --short
git diff && git diff --staged
git log -5 --oneline
git status -sb
```

Analyze all changes. Match recent commit style (`feat(scope):`, `fix(scope):`, `refactor(scope):`).

If not using a single-commit override, write out the planned commit units before staging.

## Step 2 — Stage and commit (repeat per unit)

```bash
git add <paths-for-this-unit>
```

Stage only files for **the current unit**. Exclude secret files; warn if the user asked to commit sensitive paths.

## Step 3 — Commit (each unit)

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
- Confirm author on new commits (e.g. `git log -n <count> --format='%h %an <%ae> %s'` since push baseline)

## Step 5 — Report

Return:

- all commit hashes and messages (numbered, in order)
- author (`ruby0322 <ruby0322@ntu.im>`)
- branch and remote push result
- any hook warnings
- explicit note that deploy was **not** run (offer [ship-and-deploy](../ship-and-deploy/SKILL.md) if the user also wants redeploy)

### PR creation URL (non-`main` branches)

**Always** include a pre-filled GitHub PR URL when the pushed branch is not `main` or `master`.

1. Derive `owner/repo` from `git remote get-url origin` (SSH or HTTPS).
2. Use default base branch `main` (or `origin/HEAD` if it points elsewhere).
3. **Title:** latest commit subject when one commit; otherwise a branch-level title covering the series (`git log -1 --format='%s'` or a synthesized summary).
4. **Body:** `## Summary` bullets from **all commits in the push** + `## Test plan` checklist.
5. Build the compare URL (URL-encode `title` and `body`):

   ```text
   https://github.com/{owner}/{repo}/compare/{base}...{head}?quick_pull=1&title={title}&body={body}
   ```

   Example encoder:

   ```bash
   python3 -c "
   import urllib.parse
   title = 'feat(admin): short summary'
   body = '''## Summary
   - bullet one

   ## Test plan
   - [ ] verification step'''
   base, head = 'main', 'feat/my-branch'
   print(f'https://github.com/OWNER/REPO/compare/{base}...{head}?quick_pull=1'
         f'&title={urllib.parse.quote(title)}&body={urllib.parse.quote(body)}')
   "
   ```

Return the URL as a clickable markdown link plus the plain title and body so the user can edit before opening.

## Partial requests

| User request | Steps |
| --- | --- |
| "stage and commit" | Inspect → plan units → atomic commits → report (no push) |
| "commit and push" / "push on my behalf" | Full workflow (atomic by default) |
| "stage, commit, push" | Full workflow (atomic by default) |
| "single commit" / "one commit" / "don't split" | Inspect → stage all → one commit → push → report |
| "ship / deploy / redeploy" | Use [ship-and-deploy](../ship-and-deploy/SKILL.md) instead |

## Additional resources

- [reference.md](reference.md) — hooks, commit patterns, forbidden actions
- [ship-and-deploy/SKILL.md](../ship-and-deploy/SKILL.md) — deploy after push
