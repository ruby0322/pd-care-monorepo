from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Select, and_, select
from sqlalchemy.orm import Session

from app.db.models import AIResult, Annotation, LiffIdentity, Patient, PendingBinding, StaffPatientAssignment, Upload


def _parse_birth_date(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return None


def calculate_age(birth_date: str) -> int | None:
    parsed = _parse_birth_date(birth_date)
    if parsed is None:
        return None
    today = datetime.now(tz=timezone.utc).date()
    years = today.year - parsed.year
    if (today.month, today.day) < (parsed.month, parsed.day):
        years -= 1
    return max(years, 0)


@dataclass
class StaffPatientRow:
    patient: Patient
    line_user_id: str | None
    upload_count: int
    suspected_count: int
    latest_upload_at: datetime | None


def list_assigned_patient_ids(session: Session, *, staff_identity_id: int) -> set[int]:
    rows = session.execute(
        select(StaffPatientAssignment.patient_id).where(StaffPatientAssignment.staff_identity_id == staff_identity_id)
    ).scalars().all()
    return set(rows)


def ensure_staff_assignment(session: Session, *, staff_identity_id: int, patient_id: int) -> None:
    existing = session.execute(
        select(StaffPatientAssignment).where(
            StaffPatientAssignment.staff_identity_id == staff_identity_id,
            StaffPatientAssignment.patient_id == patient_id,
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(StaffPatientAssignment(staff_identity_id=staff_identity_id, patient_id=patient_id))


def list_staff_patients(
    session: Session,
    *,
    months: int,
    age_min: int | None,
    age_max: int | None,
    infection_status: str,
    is_active_filter: str,
    accessible_patient_ids: set[int] | None = None,
) -> list[StaffPatientRow]:
    cutoff = datetime.now(tz=timezone.utc).replace(day=1)
    month = cutoff.month - months
    year = cutoff.year
    while month <= 0:
        month += 12
        year -= 1
    cutoff = cutoff.replace(year=year, month=month)

    patient_query: Select = select(Patient)
    if is_active_filter == "active":
        patient_query = patient_query.where(Patient.is_active.is_(True))
    elif is_active_filter == "inactive":
        patient_query = patient_query.where(Patient.is_active.is_(False))
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        patient_query = patient_query.where(Patient.id.in_(accessible_patient_ids))
    patients = session.execute(patient_query).scalars().all()
    identities = session.execute(select(LiffIdentity).where(LiffIdentity.patient_id.is_not(None))).scalars().all()
    line_by_patient: dict[int, str] = {}
    for identity in identities:
        if identity.patient_id is not None and identity.patient_id not in line_by_patient:
            line_by_patient[identity.patient_id] = identity.line_user_id

    uploads = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.created_at >= cutoff)
    ).all()
    metrics: dict[int, dict[str, object]] = defaultdict(
        lambda: {"upload_count": 0, "suspected_count": 0, "latest_upload_at": None}
    )
    for upload, ai_result in uploads:
        metric = metrics[upload.patient_id]
        metric["upload_count"] = int(metric["upload_count"]) + 1
        if ai_result.screening_result == "suspected":
            metric["suspected_count"] = int(metric["suspected_count"]) + 1
        latest = metric["latest_upload_at"]
        if latest is None or upload.created_at > latest:
            metric["latest_upload_at"] = upload.created_at

    rows: list[StaffPatientRow] = []
    for patient in patients:
        age = calculate_age(patient.birth_date)
        if age_min is not None and (age is None or age < age_min):
            continue
        if age_max is not None and (age is None or age > age_max):
            continue

        patient_metric = metrics.get(patient.id, {"upload_count": 0, "suspected_count": 0, "latest_upload_at": None})
        upload_count = int(patient_metric["upload_count"])
        suspected_count = int(patient_metric["suspected_count"])
        if infection_status == "suspected" and suspected_count == 0:
            continue
        if infection_status == "normal" and suspected_count > 0:
            continue

        rows.append(
            StaffPatientRow(
                patient=patient,
                line_user_id=line_by_patient.get(patient.id),
                upload_count=upload_count,
                suspected_count=suspected_count,
                latest_upload_at=patient_metric["latest_upload_at"],
            )
        )
    return rows


def list_patient_upload_records(session: Session, *, patient_id: int) -> list[tuple[Upload, AIResult, bool]]:
    upload_rows = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.desc())
    ).all()
    annotated_upload_ids = set(
        session.execute(select(Annotation.upload_id).where(Annotation.patient_id == patient_id)).scalars().all()
    )
    return [(upload, ai_result, upload.id in annotated_upload_ids) for upload, ai_result in upload_rows]


