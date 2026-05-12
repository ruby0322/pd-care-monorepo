from __future__ import annotations

from sqlalchemy.engine import Engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.db.base import Base
from app.db.models import (
    AIResult,
    Annotation,
    AuthorizationAuditEvent,
    HealthcareAccessRequest,
    LiffIdentity,
    Notification,
    Patient,
    PendingBinding,
    StaffPatientAssignment,
    Upload,
)
from app.db.session import create_engine_from_url, create_session_factory, ensure_postgres_database_exists, ping_database


def _ensure_role_column(engine: Engine) -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("liff_identities")}
    if "role" in columns:
        return

    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE liff_identities ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'patient'")
        )


def _ensure_annotation_reviewer_column(engine: Engine) -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("annotations")}
    if "reviewer_identity_id" in columns:
        return
    if "staff_user_id" in columns:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "ALTER TABLE annotations "
                    "ADD COLUMN reviewer_identity_id INTEGER REFERENCES liff_identities(id)"
                )
            )


def _ensure_annotation_staff_user_nullable(engine: Engine) -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("annotations")}
    if "staff_user_id" not in columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE annotations ALTER COLUMN staff_user_id DROP NOT NULL"))


def _ensure_identity_is_active_column(engine: Engine) -> None:
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("liff_identities")}
    if "is_active" in columns:
        return
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE liff_identities ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1")
        )


def _seed_pilot_identities(session_factory: sessionmaker, settings: Settings) -> None:
    pilot_accounts = {identity_id: "staff" for identity_id in settings.pilot_staff_identity_ids}
    pilot_accounts.update({identity_id: "admin" for identity_id in settings.pilot_admin_identity_ids})
    if not pilot_accounts:
        return

    with session_factory() as session:
        existing_ids = {
            row[0]
            for row in session.query(LiffIdentity.line_user_id)
            .filter(LiffIdentity.line_user_id.in_(tuple(pilot_accounts.keys())))
            .all()
        }
        for identity_id, role in pilot_accounts.items():
            if identity_id in existing_ids:
                identity = (
                    session.query(LiffIdentity)
                    .filter(LiffIdentity.line_user_id == identity_id)
                    .one()
                )
                identity.role = role
                identity.is_active = True
                continue
            session.add(
                LiffIdentity(
                    line_user_id=identity_id,
                    display_name=identity_id,
                    picture_url=None,
                    patient_id=None,
                    role=role,
                    is_active=True,
                )
            )
        session.commit()


def initialize_database(database_url: str, settings: Settings | None = None) -> tuple[Engine, sessionmaker]:
    # Importing models above ensures metadata includes all week-1 tables.
    _ = (
        Patient,
        LiffIdentity,
        PendingBinding,
        StaffPatientAssignment,
        Upload,
        AIResult,
        Notification,
        Annotation,
        HealthcareAccessRequest,
        AuthorizationAuditEvent,
    )
    ensure_postgres_database_exists(database_url)
    engine = create_engine_from_url(database_url)
    ping_database(engine)
    Base.metadata.create_all(bind=engine)
    _ensure_role_column(engine)
    _ensure_annotation_reviewer_column(engine)
    _ensure_annotation_staff_user_nullable(engine)
    _ensure_identity_is_active_column(engine)
    session_factory = create_session_factory(engine)
    if settings is not None:
        _seed_pilot_identities(session_factory, settings)
    return engine, session_factory
