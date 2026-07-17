#!/usr/bin/env python3
"""Seed elevated-only history-overview demo days for local manual QA.

Creates patients whose uploads are AI-normal + high-risk symptoms (pain/pus/cloudy),
with no AI suspected / risky annotations, so calendar days show orange-only heat.

Run from repo root or apps/backend:

    cd apps/backend && python sql/manual/seed_history_overview_elevated_demo.py

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

from app.db.migrations import upgrade_database
from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, Upload
from app.db.session import create_engine_from_url, create_session_factory

TZ = ZoneInfo("Asia/Taipei")
CASE_PREFIX = "P-HX-ELEV-"

# local wall time, case suffix, full_name, high-risk symptom flags, screening
# All screening_result=normal so days with only these rows are elevated-only (orange).
_UPLOAD_ROWS: list[tuple[str, str, str, dict[str, bool], str]] = [
    # 2026-07-14 — elevated-only day (2 patients)
    ("2026-07-14 09:10:00", "001", "Elevated Only A", {"symptom_pain": True}, "normal"),
    ("2026-07-14 14:20:00", "002", "Elevated Only B", {"symptom_pus": True}, "normal"),
    # 2026-07-15 — elevated-only day (1 patient, cloudy)
    ("2026-07-15 10:00:00", "003", "Elevated Cloudy", {"symptom_cloudy_dialysate": True}, "normal"),
    # 2026-07-16 — elevated-only day (3 patients)
    ("2026-07-16 08:30:00", "004", "Elevated Pain C", {"symptom_pain": True}, "normal"),
    ("2026-07-16 11:00:00", "005", "Elevated Pus D", {"symptom_pus": True}, "normal"),
    ("2026-07-16 13:15:00", "006", "Elevated Combo E", {"symptom_pain": True, "symptom_pus": True}, "normal"),
    # 2026-07-13 — contrast: one suspected so day is red (not orange-only)
    ("2026-07-13 09:00:00", "007", "Suspected Contrast", {}, "suspected"),
]


def _ensure_schema(engine: Engine) -> None:
    upgrade_database(str(engine.url))


def _parse_local_dt(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)


def _clear_demo(session: Session) -> None:
    patients = session.execute(select(Patient).where(Patient.case_number.like(f"{CASE_PREFIX}%"))).scalars().all()
    patient_ids = [p.id for p in patients]
    if not patient_ids:
        return
    upload_ids = list(session.execute(select(Upload.id).where(Upload.patient_id.in_(patient_ids))).scalars().all())
    if upload_ids:
        session.execute(delete(Annotation).where(Annotation.upload_id.in_(upload_ids)))
        session.execute(delete(Notification).where(Notification.upload_id.in_(upload_ids)))
        session.execute(delete(AIResult).where(AIResult.upload_id.in_(upload_ids)))
        session.execute(delete(Upload).where(Upload.id.in_(upload_ids)))
    session.execute(delete(LiffIdentity).where(LiffIdentity.patient_id.in_(patient_ids)))
    session.execute(delete(Patient).where(Patient.id.in_(patient_ids)))


def _seed_demo(session: Session) -> list[str]:
    patients_by_suffix: dict[str, Patient] = {}
    seeded_days: list[str] = []

    for local_ts, suffix, full_name, symptoms, screening in _UPLOAD_ROWS:
        case_number = f"{CASE_PREFIX}{suffix}"
        patient = patients_by_suffix.get(suffix)
        if patient is None:
            patient = Patient(
                case_number=case_number,
                birth_date="1975-03-15",
                full_name=full_name,
                gender="unknown",
                is_active=True,
            )
            session.add(patient)
            session.flush()
            session.add(
                LiffIdentity(
                    line_user_id=f"U_HX_ELEV_{suffix}",
                    display_name=full_name,
                    patient_id=patient.id,
                    role="patient",
                )
            )
            patients_by_suffix[suffix] = patient

        upload = Upload(
            patient_id=patient.id,
            object_key=f"patients/hx-elev/{case_number}/{local_ts.replace(' ', 'T')}.jpg",
            content_type="image/jpeg",
            created_at=_parse_local_dt(local_ts),
            symptom_pain=bool(symptoms.get("symptom_pain")),
            symptom_discharge=bool(symptoms.get("symptom_discharge")),
            symptom_pus=bool(symptoms.get("symptom_pus")),
            symptom_cloudy_dialysate=bool(symptoms.get("symptom_cloudy_dialysate")),
        )
        session.add(upload)
        session.flush()
        session.add(
            AIResult(
                upload_id=upload.id,
                predicted_class="class_1" if screening == "normal" else "class_4",
                probability=0.18 if screening == "normal" else 0.91,
                threshold=0.5,
                screening_result=screening,
                model_version="hx-elevated-demo",
                error_reason=None,
            )
        )
        day = local_ts.split(" ", 1)[0]
        if day not in seeded_days:
            seeded_days.append(day)

    return seeded_days


def main() -> int:
    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env")

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
            days = _seed_demo(session)
            session.commit()
        except Exception:
            session.rollback()
            raise

    print(f"Seeded elevated-only demo patients ({CASE_PREFIX}*).")
    print("Orange-only days (no suspected): 2026-07-14, 2026-07-15, 2026-07-16")
    print("Red contrast day: 2026-07-13")
    print(f"Dates touched: {', '.join(days)}")
    print("Open /admin/history-overview and pick those dates to verify KPI + calendar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
