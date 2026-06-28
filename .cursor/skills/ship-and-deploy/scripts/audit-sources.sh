#!/usr/bin/env bash
# Audit ship-and-deploy skill drift against MANIFEST.json sources.
# Usage: .cursor/skills/ship-and-deploy/scripts/audit-sources.sh [--strict]
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/../../../.." rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel)"
SKILL_DIR="$ROOT/.cursor/skills/ship-and-deploy"
MANIFEST="$SKILL_DIR/MANIFEST.json"
STRICT=false

if [[ "${1:-}" == "--strict" ]]; then
  STRICT=true
fi

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: manifest not found at $MANIFEST" >&2
  exit 2
fi

python3 - "$ROOT" "$MANIFEST" "$STRICT" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
strict = sys.argv[3] == "True"

manifest = json.loads(manifest_path.read_text())
skill = manifest.get("skill", "unknown")
version = manifest.get("version", "?")
last_audited = manifest.get("last_audited_commit", "")
sources = manifest.get("sources", [])

def git(*args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()

def commit_exists(ref: str) -> bool:
    if not ref:
        return False
    proc = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--verify", ref],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0

print(f"Auditing skill: {skill} v{version}")
print(f"Last audited commit: {last_audited or '(unset)'}")
print()

missing = []
changed_after_audit = []

for entry in sources:
    rel = entry["path"]
    path = root / rel
    if not path.is_file():
        missing.append(rel)
        print(f"MISSING  {rel}")
        continue

    head_hash = git("log", "-1", "--format=%H", "--", rel)
    head_subject = git("log", "-1", "--format=%s", "--", rel)

    if not last_audited or not commit_exists(last_audited):
        print(f"WARN     {rel} — cannot compare (invalid last_audited_commit)")
        continue

    # True if this file's latest commit is NOT an ancestor of last_audited
    # i.e. file changed after the audited commit
    proc = subprocess.run(
        [
            "git", "-C", str(root), "merge-base", "--is-ancestor",
            head_hash, last_audited,
        ],
        capture_output=True,
    )
    is_ancestor = proc.returncode == 0

    if is_ancestor:
        print(f"OK       {rel}  ({head_hash[:8]} {head_subject})")
    else:
        changed_after_audit.append(rel)
        print(f"STALE    {rel}  ({head_hash[:8]} {head_subject})")

print()
if missing:
    print(f"ERROR: {len(missing)} manifest source(s) missing.")
    sys.exit(2)

if changed_after_audit:
    print("Drift detected — update the skill before shipping:")
    for rel in changed_after_audit:
        print(f"  - {rel}")
    print()
    print("Required updates:")
    print("  1. Refresh SKILL.md / reference.md sections")
    print("  2. Bump MANIFEST.json last_audited_commit (+ version if behavior changed)")
    print("  3. Append CHANGELOG.md entry")
    sys.exit(1)

print("No drift detected. Skill audit is current.")
PY
