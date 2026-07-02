# Project AI Skills

Cursor Agent Skills scoped to this repository. Each skill lives in its own directory with a required `SKILL.md`.

## Skills index

| Skill | Path | Use when |
| --- | --- | --- |
| Stage, Commit, Push | [stage-commit-push/SKILL.md](stage-commit-push/SKILL.md) | Stage/commit/push on ruby0322's behalf — no deploy |
| Ship & Deploy | [ship-and-deploy/SKILL.md](ship-and-deploy/SKILL.md) | Staging, committing, pushing, or redeploying — with production data safety and scoped redeploy |

## Maintenance policy

Skills that describe repo-specific workflows must stay aligned with canonical source files.

1. **Source of truth** — Each skill declares tracked files in `MANIFEST.json`.
2. **Drift detection** — Run the skill audit script after changing tracked files:

   ```bash
   .cursor/skills/ship-and-deploy/scripts/audit-sources.sh
   ```

3. **Update contract** — When editing files listed in a skill manifest, update the skill in the same PR:
   - Refresh `reference.md` facts that changed
   - Bump `MANIFEST.json` (`last_audited_commit`, `version` if behavior changed)
   - Append an entry to `CHANGELOG.md`
4. **Automation hint** — `.cursor/rules/maintain-ship-deploy-skill.mdc` reminds agents to run the audit when deploy/git hook files change.

## Adding a new skill

1. Create `.cursor/skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`).
2. Add a `MANIFEST.json` if the skill depends on repo files.
3. Register the skill in this README index table.
4. Optionally add a `.cursor/rules/maintain-<skill>-skill.mdc` rule with globs for tracked sources.
