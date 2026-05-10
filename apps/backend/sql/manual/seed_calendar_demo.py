#!/usr/bin/env python3
"""Inject calendar demo patient + uploads + AI rows (manual only; not run by app/tests).

Keeps the same data as patient_calendar_demo_seed.sql. Run from repo root or apps/backend:

    cd apps/backend && python sql/manual/seed_calendar_demo.py

Requires DATABASE_URL (loads apps/backend/.env when python-dotenv is installed).
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, PendingBinding, StaffUser, Upload
from app.db.session import create_engine_from_url, create_session_factory

LINE_USER_ID = "Ua330fd0f658e181bb850be04bdb20251"
CASE_NUMBER = "P-DEMO-CALENDAR-001"
BIRTH_DATE = "1985-06-15"
TZ = ZoneInfo("Asia/Taipei")

# (local wall time string, object_key, screening_result, predicted_class, probability)
_UPLOAD_ROWS: list[tuple[str, str, str, str, float]] = [
    ("2026-05-05 09:10:00", "patients/demo/uploads/2026-05-05-a1.jpg", "normal", "class_1", 0.08),
    ("2026-05-06 08:30:00", "patients/demo/uploads/2026-05-06-b1.jpg", "suspected", "class_4", 0.89),
    ("2026-05-06 20:10:00", "patients/demo/uploads/2026-05-06-b2.jpg", "normal", "class_1", 0.12),
    ("2026-05-08 07:45:00", "patients/demo/uploads/2026-05-08-c1.jpg", "normal", "class_1", 0.09),
    ("2026-05-08 12:30:00", "patients/demo/uploads/2026-05-08-c2.jpg", "normal", "class_2", 0.15),
    ("2026-05-08 21:00:00", "patients/demo/uploads/2026-05-08-c3.jpg", "normal", "class_0", 0.05),
]


def _ensure_schema(engine: Engine) -> None:
    """Create tables if missing (week-1 schema). No-op when tables already exist."""
    _ = (StaffUser, Patient, LiffIdentity, PendingBinding, Upload, AIResult, Notification, Annotation)
    Base.metadata.create_all(bind=engine)


def _parse_local_dt(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)


def _clear_demo(session: Session) -> None:
    pid = session.execute(
        select(Patient.id).where(Patient.case_number == CASE_NUMBER, Patient.birth_date == BIRTH_DATE)
    ).scalar_one_or_none()
    if pid is not None:
        upload_ids = select(Upload.id).where(Upload.patient_id == pid)
        session.execute(delete(AIResult).where(AIResult.upload_id.in_(upload_ids)))
        session.execute(delete(Upload).where(Upload.patient_id == pid))
        session.execute(delete(Patient).where(Patient.id == pid))
    session.execute(delete(LiffIdentity).where(LiffIdentity.line_user_id == LINE_USER_ID))
    session.execute(delete(PendingBinding).where(PendingBinding.line_user_id == LINE_USER_ID))


def _seed_demo(session: Session) -> None:
    patient = Patient(
        case_number=CASE_NUMBER,
        birth_date=BIRTH_DATE,
        full_name="Calendar Demo Patient",
        is_active=True,
    )
    session.add(patient)
    session.flush()

    session.add(
        LiffIdentity(
            line_user_id=LINE_USER_ID,
            display_name="Calendar Demo User",
            picture_url="https://example.com/calendar-demo-user.jpg",
            patient_id=patient.id,
        )
    )

    for local_ts, object_key, screening, pred_class, prob in _UPLOAD_ROWS:
        upload = Upload(
            patient_id=patient.id,
            object_key=object_key,
            content_type="image/jpeg",
            created_at=_parse_local_dt(local_ts),
        )
        session.add(upload)
        session.flush()
        session.add(
            AIResult(
                upload_id=upload.id,
                predicted_class=pred_class,
                probability=prob,
                threshold=0.50,
                screening_result=screening,
                model_version="demo-model-v1",
                error_reason=None,
            )
        )


def main() -> int:
    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env")

    # Prefer PDCARE_DATABASE_URL to avoid accidentally seeding local sqlite when docker
    # stacks use a dedicated compose variable namespace.
    database_url = os.getenv("PDCARE_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        print(
            "Neither PDCARE_DATABASE_URL nor DATABASE_URL is set. "
            "Set one of them or put it in apps/backend/.env",
            file=sys.stderr,
        )
        return 1

    print(f"Using database URL: {database_url}")
    engine = create_engine_from_url(database_url)
    _ensure_schema(engine)
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        try:
            _clear_demo(session)
            _seed_demo(session)
            session.commit()
        except Exception:
            session.rollback()
            raise

    print(f"Seeded demo patient {CASE_NUMBER} bound to LINE user {LINE_USER_ID}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
