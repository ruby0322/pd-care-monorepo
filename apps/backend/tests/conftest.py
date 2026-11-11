from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.db.session import create_engine_from_url, create_session_factory
from tests.db_test_utils import migrated_sqlite_database_url


@event.listens_for(Engine, "connect")
def _unsafe_but_fast_sqlite_in_tests(dbapi_connection: object, _record: object) -> None:
    """Stop the suite paying for durability it does not want.

    Every test builds its own database and throws it away, so each `COMMIT` buys a crash
    guarantee for data that will not outlive the test -- and pays for it with an fsync. That
    is the suite's dominant cost, and it is a property of the host's disk rather than of
    anything the tests do: on one developer machine a single API test took 58s against the
    array and 3.4s doing identical work on tmpfs, burning the same ~3s of CPU either way.
    Turning the flushes off makes the suite's speed depend on the machine's CPU instead of
    its write latency, which is what keeps it predictable across laptops and CI.

    Registered on the `Engine` class, so it reaches every engine the tests build -- the app's
    own, the Alembic chain's, and `db_session`'s -- and only ever from `tests/`, so nothing
    in production is touched. Non-SQLite connections are left alone.
    """
    if type(dbapi_connection).__module__.split(".")[0] not in {"sqlite3", "pysqlite3"}:
        return
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA synchronous=OFF")
        cursor.execute("PRAGMA journal_mode=MEMORY")
    finally:
        cursor.close()


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

