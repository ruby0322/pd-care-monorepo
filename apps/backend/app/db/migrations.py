from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from alembic import command
from alembic.config import Config


def resolve_alembic_database_url(
    *,
    configured: str | None = None,
    environ: Mapping[str, str] | None = None,
    settings_database_url: str | None = None,
) -> str:
    """Resolve DB URL for Alembic CLI / env.py.

    Priority: ALEMBIC_DATABASE_URL or DATABASE_URL env, then alembic config/ini URL,
    then app settings. Env must win so K8s migrate Jobs hit Postgres even when
    alembic.ini still lists a local SQLite default.
    """
    env = os.environ if environ is None else environ
    explicit = env.get("ALEMBIC_DATABASE_URL") or env.get("DATABASE_URL")
    if explicit:
        return explicit
    if configured:
        return configured
    if settings_database_url is not None:
        return settings_database_url
    from app.config import get_settings

    return get_settings().database_url


def _alembic_config(database_url: str) -> Config:
    backend_root = Path(__file__).resolve().parents[2]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def upgrade_database(database_url: str, revision: str = "head") -> None:
    """Run Alembic migrations up to target revision."""
    command.upgrade(_alembic_config(database_url), revision)
