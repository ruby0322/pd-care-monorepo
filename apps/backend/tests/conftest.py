from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.db.session import create_engine_from_url, create_session_factory
from tests.db_test_utils import migrated_sqlite_database_url


@pytest.fixture(autouse=True)
def _skip_storage_bucket_initialization(
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> None:
    if request.node.get_closest_marker("no_bucket_patch"):
        return
    monkeypatch.setattr("app.main.StorageService.ensure_bucket_exists", lambda _self: None)


@pytest.fixture
def db_session(tmp_path: Path) -> Iterator[Session]:
    """A migrated, per-test SQLite session for tests that talk to the ORM directly.

    Built the same way `test_copilot_api.py` builds its app's database: run the real
    Alembic chain against a temp file via `migrated_sqlite_database_url`, then open a
    session on it through the same `app.db.session` helpers the app uses at runtime.
    """
    database_url = migrated_sqlite_database_url(tmp_path / "db_session.db")
    engine = create_engine_from_url(database_url)
    session_factory = create_session_factory(engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()

