from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlalchemy import Select, and_, case, delete, func, select
from sqlalchemy.orm import Session, aliased

from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, PendingBinding, StaffPatientAssignment, Upload
from app.services.symptoms import calendar_risk_tier
from app.services.taipei_dates import TAIPEI_TIMEZONE, resolve_taipei_day_bounds, to_taipei_date
from app.services.upload_history import summarize_patient_upload_history


def _load_latest_annotation_by_upload_ids(session: Session, *, upload_ids: set[int]) -> dict[int, Annotation]:
    if not upload_ids:
        return {}
    rows = session.execute(
        select(Annotation)
        .where(Annotation.upload_id.in_(upload_ids))
        .order_by(Annotation.upload_id.asc(), Annotation.created_at.desc())
    ).scalars()
    result: dict[int, Annotation] = {}
    for row in rows:
        if row.upload_id not in result:
            result[row.upload_id] = row
    return result


def _tier_for_upload(
    *,
    upload: Upload,
    screening_result: str | None,
    annotation: Annotation | None,
) -> str:
    return calendar_risk_tier(
        screening_result=screening_result,
        annotation_label=annotation.label if annotation else None,
        symptom_pain=upload.symptom_pain,
        symptom_pus=upload.symptom_pus,
        symptom_cloudy_dialysate=upload.symptom_cloudy_dialysate,
    )


class DuplicatePatientError(ValueError):
    pass


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
    line_display_name: str | None
    line_user_id: str | None
    upload_count: int
    suspected_count: int
    latest_upload_at: datetime | None
    latest_upload_status: str | None
    has_suspected_risk: bool = False
    has_symptom_elevated_risk: bool = False


@dataclass
class StaffAssignmentRow:
    patient: Patient
    staff_identity_id: int | None
    staff_line_user_id: str | None
    staff_display_name: str | None
    patient_picture_url: str | None = None


@dataclass
class StaffBulkAssignmentResult:
    patient_id: int | None
    staff_identity_id: int | None
    status: Literal["updated", "unchanged", "invalid"]
    detail: str | None = None


def list_assigned_patient_ids(session: Session, *, staff_identity_id: int) -> set[int]:
    rows = session.execute(
        select(StaffPatientAssignment.patient_id).where(StaffPatientAssignment.staff_identity_id == staff_identity_id)
    ).scalars().all()
    return set(rows)


def ensure_staff_assignment(
    session: Session,
    *,
    staff_identity_id: int,
    patient_id: int,
) -> Literal["updated", "unchanged"]:
    return assign_patient_to_staff(session, staff_identity_id=staff_identity_id, patient_id=patient_id)


def unassign_patient(
    session: Session,
    *,
    patient_id: int,
) -> Literal["updated", "unchanged"]:
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise LookupError("Patient not found")

    deleted_count = (
        session.execute(delete(StaffPatientAssignment).where(StaffPatientAssignment.patient_id == patient_id))
        .rowcount
        or 0
    )
    session.commit()
    return "updated" if deleted_count > 0 else "unchanged"


