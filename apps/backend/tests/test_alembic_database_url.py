from __future__ import annotations

from app.db.migrations import resolve_alembic_database_url


SQLITE_INI = "sqlite+pysqlite:///./pd_care.db"
POSTGRES_ENV = "postgresql+psycopg://postgres:secret@postgres:5432/pd_care"


def test_env_database_url_wins_over_ini_sqlite() -> None:
    resolved = resolve_alembic_database_url(
        configured=SQLITE_INI,
        environ={"DATABASE_URL": POSTGRES_ENV},
    )
    assert resolved == POSTGRES_ENV


def test_alembic_database_url_wins_over_database_url_and_ini() -> None:
    resolved = resolve_alembic_database_url(
        configured=SQLITE_INI,
        environ={
            "DATABASE_URL": POSTGRES_ENV,
            "ALEMBIC_DATABASE_URL": "postgresql+psycopg://override:x@db:5432/override",
        },
    )
    assert resolved == "postgresql+psycopg://override:x@db:5432/override"


def test_falls_back_to_configured_ini_when_env_unset() -> None:
    resolved = resolve_alembic_database_url(
        configured=SQLITE_INI,
        environ={},
    )
    assert resolved == SQLITE_INI


def test_blank_env_database_url_falls_back_to_ini() -> None:
    resolved = resolve_alembic_database_url(
        configured=SQLITE_INI,
        environ={"DATABASE_URL": "  ", "ALEMBIC_DATABASE_URL": ""},
    )
    assert resolved == SQLITE_INI


def test_falls_back_to_settings_when_env_and_config_unset() -> None:
    resolved = resolve_alembic_database_url(
        configured=None,
        environ={},
        settings_database_url="sqlite+pysqlite:////tmp/settings.db",
    )
    assert resolved == "sqlite+pysqlite:////tmp/settings.db"
