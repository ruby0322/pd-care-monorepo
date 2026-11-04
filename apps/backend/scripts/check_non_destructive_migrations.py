#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "migrations" / "versions"
ALLOW_MARKER = "allow-destructive-migration"

# Keep this conservative and simple; reviewers can allowlist intentionally destructive migrations explicitly.
DESTRUCTIVE_PATTERNS = [
    re.compile(r"\bdrop_table\s*\(", re.IGNORECASE),
    re.compile(r"\bdrop_column\s*\(", re.IGNORECASE),
    re.compile(r"\bdrop_index\s*\(", re.IGNORECASE),
    re.compile(r"\btruncate\b", re.IGNORECASE),
    re.compile(r"\bdelete\s+from\b", re.IGNORECASE),
    re.compile(r"\balter\s+table\b.*\bdrop\s+column\b", re.IGNORECASE),
]


def _is_python_file(path: Path) -> bool:
    return path.is_file() and path.suffix == ".py" and path.name != "__init__.py"


REVISION_RE = re.compile(r"^revision\s*=\s*[\"']([^\"']+)[\"']", re.MULTILINE)
DOWN_REVISION_RE = re.compile(r"^down_revision\s*=\s*(?:[\"']([^\"']+)[\"']|None)", re.MULTILINE)


def check_single_head() -> list[str]:
    """Reject more than one migration head.

    Two branches that each add a migration off the same parent merge cleanly in git but
    leave Alembic with sibling heads, and every test that runs `upgrade head` then fails
    with "Multiple head revisions are present". That only shows up once the branches are
    merged, so catch it here instead of in a merge-queue run.
    """
    revisions: dict[str, Path] = {}
    parents: dict[str, str | None] = {}

    for path in sorted(VERSIONS_DIR.iterdir()):
        if not _is_python_file(path):
            continue
        text = path.read_text(encoding="utf-8")
        match = REVISION_RE.search(text)
        if match is None:
            continue
        revision = match.group(1)
        if revision in revisions:
            return [f"duplicate revision id {revision!r} in {path} and {revisions[revision]}"]
        revisions[revision] = path
        down_match = DOWN_REVISION_RE.search(text)
        parents[revision] = down_match.group(1) if down_match else None

    if not revisions:
        return []

    referenced = {parent for parent in parents.values() if parent is not None}
    heads = sorted(revision for revision in revisions if revision not in referenced)
    problems: list[str] = []

    if len(heads) > 1:
        problems.append("Multiple migration heads detected: " + ", ".join(heads))
        for head in heads:
            problems.append(f"  - {head}  ({revisions[head].name})")
        problems.append(
            "  Re-point the newer migration's down_revision at the other head so the chain stays linear."
        )

    for revision, parent in parents.items():
        if parent is not None and parent not in revisions:
            problems.append(f"Revision {revision!r} points at unknown down_revision {parent!r}")

    return problems


def main() -> int:
    if not VERSIONS_DIR.exists():
        print(f"No migrations directory found at: {VERSIONS_DIR}")
        return 0

    violations: list[tuple[Path, str]] = []

    for path in sorted(VERSIONS_DIR.iterdir()):
        if not _is_python_file(path):
            continue
        text = path.read_text(encoding="utf-8")
        if ALLOW_MARKER in text:
            continue
        for pattern in DESTRUCTIVE_PATTERNS:
            if pattern.search(text):
                violations.append((path, pattern.pattern))
                break

    if violations:
        print("Destructive migration pattern(s) detected. Add explicit approval marker if intentional:")
        for path, pattern in violations:
            print(f" - {path}: matched /{pattern}/")
        print(f"\nTo override for an approved migration, include marker: {ALLOW_MARKER}")
        return 1

    head_problems = check_single_head()
    if head_problems:
        print("Migration graph check failed:")
        for problem in head_problems:
            print(f" {problem}")
        return 1

    print("Migration policy check passed: no destructive patterns detected; single head.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
