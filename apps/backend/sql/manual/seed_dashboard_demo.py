#!/usr/bin/env python3
"""Seed ~30 days of dashboard demo uploads for local UI review.

Creates P-DEV-DASH-* patients with mixed suspected / elevated / other tiers,
staff assignments (U_DEV_STAFF), and optional staff annotations. Dates anchor to
Taipei today so the admin week calendar always shows a realistic month of activity.

Run after personas (and optionally fake patients):

    npm run seed:dev-personas
    npm run seed:dashboard-demo

Requires DATABASE_URL (loads apps/backend/.env when python-dotenv is installed).
"""

from __future__ import annotations

import os
import random
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from sqlalchemy import delete, inspect, select, text
from sqlalchemy.orm import Session

from app.db.migrations import upgrade_database
from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, StaffPatientAssignment, Upload
from app.db.session import create_engine_from_url, create_session_factory

TZ = ZoneInfo("Asia/Taipei")
CASE_PREFIX = "P-DEV-DASH-"
LINE_PREFIX = "U_DEV_DASH_"
LOOKBACK_DAYS = 30
RNG = random.Random(20260806)


@dataclass(frozen=True)
class DemoPatientSpec:
    suffix: str
    full_name: str
    gender: str
    birth_date: str
    picture_url: str | None


_PATIENTS: tuple[DemoPatientSpec, ...] = (
    DemoPatientSpec("001", "陳志明", "male", "1968-04-12", "https://i.pravatar.cc/150?u=dash001"),
    DemoPatientSpec("002", "林美華", "female", "1972-09-03", "https://i.pravatar.cc/150?u=dash002"),
    DemoPatientSpec("003", "王淑芬", "female", "1960-11-28", "https://i.pravatar.cc/150?u=dash003"),
    DemoPatientSpec("004", "張文雄", "male", "1955-07-19", "https://i.pravatar.cc/150?u=dash004"),
    DemoPatientSpec("005", "黃雅婷", "female", "1988-02-14", "https://i.pravatar.cc/150?u=dash005"),
    DemoPatientSpec("006", "李俊傑", "male", "1991-06-08", "https://i.pravatar.cc/150?u=dash006"),
    DemoPatientSpec("007", "吳佳玲", "female", "1979-12-22", "https://i.pravatar.cc/150?u=dash007"),
    DemoPatientSpec("008", "蔡明德", "male", "1963-03-30", None),
    DemoPatientSpec("009", "許麗娟", "female", "1974-08-17", "https://i.pravatar.cc/150?u=dash009"),
    DemoPatientSpec("010", "楊志豪", "male", "1982-01-05", "https://i.pravatar.cc/150?u=dash010"),
    DemoPatientSpec("011", "鄭心怡", "female", "1995-10-11", "https://i.pravatar.cc/150?u=dash011"),
    DemoPatientSpec("012", "謝承恩", "male", "1970-05-25", "https://i.pravatar.cc/150?u=dash012"),
)


def _taipei_today() -> date:
    return datetime.now(tz=TZ).date()


def _parse_local_dt(day: date, hour: int, minute: int) -> datetime:
    return datetime.combine(day, datetime.min.time().replace(hour=hour, minute=minute), tzinfo=TZ)


def _resolve_staff_identity_id(session: Session) -> int | None:
    for line_user_id in ("U_DEV_ADMIN", "U_DEV_STAFF", "U_DEV_DUAL"):
        row = session.scalar(
            select(LiffIdentity.id).where(
                LiffIdentity.line_user_id == line_user_id,
                LiffIdentity.role.in_(("staff", "admin")),
                LiffIdentity.is_active.is_(True),
            )
        )
        if row is not None:
            return int(row)
    return None


def _clear_demo(session: Session) -> None:
    case_numbers = [f"{CASE_PREFIX}{spec.suffix}" for spec in _PATIENTS]
    line_user_ids = [f"{LINE_PREFIX}{spec.suffix}" for spec in _PATIENTS]
    patient_ids = list(session.scalars(select(Patient.id).where(Patient.case_number.in_(case_numbers))).all())
    if patient_ids:
        upload_ids = select(Upload.id).where(Upload.patient_id.in_(patient_ids))
        session.execute(delete(Annotation).where(Annotation.upload_id.in_(upload_ids)))
        session.execute(delete(Notification).where(Notification.patient_id.in_(patient_ids)))
        session.execute(delete(AIResult).where(AIResult.upload_id.in_(upload_ids)))
        session.execute(delete(Upload).where(Upload.patient_id.in_(patient_ids)))
        session.execute(delete(StaffPatientAssignment).where(StaffPatientAssignment.patient_id.in_(patient_ids)))
        session.execute(delete(LiffIdentity).where(LiffIdentity.patient_id.in_(patient_ids)))
        session.execute(delete(Patient).where(Patient.id.in_(patient_ids)))
    session.execute(delete(LiffIdentity).where(LiffIdentity.line_user_id.in_(line_user_ids)))


def _add_annotation(
    session: Session,
    *,
    patient_id: int,
    upload_id: int,
    reviewer_identity_id: int,
    label: str,
) -> None:
    bind = session.get_bind()
    column_names = {column["name"] for column in inspect(bind).get_columns("annotations")}
    if "staff_user_id" in column_names:
        session.execute(
            text(
                """
                INSERT INTO annotations (
                    patient_id, upload_id, reviewer_identity_id, staff_user_id, label, comment, patient_read_at
                ) VALUES (
                    :patient_id, :upload_id, :reviewer_identity_id, :staff_user_id, :label, :comment, NULL
                )
                """
            ),
            {
                "patient_id": patient_id,
                "upload_id": upload_id,
                "reviewer_identity_id": reviewer_identity_id,
                "staff_user_id": reviewer_identity_id,
                "label": label,
                "comment": "dashboard demo",
            },
        )
        return
    session.add(
        Annotation(
            patient_id=patient_id,
            upload_id=upload_id,
            reviewer_identity_id=reviewer_identity_id,
            label=label,
            comment="dashboard demo",
        )
    )