def list_upload_queue(
    session: Session,
    *,
    limit: int,
    suspected_only: bool,
    accessible_patient_ids: set[int] | None = None,
) -> list[tuple[Upload, AIResult, Patient, str | None, bool]]:
    base_query: Select = (
        select(Upload, AIResult, Patient)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .join(Patient, Patient.id == Upload.patient_id)
        .where(Patient.is_active.is_(True))
    )
    if suspected_only:
        base_query = base_query.where(AIResult.screening_result == "suspected")
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        base_query = base_query.where(Patient.id.in_(accessible_patient_ids))
    base_query = base_query.order_by(Upload.created_at.desc()).limit(limit)
    rows = session.execute(base_query).all()

    identity_rows = session.execute(select(LiffIdentity).where(LiffIdentity.patient_id.is_not(None))).scalars().all()
    line_by_patient: dict[int, str] = {}
    for identity in identity_rows:
        if identity.patient_id is not None and identity.patient_id not in line_by_patient:
            line_by_patient[identity.patient_id] = identity.line_user_id

    upload_ids = [upload.id for upload, _, _ in rows]
    annotated_ids = set(session.execute(select(Annotation.upload_id).where(Annotation.upload_id.in_(upload_ids))).scalars().all()) if upload_ids else set()

    result: list[tuple[Upload, AIResult, Patient, str | None, bool]] = []
    for upload, ai_result, patient in rows:
        result.append((upload, ai_result, patient, line_by_patient.get(patient.id), upload.id in annotated_ids))
    return result


def upsert_annotation_for_upload(
    session: Session,
    *,
    upload_id: int,
    reviewer_identity_id: int,
    label: str,
    comment: str | None,
) -> Annotation:
    upload = session.get(Upload, upload_id)
    if upload is None:
        raise LookupError("Upload not found")

    annotation = session.execute(
        select(Annotation)
        .where(
            Annotation.upload_id == upload_id,
            Annotation.reviewer_identity_id == reviewer_identity_id,
        )
        .order_by(Annotation.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if annotation is None:
        annotation = Annotation(
            patient_id=upload.patient_id,
            upload_id=upload_id,
            reviewer_identity_id=reviewer_identity_id,
            label=label,
            comment=comment,
        )
        session.add(annotation)
    else:
        annotation.label = label
        annotation.comment = comment
    session.commit()
    session.refresh(annotation)
    return annotation


def list_annotations_for_patient(session: Session, *, patient_id: int) -> list[tuple[Annotation, str]]:
    rows = session.execute(
        select(Annotation, LiffIdentity.line_user_id)
        .join(LiffIdentity, LiffIdentity.id == Annotation.reviewer_identity_id)
        .where(Annotation.patient_id == patient_id)
        .order_by(Annotation.created_at.desc())
    ).all()
    return rows


def list_pending_bindings(session: Session) -> list[tuple[PendingBinding, list[Patient]]]:
    pending_rows = session.execute(
        select(PendingBinding).where(PendingBinding.status == "pending").order_by(PendingBinding.created_at.asc())
    ).scalars().all()
    results: list[tuple[PendingBinding, list[Patient]]] = []
    for pending in pending_rows:
        candidates = session.execute(
            select(Patient).where(
                and_(
                    Patient.case_number == pending.case_number,
                    Patient.birth_date == pending.birth_date,
                    Patient.is_active.is_(True),
                )
            )
        ).scalars().all()
        results.append((pending, candidates))
    return results


def link_pending_binding(session: Session, *, pending_id: int, patient_id: int) -> PendingBinding:
    pending = session.get(PendingBinding, pending_id)
    if pending is None:
        raise LookupError("Pending binding not found")
    if pending.status != "pending":
        raise ValueError("Pending binding is already resolved")

    patient = session.get(Patient, patient_id)
    if patient is None:
        raise LookupError("Patient not found")

    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == pending.line_user_id)
    ).scalar_one_or_none()
    if identity is None:
        identity = LiffIdentity(
            line_user_id=pending.line_user_id,
            display_name=None,
            picture_url=None,
            patient_id=patient_id,
            role="patient",
        )
        session.add(identity)
    else:
        identity.patient_id = patient_id

    pending.status = "approved"
    session.commit()
    session.refresh(pending)
    return pending


def create_patient_and_link_pending_binding(
    session: Session,
    *,
    pending_id: int,
    full_name: str,
) -> tuple[PendingBinding, Patient]:
    pending = session.get(PendingBinding, pending_id)
    if pending is None:
        raise LookupError("Pending binding not found")
    if pending.status != "pending":
        raise ValueError("Pending binding is already resolved")

    patient = Patient(
        case_number=pending.case_number,
        birth_date=pending.birth_date,
        full_name=full_name.strip(),
        is_active=True,
    )
    session.add(patient)
    session.flush()
    pending = link_pending_binding(session, pending_id=pending_id, patient_id=patient.id)
    session.refresh(patient)
    return pending, patient


def update_pending_binding_status(session: Session, *, pending_id: int, status: str) -> PendingBinding:
    pending = session.get(PendingBinding, pending_id)
    if pending is None:
        raise LookupError("Pending binding not found")
    if pending.status != "pending":
        raise ValueError("Pending binding is already resolved")
    pending.status = status
    session.commit()
    session.refresh(pending)
    return pending


def update_patient_active_status(session: Session, *, patient_id: int, is_active: bool) -> Patient:
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise LookupError("Patient not found")
    patient.is_active = is_active
    session.commit()
    session.refresh(patient)
    return patient
