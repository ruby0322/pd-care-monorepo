from __future__ import annotations

from pathlib import Path

from app.db.migrations import upgrade_database


def migrated_sqlite_database_url(db_path: Path) -> str:
    url = f"sqlite+pysqlite:///{db_path}"
    upgrade_database(url)
    return url