def list_patient_assignments(
    session: Session,
    *,
    query: str | None,
    assignment_filter: str | None,
    binding_filter: str,
    exclude_staff_admin_patients: bool,
    assignee_role: str,
    assignee_active: str,
    limit: int,
    offset: int,
) -> tuple[list[StaffAssignmentRow], int]:
    patient_identity = aliased(LiffIdentity)
    patient_bound_exists = (
        select(patient_identity.id)
        .where(
            patient_identity.patient_id == Patient.id,
            patient_identity.is_active.is_(True),
        )
        .correlate(Patient)
        .exists()
    )
    staff_admin_identity_exists = (
        select(patient_identity.id)
        .where(
            patient_identity.patient_id == Patient.id,
            patient_identity.is_active.is_(True),
            patient_identity.role.in_(("staff", "admin")),
        )
        .correlate(Patient)
        .exists()
    )
    patient_picture_url = (
        select(patient_identity.picture_url)
        .where(
            patient_identity.patient_id == Patient.id,
            patient_identity.is_active.is_(True),
        )
        .order_by(case((patient_identity.role == "patient", 0), else_=1), patient_identity.id.asc())
        .correlate(Patient)
        .limit(1)
        .scalar_subquery()
    )
    stmt: Select = (
        select(
            Patient,
            StaffPatientAssignment.staff_identity_id,
            LiffIdentity.line_user_id,
            LiffIdentity.display_name,
            patient_picture_url,
        )
        .outerjoin(StaffPatientAssignment, StaffPatientAssignment.patient_id == Patient.id)
        .outerjoin(LiffIdentity, LiffIdentity.id == StaffPatientAssignment.staff_identity_id)
    )

    if query:
        q = f"%{query.strip()}%"
        stmt = stmt.where(
            Patient.case_number.ilike(q)
            | Patient.full_name.ilike(q)
            | LiffIdentity.display_name.ilike(q)
            | LiffIdentity.line_user_id.ilike(q)
        )
    if binding_filter == "bound":
        stmt = stmt.where(patient_bound_exists)
    elif binding_filter == "unbound_only":
        stmt = stmt.where(~patient_bound_exists)
    if exclude_staff_admin_patients:
        stmt = stmt.where(~staff_admin_identity_exists)

    resolved_assignment_filter = assignment_filter or "all"

    if resolved_assignment_filter == "assigned":
        stmt = stmt.where(StaffPatientAssignment.staff_identity_id.is_not(None))
    elif resolved_assignment_filter == "unassigned":
        stmt = stmt.where(StaffPatientAssignment.staff_identity_id.is_(None))

    if resolved_assignment_filter != "unassigned":
        if assignee_role in {"staff", "admin"}:
            stmt = stmt.where(
                StaffPatientAssignment.staff_identity_id.is_not(None),
                LiffIdentity.role == assignee_role,
            )
        if assignee_active == "active":
            stmt = stmt.where(
                StaffPatientAssignment.staff_identity_id.is_not(None),
                LiffIdentity.is_active.is_(True),
            )
        elif assignee_active == "inactive":
            stmt = stmt.where(
                StaffPatientAssignment.staff_identity_id.is_not(None),
                LiffIdentity.is_active.is_(False),
            )

    total = int(session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one() or 0)
    rows = session.execute(stmt.order_by(Patient.case_number.asc(), Patient.id.asc()).limit(limit).offset(offset)).all()

    return [
        StaffAssignmentRow(
            patient=patient,
            staff_identity_id=staff_identity_id,
            staff_line_user_id=line_user_id,
            staff_display_name=display_name,
            patient_picture_url=picture_url,
        )
        for patient, staff_identity_id, line_user_id, display_name, picture_url in rows
    ], total


def list_patient_assignments_by_staff(
    session: Session,
    *,
    staff_identity_ids: list[int],
) -> dict[int, list[tuple[int, str, str | None, str, str | None]]]:
    normalized_staff_ids = sorted({staff_id for staff_id in staff_identity_ids if staff_id > 0})
    if not normalized_staff_ids:
        return {}
    patient_identity = aliased(LiffIdentity)
    patient_picture_url = (
        select(patient_identity.picture_url)
        .where(
            patient_identity.patient_id == Patient.id,
            patient_identity.is_active.is_(True),
        )
        .order_by(case((patient_identity.role == "patient", 0), else_=1), patient_identity.id.asc())
        .correlate(Patient)
        .limit(1)
        .scalar_subquery()
    )
    rows = session.execute(
        select(
            StaffPatientAssignment.staff_identity_id,
            Patient.id,
            Patient.case_number,
            Patient.full_name,
            Patient.gender,
            patient_picture_url,
        )
        .join(Patient, Patient.id == StaffPatientAssignment.patient_id)
        .where(StaffPatientAssignment.staff_identity_id.in_(normalized_staff_ids))
        .order_by(StaffPatientAssignment.staff_identity_id.asc(), Patient.case_number.asc(), Patient.id.asc())
    ).all()
    grouped: dict[int, list[tuple[int, str, str | None, str, str | None]]] = defaultdict(list)
    for staff_identity_id, patient_id, case_number, patient_full_name, gender, picture_url in rows:
        grouped[int(staff_identity_id)].append(
            (int(patient_id), case_number, patient_full_name, str(gender or "unknown"), picture_url)
        )
    return grouped


