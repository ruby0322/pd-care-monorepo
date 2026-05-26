from __future__ import annotations

from sqlalchemy.engine import Engine
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.db.models import (
    LiffIdentity,
)
from app.db.session import create_engine_from_url, create_session_factory, ensure_postgres_database_exists, ping_database


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


def _promote_single_ruby_admin(session_factory: sessionmaker) -> None:
    with session_factory() as session:
        identity_count = session.execute(text("SELECT COUNT(*) FROM liff_identities")).scalar_one()
        if int(identity_count) != 1:
            return

        ruby_line_user_id = session.execute(
            text("SELECT line_user_id FROM liff_identities WHERE display_name = :display_name LIMIT 1"),
            {"display_name": "Ruby"},
        ).scalar_one_or_none()
        if not ruby_line_user_id:
            return

        identity = (
            session.query(LiffIdentity).filter(LiffIdentity.line_user_id == str(ruby_line_user_id)).one_or_none()
        )
        if identity is None:
            return
        if identity.role == "admin" and identity.is_active:
            return

        identity.role = "admin"
        identity.is_active = True
        session.commit()


def initialize_database(database_url: str, settings: Settings | None = None) -> tuple[Engine, sessionmaker]:
    ensure_postgres_database_exists(database_url)
    engine = create_engine_from_url(database_url)
    ping_database(engine)
    session_factory = create_session_factory(engine)
    if settings is not None:
        _seed_pilot_identities(session_factory, settings)
        if not settings.pilot_admin_identity_ids and not settings.pilot_staff_identity_ids:
            _promote_single_ruby_admin(session_factory)
    return engine, session_factory
