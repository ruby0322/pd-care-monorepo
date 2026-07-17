#!/usr/bin/env python3
"""Seed fake patients with real SeaweedFS uploads for dev / staging demos.

Creates bound and unassigned patients (for assignment-board testing), optional staff
assignments, and JPEG uploads via the same persist path as the patient API.

Run inside the backend pod (recommended for k8s dev — model + S3 env already set):

    bash ops/deploy/seed-dev-fake-patients.sh

Or locally against port-forwarded Postgres + SeaweedFS:

    cd apps/backend && python sql/manual/seed_dev_fake_patients.py

Use --clear to remove rows created by a previous run (case_number P-DEV-FAKE-*).
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from dataclasses import dataclass, replace
from pathlib import Path


def _resolve_backend_root() -> Path:
    here = Path(__file__).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "app" / "core" / "config.py").is_file():
            return candidate
    pod_app = Path("/app")
    if (pod_app / "app" / "core" / "config.py").is_file():
        return pod_app
    raise RuntimeError("Could not locate backend root (expected app/core/config.py)")


_BACKEND_ROOT = _resolve_backend_root()
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

from PIL import Image
from sqlalchemy import delete, select

from app.core.config import Settings, get_settings
from app.db.migrations import upgrade_database
from app.db.models import AIResult, LiffIdentity, Notification, Patient, StaffPatientAssignment, Upload
from app.db.session import create_engine_from_url, create_session_factory
from app.services.model_loader import load_model
from app.services.prescreen import load_prescreen_model
from app.services.storage import StorageService, build_storage_client
from app.services.upload import persist_patient_upload

CASE_PREFIX = "P-DEV-FAKE-"
LINE_PREFIX = "U_DEV_FAKE_"


@dataclass(frozen=True)
class FakePatientSpec:
    suffix: str
    full_name: str
    gender: str
    birth_date: str
    line_user_id: str | None
    display_name: str | None
    upload_count: int
    assign: bool


_FAKE_PATIENTS: tuple[FakePatientSpec, ...] = (
    FakePatientSpec("001", "王小明", "male", "1985-03-12", f"{LINE_PREFIX}001", "王小明", 2, True),
    FakePatientSpec("002", "陳美玲", "female", "1990-07-22", f"{LINE_PREFIX}002", "陳美玲", 3, True),
    FakePatientSpec("003", "李大同", "male", "1978-11-05", f"{LINE_PREFIX}003", "李大同", 1, False),
    FakePatientSpec("004", "林淑芬", "female", "1982-01-18", None, None, 0, False),
    FakePatientSpec("005", "張志偉", "male", "1995-09-30", None, None, 0, False),
    FakePatientSpec("006", "黃雅婷", "female", "1988-04-08", f"{LINE_PREFIX}006", "黃雅婷", 2, True),
    FakePatientSpec("007", "吳建國", "male", "1970-12-01", f"{LINE_PREFIX}007", "吳建國", 1, False),
    FakePatientSpec("008", "周慧君", "female", "1993-06-16", None, None, 0, False),
)


def _make_image_bytes(seed: int) -> bytes:
    color = ((seed * 37) % 200 + 40, (seed * 61) % 200 + 40, (seed * 91) % 200 + 40)
    image = Image.new("RGB", (512, 512), color=color)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _resolve_staff_identity_id(session) -> int | None:
    for line_user_id in ("U_DEV_STAFF", "U_DEV_ADMIN", "U_DEV_DUAL"):
        row = session.scalar(
            select(LiffIdentity.id).where(
                LiffIdentity.line_user_id == line_user_id,
                LiffIdentity.role.in_(("staff", "admin")),
                LiffIdentity.is_active.is_(True),
            )
        )
        if row is not None:
            return int(row)
    row = session.scalar(
        select(LiffIdentity.id)
        .where(LiffIdentity.role.in_(("staff", "admin")), LiffIdentity.is_active.is_(True))
        .order_by(LiffIdentity.id.asc())
        .limit(1)
    )
    return int(row) if row is not None else None


def _clear_previous(session) -> None:
    case_numbers = [f"{CASE_PREFIX}{spec.suffix}" for spec in _FAKE_PATIENTS]
    line_user_ids = [spec.line_user_id for spec in _FAKE_PATIENTS if spec.line_user_id]

    patient_ids = list(
        session.scalars(select(Patient.id).where(Patient.case_number.in_(case_numbers))).all()
    )
    if patient_ids:
        upload_ids = select(Upload.id).where(Upload.patient_id.in_(patient_ids))
        session.execute(delete(Notification).where(Notification.patient_id.in_(patient_ids)))
        session.execute(delete(AIResult).where(AIResult.upload_id.in_(upload_ids)))
        session.execute(delete(Upload).where(Upload.patient_id.in_(patient_ids)))
        session.execute(delete(StaffPatientAssignment).where(StaffPatientAssignment.patient_id.in_(patient_ids)))
        session.execute(delete(LiffIdentity).where(LiffIdentity.patient_id.in_(patient_ids)))
        session.execute(delete(Patient).where(Patient.id.in_(patient_ids)))
    if line_user_ids:
        session.execute(delete(LiffIdentity).where(LiffIdentity.line_user_id.in_(line_user_ids)))


def _seed_patients(session, *, staff_identity_id: int | None) -> dict[str, int]:
    patient_ids: dict[str, int] = {}
    for spec in _FAKE_PATIENTS:
        case_number = f"{CASE_PREFIX}{spec.suffix}"
        patient = Patient(
            case_number=case_number,
            birth_date=spec.birth_date,
            full_name=spec.full_name,
            gender=spec.gender,
            is_active=True,
        )
        session.add(patient)
        session.flush()
        patient_ids[spec.suffix] = patient.id

        if spec.line_user_id:
            session.add(
                LiffIdentity(
                    line_user_id=spec.line_user_id,
                    display_name=spec.display_name or spec.full_name,
                    picture_url=None,
                    patient_id=patient.id,
                    role="patient",
                    is_active=True,
                )
            )

        if spec.assign and staff_identity_id is not None:
            session.add(
                StaffPatientAssignment(
                    staff_identity_id=staff_identity_id,
                    patient_id=patient.id,
                )
            )
    return patient_ids


def _seed_uploads(
    session_factory,
    *,
    settings: Settings,
  loaded_model,
  loaded_prescreen_model,
  storage_service: StorageService,
  patient_ids: dict[str, int],
) -> int:
    upload_total = 0
    for index, spec in enumerate(_FAKE_PATIENTS):
        if spec.upload_count <= 0:
            continue
        patient_id = patient_ids[spec.suffix]
        for upload_index in range(spec.upload_count):
            image_bytes = _make_image_bytes(index * 10 + upload_index)
            with session_factory() as session:
                result = persist_patient_upload(
                    session,
                    settings=settings,
                    loaded_model=loaded_model,
                    loaded_prescreen_model=loaded_prescreen_model,
                    storage_service=storage_service,
                    patient_id=patient_id,
                    content_type="image/jpeg",
                    filename=f"{spec.suffix}-{upload_index}.jpg",
                    image_bytes=image_bytes,
                    symptom_pain=upload_index % 3 == 0,
                    symptom_discharge=upload_index % 2 == 0,
                    symptom_pus=upload_index % 4 == 0,
                    symptom_cloudy_dialysate=upload_index % 5 == 0,
                )
                upload_total += 1
                print(
                    f"  upload patient={spec.full_name} id={patient_id} "
                    f"upload_id={result.upload.id} screening={result.ai_result.screening_result}"
                )
    return upload_total


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed fake dev patients with uploads")
    parser.add_argument("--clear", action="store_true", help="Remove prior P-DEV-FAKE-* seed data first")
    parser.add_argument("--skip-uploads", action="store_true", help="Create patients only (no SeaweedFS writes)")
    args = parser.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env")

    database_url = os.getenv("PDCARE_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    settings = get_settings()
    if database_url and database_url != settings.database_url:
        settings = replace(settings, database_url=database_url)

    print(f"Database: {settings.database_url}")
    print(f"S3: {settings.s3_endpoint_url} bucket={settings.s3_bucket_name}")

    engine = create_engine_from_url(settings.database_url)
    upgrade_database(settings.database_url)
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        if args.clear:
            print("Clearing previous fake seed rows…")
            _clear_previous(session)
            session.commit()

        staff_identity_id = _resolve_staff_identity_id(session)
        if staff_identity_id is None:
            print("Warning: no staff/admin identity found; assignments will be skipped.", file=sys.stderr)
        else:
            print(f"Assigning flagged patients to staff_identity_id={staff_identity_id}")

        patient_ids = _seed_patients(session, staff_identity_id=staff_identity_id)
        session.commit()

    assigned = sum(1 for spec in _FAKE_PATIENTS if spec.assign and staff_identity_id)
    unassigned = len(_FAKE_PATIENTS) - assigned
    print(f"Created {len(_FAKE_PATIENTS)} patients ({assigned} assigned, {unassigned} unassigned).")

    if args.skip_uploads:
        print("Skipped uploads (--skip-uploads).")
        return 0

    print("Loading models for uploads…")
    loaded_model = load_model(settings)
    try:
        loaded_prescreen_model = load_prescreen_model(settings)
    except Exception:
        loaded_prescreen_model = None

    storage_service = StorageService(
        build_storage_client(
            settings.s3_endpoint_url,
            settings.s3_region,
            settings.s3_access_key,
            settings.s3_secret_key,
        ),
        settings.s3_bucket_name,
        settings.image_access_token_secret,
    )
    storage_service.ensure_bucket_exists()

    print("Uploading images…")
    upload_total = _seed_uploads(
        session_factory,
        settings=settings,
        loaded_model=loaded_model,
        loaded_prescreen_model=loaded_prescreen_model,
        storage_service=storage_service,
        patient_ids=patient_ids,
    )
    print(f"Done. {upload_total} uploads stored in SeaweedFS.")
    print("\nUnassigned pool case numbers (for assignment board):")
    for spec in _FAKE_PATIENTS:
        if not spec.assign:
            print(f"  {CASE_PREFIX}{spec.suffix}  {spec.full_name}  ({spec.gender})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