def assign_patient_to_staff(
    session: Session,
    *,
    staff_identity_id: int,
    patient_id: int,
) -> Literal["updated", "unchanged"]:
    staff_identity = session.get(LiffIdentity, staff_identity_id)
    if staff_identity is None:
        raise LookupError("Staff identity not found")
    if staff_identity.role not in {"staff", "admin"}:
        raise ValueError("Target identity must be staff or admin")

    patient = session.get(Patient, patient_id)
    if patient is None:
        raise LookupError("Patient not found")

    existing_assignments = session.execute(
        select(StaffPatientAssignment).where(StaffPatientAssignment.patient_id == patient_id)
    ).scalars().all()
    if len(existing_assignments) == 1 and existing_assignments[0].staff_identity_id == staff_identity_id:
        return "unchanged"

    session.execute(delete(StaffPatientAssignment).where(StaffPatientAssignment.patient_id == patient_id))
    session.add(StaffPatientAssignment(staff_identity_id=staff_identity_id, patient_id=patient_id))
    session.commit()
    return "updated"


def bulk_assign_patients(
    session: Session,
    *,
    assignments: list[tuple[int | None, int | None]],
) -> list[StaffBulkAssignmentResult]:
    results: list[StaffBulkAssignmentResult] = []
    for patient_id, staff_identity_id in assignments:
        if patient_id is None or staff_identity_id is None:
            results.append(
                StaffBulkAssignmentResult(
                    patient_id=patient_id,
                    staff_identity_id=staff_identity_id,
                    status="invalid",
                    detail="patient_id and staff_identity_id are required",
                )
            )
            continue
        try:
            status = assign_patient_to_staff(
                session,
                patient_id=patient_id,
                staff_identity_id=staff_identity_id,
            )
            results.append(
                StaffBulkAssignmentResult(
                    patient_id=patient_id,
                    staff_identity_id=staff_identity_id,
                    status=status,
                )
            )
        except (LookupError, ValueError) as exc:
            session.rollback()
            results.append(
                StaffBulkAssignmentResult(
                    patient_id=patient_id,
                    staff_identity_id=staff_identity_id,
                    status="invalid",
                    detail=str(exc),
                )
            )
    return results


