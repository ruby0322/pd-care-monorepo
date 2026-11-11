from __future__ import annotations

import atexit
import shutil
import tempfile
from pathlib import Path

from app.db.migrations import upgrade_database

# One migrated-but-empty database per process, copied for each test that asks for one.
#
# The chain is deterministic, so running it ~170 times a suite produces identical files at
# ~38ms each; copying one is ~0.1ms and byte-identical, `alembic_version` row included.
#
# The template lives in its own directory precisely because no test may ever write to it:
# the first version of this used the first caller's database as the template, which handed
# every later test the first test's rows. Tests that mean to exercise the migrations
# themselves call `upgrade_database` directly (see `test_db.py`) and bypass this entirely.
_TEMPLATE_DIR = Path(tempfile.mkdtemp(prefix="pdcare-schema-template-"))
_TEMPLATE = _TEMPLATE_DIR / "schema.db"

atexit.register(shutil.rmtree, _TEMPLATE_DIR, True)


def migrated_sqlite_database_url(db_path: Path) -> str:
    """A SQLite URL for a freshly migrated, empty database at `db_path`."""
    if not _TEMPLATE.exists():
        upgrade_database(f"sqlite+pysqlite:///{_TEMPLATE}")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(_TEMPLATE, db_path)
    return f"sqlite+pysqlite:///{db_path}"
