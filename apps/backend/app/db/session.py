from __future__ import annotations

from contextlib import nullcontext

import psycopg
from psycopg import sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import Session, sessionmaker


def create_engine_from_url(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, future=True, pool_pre_ping=True, connect_args=connect_args)


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def ping_database(engine: Engine) -> bool:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True


def ensure_postgres_database_exists(database_url: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() not in {"postgresql", "postgresql+psycopg"}:
        return

    target_database = url.database
    if not target_database:
        return

    connect_kwargs = {
        "host": url.host,
        "port": url.port,
        "user": url.username,
        "password": url.password,
        "dbname": "postgres",
    }
    with psycopg.connect(autocommit=True, **connect_kwargs) as connection:
        cursor_context = connection.cursor() if hasattr(connection, "cursor") else nullcontext()
        with cursor_context as cursor:
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_database,))
            exists = cursor.fetchone() is not None
            if not exists:
                cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target_database)))