def list_staff_patients(
    session: Session,
    *,
    query: str | None,
    months: int,
    age_min: int | None,
    age_max: int | None,
    infection_status: str,
    binding_filter: str,
    is_active_filter: str,
    created_from: date | None,
    created_to: date | None,
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
    line_identity_by_patient: dict[int, tuple[str | None, str]] = {}
    for identity in identities:
        if identity.patient_id is not None and identity.patient_id not in line_identity_by_patient:
            line_identity_by_patient[identity.patient_id] = (identity.display_name, identity.line_user_id)

    uploads = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.created_at >= cutoff)
    ).all()
    upload_ids = {upload.id for upload, _ in uploads}
    latest_annotation_by_upload = _load_latest_annotation_by_upload_ids(session, upload_ids=upload_ids)
    metrics: dict[int, dict[str, object]] = defaultdict(
        lambda: {
            "upload_count": 0,
            "suspected_count": 0,
            "latest_upload_at": None,
            "latest_upload_status": None,
            "has_suspected_risk": False,
            "has_elevated_risk": False,
        }
    )
    for upload, ai_result in uploads:
        if ai_result.screening_result == "rejected":
            continue
        metric = metrics[upload.patient_id]
        metric["upload_count"] = int(metric["upload_count"]) + 1
        tier = _tier_for_upload(
            upload=upload,
            screening_result=ai_result.screening_result,
            annotation=latest_annotation_by_upload.get(upload.id),
        )
        if tier == "suspected":
            metric["suspected_count"] = int(metric["suspected_count"]) + 1
            metric["has_suspected_risk"] = True
        elif tier == "elevated":
            metric["has_elevated_risk"] = True
        latest = metric["latest_upload_at"]
        if latest is None or upload.created_at > latest:
            metric["latest_upload_at"] = upload.created_at
            metric["latest_upload_status"] = ai_result.screening_result

    created_from_dt = datetime.combine(created_from, time.min, tzinfo=timezone.utc) if created_from is not None else None
    created_to_dt = (
        datetime.combine(created_to, time.min, tzinfo=timezone.utc) + timedelta(days=1) if created_to is not None else None
    )

    rows: list[StaffPatientRow] = []
    normalized_query = query.strip().lower() if query else None
    for patient in patients:
        age = calculate_age(patient.birth_date)
        if age_min is not None and (age is None or age < age_min):
            continue
        if age_max is not None and (age is None or age > age_max):
            continue

        patient_metric = metrics.get(
            patient.id,
            {
                "upload_count": 0,
                "suspected_count": 0,
                "latest_upload_at": None,
                "has_suspected_risk": False,
                "has_elevated_risk": False,
            },
        )
        upload_count = int(patient_metric["upload_count"])
        suspected_count = int(patient_metric["suspected_count"])
        latest_upload_at = patient_metric["latest_upload_at"]
        if isinstance(latest_upload_at, datetime) and latest_upload_at.tzinfo is None:
            latest_upload_at = latest_upload_at.replace(tzinfo=timezone.utc)
        latest_upload_status = patient_metric.get("latest_upload_status")
        has_suspected_risk = bool(patient_metric.get("has_suspected_risk"))
        # Mutually exclusive with suspected: elevated-only patients for period KPI.
        has_symptom_elevated_risk = bool(patient_metric.get("has_elevated_risk")) and not has_suspected_risk
        if infection_status == "suspected" and latest_upload_status != "suspected":
            continue
        if infection_status == "normal" and latest_upload_status != "normal":
            continue
        if created_from_dt is not None and (latest_upload_at is None or latest_upload_at < created_from_dt):
            continue
        if created_to_dt is not None and (latest_upload_at is None or latest_upload_at >= created_to_dt):
            continue

        identity_info = line_identity_by_patient.get(patient.id)
        if binding_filter == "bound" and identity_info is None:
            continue
        if binding_filter == "unbound_only" and identity_info is not None:
            continue
        if normalized_query is not None:
            full_name = (patient.full_name or "").lower()
            line_display_name = (identity_info[0] or "").lower() if identity_info else ""
            line_user_id = (identity_info[1] or "").lower() if identity_info else ""
            case_number = patient.case_number.lower()
            if (
                normalized_query not in full_name
                and normalized_query not in line_display_name
                and normalized_query not in line_user_id
                and normalized_query not in case_number
            ):
                continue
        rows.append(
            StaffPatientRow(
                patient=patient,
                line_display_name=identity_info[0] if identity_info else None,
                line_user_id=identity_info[1] if identity_info else None,
                upload_count=upload_count,
                suspected_count=suspected_count,
                latest_upload_at=latest_upload_at,
                latest_upload_status=latest_upload_status if isinstance(latest_upload_status, str) else None,
                has_suspected_risk=has_suspected_risk,
                has_symptom_elevated_risk=has_symptom_elevated_risk,
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


def get_patient_upload_counts(session: Session, *, patient_id: int) -> tuple[int, int, int, int]:
    rows = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
    ).all()
    upload_ids = {upload.id for upload, _ in rows}
    latest_annotation_by_upload = _load_latest_annotation_by_upload_ids(session, upload_ids=upload_ids)

    total = len(rows)
    suspected = 0
    rejected = 0
    symptom_elevated = 0
    for upload, ai_result in rows:
        if ai_result.screening_result == "rejected":
            rejected += 1
            continue
        tier = _tier_for_upload(
            upload=upload,
            screening_result=ai_result.screening_result,
            annotation=latest_annotation_by_upload.get(upload.id),
        )
        if tier == "suspected":
            suspected += 1
        elif tier == "elevated":
            symptom_elevated += 1
    return total, suspected, rejected, symptom_elevated


def list_patient_upload_records_page(
    session: Session,
    *,
    patient_id: int,
    created_from: date | None,
    created_to: date | None,
    limit: int,
    offset: int,
) -> tuple[int, list[tuple[Upload, AIResult, bool]]]:
    filters = [Upload.patient_id == patient_id]
    if created_from is not None:
        local_start = datetime.combine(created_from, time.min, tzinfo=TAIPEI_TIMEZONE)
        filters.append(Upload.created_at >= local_start.astimezone(timezone.utc))
    if created_to is not None:
        local_end = datetime.combine(created_to + timedelta(days=1), time.min, tzinfo=TAIPEI_TIMEZONE)
        filters.append(Upload.created_at < local_end.astimezone(timezone.utc))

    total = int(session.scalar(select(func.count(Upload.id)).join(AIResult).where(*filters)) or 0)
    upload_rows = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(*filters)
        .order_by(Upload.created_at.desc(), Upload.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    upload_ids = [upload.id for upload, _ in upload_rows]
    annotated_upload_ids = set(
        session.execute(select(Annotation.upload_id).where(Annotation.upload_id.in_(upload_ids))).scalars().all()
    ) if upload_ids else set()
    return total, [(upload, ai_result, upload.id in annotated_upload_ids) for upload, ai_result in upload_rows]


def list_patient_upload_calendar_days(session: Session, *, patient_id: int) -> list[dict[str, object]]:
    days = summarize_patient_upload_history(session, patient_id=patient_id)
    return [
        {
            "date": day.date.isoformat(),
            "upload_count": day.upload_count,
            "has_suspected_risk": day.has_suspected_risk,
            "has_symptom_elevated_risk": day.has_symptom_elevated_risk,
        }
        for day in days
    ]


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
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        base_query = base_query.where(Patient.id.in_(accessible_patient_ids))
    # Fetch a wider window when filtering by tier so post-filter limit stays accurate.
    fetch_limit = limit * 5 if suspected_only else limit
    base_query = base_query.order_by(Upload.created_at.desc()).limit(fetch_limit)
    rows = session.execute(base_query).all()

    identity_rows = session.execute(select(LiffIdentity).where(LiffIdentity.patient_id.is_not(None))).scalars().all()
    line_by_patient: dict[int, str] = {}
    for identity in identity_rows:
        if identity.patient_id is not None and identity.patient_id not in line_by_patient:
            line_by_patient[identity.patient_id] = identity.line_user_id

    upload_ids = {upload.id for upload, _, _ in rows}
    latest_annotation_by_upload = _load_latest_annotation_by_upload_ids(session, upload_ids=upload_ids)
    annotated_ids = set(latest_annotation_by_upload.keys())

    result: list[tuple[Upload, AIResult, Patient, str | None, bool]] = []
    for upload, ai_result, patient in rows:
        if suspected_only:
            tier = _tier_for_upload(
                upload=upload,
                screening_result=ai_result.screening_result,
                annotation=latest_annotation_by_upload.get(upload.id),
            )
            if tier not in {"suspected", "elevated"}:
                continue
        result.append((upload, ai_result, patient, line_by_patient.get(patient.id), upload.id in annotated_ids))
        if len(result) >= limit:
            break
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
            patient_read_at=None,
        )
        session.add(annotation)
    else:
        annotation.label = label
        annotation.comment = comment
        annotation.patient_read_at = None
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
        identity.is_active = True

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


def bulk_reject_pending_bindings(session: Session) -> int:
    pending_rows = session.execute(
        select(PendingBinding).where(PendingBinding.status == "pending")
    ).scalars().all()
    for pending in pending_rows:
        pending.status = "rejected"
    session.commit()
    return len(pending_rows)


def update_patient_active_status(session: Session, *, patient_id: int, is_active: bool) -> Patient:
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise LookupError("Patient not found")
    patient.is_active = is_active
    session.commit()
    session.refresh(patient)
    return patient


def _resolve_deletable_inactive_patient_ids(
    session: Session,
    *,
    patient_ids: list[int],
    accessible_patient_ids: set[int] | None,
) -> tuple[set[int], dict[str, int]]:
    requested_ids = {patient_id for patient_id in patient_ids if patient_id > 0}
    if not requested_ids:
        return set(), {
            "requested_count": 0,
            "deletable_count": 0,
            "skipped_active_count": 0,
            "skipped_forbidden_count": 0,
            "skipped_missing_count": 0,
        }
    rows = session.execute(
        select(Patient.id, Patient.is_active).where(Patient.id.in_(requested_ids))
    ).all()
    status_by_id = {int(patient_id): bool(is_active) for patient_id, is_active in rows}
    found_ids = set(status_by_id.keys())
    scoped_ids = found_ids if accessible_patient_ids is None else found_ids & accessible_patient_ids
    deletable_ids = {patient_id for patient_id in scoped_ids if not status_by_id[patient_id]}
    skipped_active_count = sum(1 for patient_id in scoped_ids if status_by_id[patient_id])
    skipped_forbidden_count = 0 if accessible_patient_ids is None else len(found_ids - scoped_ids)
    skipped_missing_count = len(requested_ids - found_ids)
    return deletable_ids, {
        "requested_count": len(requested_ids),
        "deletable_count": len(deletable_ids),
        "skipped_active_count": skipped_active_count,
        "skipped_forbidden_count": skipped_forbidden_count,
        "skipped_missing_count": skipped_missing_count,
    }


def _count_patient_delete_impact(session: Session, *, patient_ids: set[int]) -> dict[str, int]:
    if not patient_ids:
        return {
            "patients": 0,
            "uploads": 0,
            "ai_results": 0,
            "annotations": 0,
            "notifications": 0,
            "assignments": 0,
        }
    upload_count = int(
        session.execute(select(func.count(Upload.id)).where(Upload.patient_id.in_(patient_ids))).scalar_one() or 0
    )
    ai_result_count = int(
        session.execute(
            select(func.count(AIResult.id))
            .join(Upload, Upload.id == AIResult.upload_id)
            .where(Upload.patient_id.in_(patient_ids))
        ).scalar_one()
        or 0
    )
    annotation_count = int(
        session.execute(select(func.count(Annotation.id)).where(Annotation.patient_id.in_(patient_ids))).scalar_one() or 0
    )
    notification_count = int(
        session.execute(select(func.count(Notification.id)).where(Notification.patient_id.in_(patient_ids))).scalar_one() or 0
    )
    assignment_count = int(
        session.execute(
            select(func.count(StaffPatientAssignment.id)).where(StaffPatientAssignment.patient_id.in_(patient_ids))
        ).scalar_one()
        or 0
    )
    return {
        "patients": len(patient_ids),
        "uploads": upload_count,
        "ai_results": ai_result_count,
        "annotations": annotation_count,
        "notifications": notification_count,
        "assignments": assignment_count,
    }


def preview_delete_inactive_patients(
    session: Session,
    *,
    patient_ids: list[int],
    accessible_patient_ids: set[int] | None,
) -> dict[str, object]:
    deletable_ids, summary = _resolve_deletable_inactive_patient_ids(
        session,
        patient_ids=patient_ids,
        accessible_patient_ids=accessible_patient_ids,
    )
    return {
        **summary,
        "impact": _count_patient_delete_impact(session, patient_ids=deletable_ids),
    }


def delete_inactive_patients(
    session: Session,
    *,
    patient_ids: list[int],
    accessible_patient_ids: set[int] | None,
) -> dict[str, object]:
    deletable_ids, summary = _resolve_deletable_inactive_patient_ids(
        session,
        patient_ids=patient_ids,
        accessible_patient_ids=accessible_patient_ids,
    )
    impact = _count_patient_delete_impact(session, patient_ids=deletable_ids)
    if deletable_ids:
        session.execute(delete(Patient).where(Patient.id.in_(deletable_ids)))
        session.commit()
    return {
        "requested_count": summary["requested_count"],
        "deleted_count": len(deletable_ids),
        "skipped_active_count": summary["skipped_active_count"],
        "skipped_forbidden_count": summary["skipped_forbidden_count"],
        "skipped_missing_count": summary["skipped_missing_count"],
        "impact": impact,
    }


def create_patient_record(
    session: Session,
    *,
    case_number: str,
    birth_date: str,
    full_name: str,
    gender: str = "unknown",
) -> Patient:
    patient = Patient(
        case_number=case_number.strip(),
        birth_date=birth_date.strip(),
        full_name=full_name.strip(),
        gender=gender.strip(),
        is_active=True,
    )
    session.add(patient)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise DuplicatePatientError("Patient with the same case number and birth date already exists") from exc
    session.refresh(patient)
    return patient


def list_gender_distribution(
    session: Session,
    *,
    accessible_patient_ids: set[int] | None = None,
) -> list[tuple[str, int]]:
    query: Select = select(Patient.gender, func.count(Patient.id)).group_by(Patient.gender)
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        query = query.where(Patient.id.in_(accessible_patient_ids))
    rows = session.execute(query).all()
    counts = {str(gender or "unknown"): int(count) for gender, count in rows}
    ordered_keys = ["male", "female", "other", "unknown"]
    return [(key, counts.get(key, 0)) for key in ordered_keys]


def _months_upload_cutoff(months: int) -> datetime:
    cutoff = datetime.now(tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month = cutoff.month - months
    year = cutoff.year
    while month <= 0:
        month += 12
        year -= 1
    return cutoff.replace(year=year, month=month)


def _summarize_tiered_uploads(
    rows: list[tuple[Upload, AIResult]],
    *,
    latest_annotation_by_upload: dict[int, Annotation],
) -> tuple[int, int, int, int, int]:
    total_uploads = len(rows)
    suspected_uploads = 0
    symptom_elevated_uploads = 0
    suspected_patient_ids: set[int] = set()
    elevated_patient_ids: set[int] = set()
    for upload, ai_result in rows:
        tier = _tier_for_upload(
            upload=upload,
            screening_result=ai_result.screening_result,
            annotation=latest_annotation_by_upload.get(upload.id),
        )
        if tier == "suspected":
            suspected_uploads += 1
            suspected_patient_ids.add(upload.patient_id)
        elif tier == "elevated":
            symptom_elevated_uploads += 1
            elevated_patient_ids.add(upload.patient_id)
    elevated_patient_ids -= suspected_patient_ids
    return (
        total_uploads,
        suspected_uploads,
        symptom_elevated_uploads,
        len(suspected_patient_ids),
        len(elevated_patient_ids),
    )


def get_today_suspected_summary(
    session: Session,
    *,
    accessible_patient_ids: set[int] | None = None,
) -> tuple[date, int, int, int, int, int]:
    today, today_start, tomorrow_start = resolve_taipei_day_bounds()
    base_query: Select = (
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .join(Patient, Patient.id == Upload.patient_id)
        .where(
            Upload.created_at >= today_start,
            Upload.created_at < tomorrow_start,
            AIResult.screening_result != "rejected",
        )
    )
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return today, 0, 0, 0, 0, 0
        base_query = base_query.where(Patient.id.in_(accessible_patient_ids))
    rows = session.execute(base_query).all()
    upload_ids = {upload.id for upload, _ in rows}
    latest_annotation_by_upload = _load_latest_annotation_by_upload_ids(session, upload_ids=upload_ids)
    total, suspected, elevated, suspected_users, elevated_users = _summarize_tiered_uploads(
        rows,
        latest_annotation_by_upload=latest_annotation_by_upload,
    )
    return today, total, suspected, elevated, suspected_users, elevated_users


def get_period_suspected_summary(
    session: Session,
    *,
    months: int,
    accessible_patient_ids: set[int] | None = None,
) -> tuple[date, int, int, int, int, int]:
    """Aggregate upload tiers from the same month cutoff used by staff patient list."""
    today, _, _ = resolve_taipei_day_bounds()
    cutoff = _months_upload_cutoff(months)
    base_query: Select = (
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .join(Patient, Patient.id == Upload.patient_id)
        .where(
            Upload.created_at >= cutoff,
            AIResult.screening_result != "rejected",
        )
    )
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return today, 0, 0, 0, 0, 0
        base_query = base_query.where(Patient.id.in_(accessible_patient_ids))
    rows = session.execute(base_query).all()
    upload_ids = {upload.id for upload, _ in rows}
    latest_annotation_by_upload = _load_latest_annotation_by_upload_ids(session, upload_ids=upload_ids)
    total, suspected, elevated, suspected_users, elevated_users = _summarize_tiered_uploads(
        rows,
        latest_annotation_by_upload=latest_annotation_by_upload,
    )
    return today, total, suspected, elevated, suspected_users, elevated_users


def get_age_histogram(
    session: Session,
    *,
    bucket_size: int,
    include_inactive: bool = False,
    accessible_patient_ids: set[int] | None = None,
) -> list[tuple[int, int]]:
    query: Select = select(Patient.birth_date)
    if not include_inactive:
        query = query.where(Patient.is_active.is_(True))
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        query = query.where(Patient.id.in_(accessible_patient_ids))
    birth_dates = session.execute(query).scalars().all()
    bucket_counts: dict[int, int] = defaultdict(int)
    for birth_date in birth_dates:
        age = calculate_age(birth_date)
        if age is None:
            continue
        bucket_start = (age // bucket_size) * bucket_size
        bucket_counts[bucket_start] += 1
    return sorted((start, count) for start, count in bucket_counts.items())


def get_active_users_series(
    session: Session,
    *,
    active_window_days: int,
    lookback_days: int,
    interval: str,
    accessible_patient_ids: set[int] | None = None,
) -> list[tuple[str, int]]:
    end_date, _, _ = resolve_taipei_day_bounds()
    start_date = end_date - timedelta(days=lookback_days - 1)
    query_start_date = start_date - timedelta(days=active_window_days - 1)
    query_start = datetime.combine(query_start_date, time.min, tzinfo=TAIPEI_TIMEZONE).astimezone(timezone.utc)

    query: Select = (
        select(Upload.patient_id, Upload.created_at)
        .join(Patient, Patient.id == Upload.patient_id)
        .where(Upload.created_at >= query_start)
    )
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        query = query.where(Patient.id.in_(accessible_patient_ids))
    rows = session.execute(query).all()
    uploads_by_patient: dict[int, set[date]] = defaultdict(set)
    for patient_id, upload_created_at in rows:
        uploads_by_patient[int(patient_id)].add(to_taipei_date(upload_created_at))

    points: list[tuple[str, int]] = []
    cursor = start_date
    while cursor <= end_date:
        window_start = cursor - timedelta(days=active_window_days - 1)
        active_count = 0
        for upload_days in uploads_by_patient.values():
            if any(window_start <= uploaded_at <= cursor for uploaded_at in upload_days):
                active_count += 1
        points.append((cursor.isoformat(), active_count))
        cursor += timedelta(days=1)

    if interval != "week":
        return points

    weekly: dict[date, tuple[str, int]] = {}
    for day_str, count in points:
        day = date.fromisoformat(day_str)
        week_start = day - timedelta(days=day.weekday())
        existing = weekly.get(week_start)
        if existing is None or day_str > existing[0]:
            weekly[week_start] = (day_str, count)
    return [weekly[key] for key in sorted(weekly.keys())]


def get_daily_suspected_series(
    session: Session,
    *,
    lookback_days: int,
    accessible_patient_ids: set[int] | None = None,
) -> list[tuple[str, int, int, int]]:
    end_date, _, _ = resolve_taipei_day_bounds()
    start_date = end_date - timedelta(days=lookback_days - 1)
    start_dt = datetime.combine(start_date, time.min, tzinfo=TAIPEI_TIMEZONE).astimezone(timezone.utc)
    query: Select = (
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .join(Patient, Patient.id == Upload.patient_id)
        .where(Upload.created_at >= start_dt, AIResult.screening_result != "rejected")
    )
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        query = query.where(Patient.id.in_(accessible_patient_ids))
    rows = session.execute(query).all()
    upload_ids = {upload.id for upload, _ in rows}
    latest_annotation_by_upload = _load_latest_annotation_by_upload_ids(session, upload_ids=upload_ids)

    by_day: dict[str, tuple[int, int, int]] = {}
    for upload, ai_result in rows:
        day_key = to_taipei_date(upload.created_at).isoformat()
        total, suspected, elevated = by_day.get(day_key, (0, 0, 0))
        tier = _tier_for_upload(
            upload=upload,
            screening_result=ai_result.screening_result,
            annotation=latest_annotation_by_upload.get(upload.id),
        )
        by_day[day_key] = (
            total + 1,
            suspected + (1 if tier == "suspected" else 0),
            elevated + (1 if tier == "elevated" else 0),
        )

    points: list[tuple[str, int, int, int]] = []
    cursor = start_date
    while cursor <= end_date:
        day = cursor.isoformat()
        total, suspected, elevated = by_day.get(day, (0, 0, 0))
        points.append((day, total, suspected, elevated))
        cursor += timedelta(days=1)
    return points