def _upload_profile(day_offset: int, patient_index: int, upload_index: int) -> tuple[str, dict[str, bool], float, bool]:
    """Return screening_result, symptoms, probability, should_annotate."""
    roll = RNG.random()
    # Today / yesterday: richer risk mix for UI review.
    if day_offset >= -1:
        if roll < 0.28:
            return ("suspected", {}, 0.82 + RNG.random() * 0.12, roll < 0.12)
        if roll < 0.48:
            symptoms = RNG.choice(
                (
                    {"symptom_pain": True},
                    {"symptom_pus": True},
                    {"symptom_cloudy_dialysate": True},
                    {"symptom_pain": True, "symptom_pus": True},
                )
            )
            return ("normal", symptoms, 0.12 + RNG.random() * 0.15, roll < 0.22)
        return ("normal", {}, 0.05 + RNG.random() * 0.2, False)

    if day_offset >= -7 and roll < 0.18:
        return ("suspected", {}, 0.75 + RNG.random() * 0.2, roll < 0.35)
    if roll < 0.12:
        return ("suspected", {}, 0.7 + RNG.random() * 0.25, RNG.random() < 0.4)
    if roll < 0.22:
        return (
            "normal",
            RNG.choice(({"symptom_pain": True}, {"symptom_pus": True}, {"symptom_cloudy_dialysate": True})),
            0.1 + RNG.random() * 0.2,
            RNG.random() < 0.3,
        )
    return ("normal", {}, 0.05 + RNG.random() * 0.25, False)


def _seed_demo(session: Session, *, staff_identity_id: int | None) -> list[str]:
    patients_by_suffix: dict[str, Patient] = {}
    for spec in _PATIENTS:
        patient = Patient(
            case_number=f"{CASE_PREFIX}{spec.suffix}",
            birth_date=spec.birth_date,
            full_name=spec.full_name,
            gender=spec.gender,
            is_active=True,
        )
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=f"{LINE_PREFIX}{spec.suffix}",
                display_name=spec.full_name,
                picture_url=spec.picture_url,
                patient_id=patient.id,
                role="patient",
                is_active=True,
            )
        )
        if staff_identity_id is not None:
            session.add(
                StaffPatientAssignment(
                    staff_identity_id=staff_identity_id,
                    patient_id=patient.id,
                )
            )
        patients_by_suffix[spec.suffix] = patient

    today = _taipei_today()
    active_days: list[str] = []

    for day_offset in range(-LOOKBACK_DAYS, 1):
        local_day = today + timedelta(days=day_offset)
        weekday = local_day.weekday()
        # Skip some days; weekends slightly quieter.
        skip_chance = 0.35 if weekday >= 5 else 0.22
        if day_offset not in (0, -1, -3, -7, -14, -21) and RNG.random() < skip_chance:
            continue

        active_days.append(local_day.isoformat())
        upload_target = RNG.randint(5, 14) if day_offset >= -7 else RNG.randint(3, 10)
        if weekday >= 5:
            upload_target = max(2, upload_target - 2)

        chosen_suffixes = RNG.sample(
            [spec.suffix for spec in _PATIENTS],
            k=min(len(_PATIENTS), RNG.randint(3, min(9, upload_target))),
        )
        upload_count = 0
        patient_cycle = 0
        while upload_count < upload_target:
            suffix = chosen_suffixes[patient_cycle % len(chosen_suffixes)]
            patient_cycle += 1
            patient = patients_by_suffix[suffix]
            patient_index = int(suffix)
            screening, symptoms, probability, annotate = _upload_profile(day_offset, patient_index, upload_count)
            hour = 7 + (upload_count * 2 + patient_index) % 14
            minute = (upload_count * 11 + patient_index * 7) % 60

            upload = Upload(
                patient_id=patient.id,
                object_key=f"patients/dashboard-demo/{patient.id}/{local_day.isoformat()}-{upload_count}.jpg",
                content_type="image/jpeg",
                created_at=_parse_local_dt(local_day, hour, minute),
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
                    screening_result=screening,
                    probability=probability,
                    threshold=0.5,
                    predicted_class="class_4" if screening == "suspected" else "class_1",
                    model_version="dashboard-demo-v1",
                )
            )
            if annotate and staff_identity_id is not None and screening in ("suspected", "normal"):
                label = "suspected" if screening == "suspected" else "normal"
                _add_annotation(
                    session,
                    patient_id=patient.id,
                    upload_id=upload.id,
                    reviewer_identity_id=staff_identity_id,
                    label=label,
                )
            upload_count += 1

    return active_days


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
    upgrade_database(str(engine.url))
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        try:
            staff_identity_id = _resolve_staff_identity_id(session)
            if staff_identity_id is None:
                print("Warning: no U_DEV_STAFF/U_DEV_ADMIN identity — run seed:dev-personas first.", file=sys.stderr)
            _clear_demo(session)
            active_days = _seed_demo(session, staff_identity_id=staff_identity_id)
            session.commit()
        except Exception:
            session.rollback()
            raise

    today = _taipei_today()
    print(f"\nDashboard demo seeded ({len(_PATIENTS)} patients, {len(active_days)} active days).")
    print(f"Taipei today: {today.isoformat()}")
    print("Login as U_DEV_ADMIN or U_DEV_STAFF → /admin")
    print("Use arrow keys / week nav / calendar icon on the week strip.")
    print(f"Sample active range: {active_days[0]} … {active_days[-1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
