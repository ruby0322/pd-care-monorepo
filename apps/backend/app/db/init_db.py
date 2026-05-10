from __future__ import annotations

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, PendingBinding, StaffUser, Upload
from app.db.session import create_engine_from_url, create_session_factory, ensure_postgres_database_exists, ping_database


def initialize_database(database_url: str) -> tuple[Engine, sessionmaker]:
    # Importing models above ensures metadata includes all week-1 tables.
    _ = (StaffUser, Patient, LiffIdentity, PendingBinding, Upload, AIResult, Notification, Annotation)
    ensure_postgres_database_exists(database_url)
    engine = create_engine_from_url(database_url)
    ping_database(engine)
    Base.metadata.create_all(bind=engine)
    return engine, create_session_factory(engine)
