from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config


def _alembic_config(database_url: str) -> Config:
    backend_root = Path(__file__).resolve().parents[2]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def upgrade_database(database_url: str, revision: str = "head") -> None:
    """Run Alembic migrations up to target revision."""
    command.upgrade(_alembic_config(database_url), revision)
