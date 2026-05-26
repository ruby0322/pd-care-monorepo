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

    print("Migration policy check passed: no destructive patterns detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
