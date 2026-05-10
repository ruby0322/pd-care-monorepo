from __future__ import annotations
# pyright: reportMissingImports=false

from pathlib import Path

from sqlalchemy import inspect, text

from app.db.base import Base
from app.db.models import (
    AIResult,
    Annotation,
    LiffIdentity,
    Notification,
    Patient,
    PendingBinding,
    StaffUser,
    Upload,
)
from app.db.session import create_engine_from_url, create_session_factory, ensure_postgres_database_exists, ping_database


def test_week1_schema_tables_can_be_created() -> None:
    engine = create_engine_from_url("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    table_names = set(inspect(engine).get_table_names())

    assert "staff_users" in table_names
    assert "patients" in table_names
    assert "liff_identities" in table_names
    assert "pending_bindings" in table_names
    assert "uploads" in table_names
    assert "ai_results" in table_names
    assert "notifications" in table_names
    assert "annotations" in table_names

    # Touch imported models to ensure SQLAlchemy mappers are fully configured.
    assert StaffUser.__tablename__ == "staff_users"
    assert Patient.__tablename__ == "patients"
    assert LiffIdentity.__tablename__ == "liff_identities"
    assert PendingBinding.__tablename__ == "pending_bindings"
    assert Upload.__tablename__ == "uploads"
    assert AIResult.__tablename__ == "ai_results"
    assert Notification.__tablename__ == "notifications"
    assert Annotation.__tablename__ == "annotations"


def test_session_factory_uses_isolated_sqlite_database(tmp_path: Path) -> None:
    db_file = tmp_path / "test.db"
    engine = create_engine_from_url(f"sqlite+pysqlite:///{db_file}")
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        result = session.execute(text("SELECT 1")).scalar_one()

    assert result == 1


def test_ping_database_returns_true_for_reachable_database() -> None:
    engine = create_engine_from_url("sqlite+pysqlite:///:memory:")
    assert ping_database(engine) is True


def test_ensure_postgres_database_exists_skips_non_postgres_url() -> None:
    ensure_postgres_database_exists("sqlite+pysqlite:///:memory:")


def test_ensure_postgres_database_exists_creates_missing_database(monkeypatch) -> None:
    executed_queries: list[tuple[object, tuple[object, ...] | None]] = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params=None):
            executed_queries.append((query, params))

        def fetchone(self):
            return None

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return FakeCursor()

    def fake_connect(*args, **kwargs):
        return FakeConnection()

    monkeypatch.setattr("app.db.session.psycopg.connect", fake_connect)
    ensure_postgres_database_exists("postgresql+psycopg://postgres:postgres@postgres:5432/pd_care")

    assert any("SELECT 1 FROM pg_database" in str(query) for query, _ in executed_queries)
    assert any("CREATE DATABASE" in str(query) for query, _ in executed_queries)
