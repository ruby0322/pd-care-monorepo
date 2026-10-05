from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import Select, case, delete, distinct, exists, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    AIResult,
    Annotation,
    AuthorizationAuditEvent,
    HealthcareAccessRequest,
    LiffIdentity,
    Patient,
    StaffPatientAssignment,
    Upload,
)
from app.services.attention_triage import workbench_upload_where_clauses
from app.services.identity_validation import assert_valid_line_user_id


@dataclass(frozen=True)
class StaffWorkloadStats:
    """Labeling workload for one staff/admin identity.

    Assigned uploads use the same eligibility rules as the review workbench, so the
    denominator matches what the reviewer actually sees in their queue.
    """

    assigned_patient_count: int
    assigned_upload_count: int
    labeled_assigned_upload_count: int
    reviewed_upload_count: int
    last_reviewed_at: datetime | None


def load_staff_workload_stats(
    session: Session,
    *,
    staff_identity_ids: list[int],
) -> dict[int, StaffWorkloadStats]:
    normalized_ids = {identity_id for identity_id in staff_identity_ids if identity_id > 0}
    if not normalized_ids:
        return {}

    assigned_patients = dict(
        session.execute(
            select(StaffPatientAssignment.staff_identity_id, func.count(StaffPatientAssignment.patient_id))
            .where(StaffPatientAssignment.staff_identity_id.in_(normalized_ids))
            .group_by(StaffPatientAssignment.staff_identity_id)
        ).all()
    )

    is_labeled = exists().where(Annotation.upload_id == Upload.id)
    upload_rows = session.execute(
        select(
            StaffPatientAssignment.staff_identity_id,
            func.count(Upload.id),
            func.coalesce(func.sum(case((is_labeled, 1), else_=0)), 0),
        )
        .select_from(StaffPatientAssignment)
        .join(Patient, Patient.id == StaffPatientAssignment.patient_id)
        .join(Upload, Upload.patient_id == Patient.id)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(StaffPatientAssignment.staff_identity_id.in_(normalized_ids), *workbench_upload_where_clauses())
        .group_by(StaffPatientAssignment.staff_identity_id)
    ).all()
    assigned_uploads = {int(staff_id): (int(total), int(labeled)) for staff_id, total, labeled in upload_rows}

    reviewed_rows = session.execute(
        select(
            Annotation.reviewer_identity_id,
            func.count(distinct(Annotation.upload_id)),
            func.max(Annotation.created_at),
        )
        .where(Annotation.reviewer_identity_id.in_(normalized_ids))
        .group_by(Annotation.reviewer_identity_id)
    ).all()
    reviewed = {int(staff_id): (int(count), last_at) for staff_id, count, last_at in reviewed_rows}

    result: dict[int, StaffWorkloadStats] = {}
    for identity_id in normalized_ids:
        assigned_upload_count, labeled_assigned_upload_count = assigned_uploads.get(identity_id, (0, 0))
        reviewed_upload_count, last_reviewed_at = reviewed.get(identity_id, (0, None))
        result[identity_id] = StaffWorkloadStats(
            assigned_patient_count=int(assigned_patients.get(identity_id, 0)),
            assigned_upload_count=assigned_upload_count,
            labeled_assigned_upload_count=labeled_assigned_upload_count,
            reviewed_upload_count=reviewed_upload_count,
            last_reviewed_at=last_reviewed_at,
        )
    return result


def create_or_replace_healthcare_permission_request(
    session: Session,
    *,
    line_user_id: str,
    display_name: str | None,
    picture_url: str | None,
) -> HealthcareAccessRequest:
    line_user_id = assert_valid_line_user_id(line_user_id)
    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id)
    ).scalar_one_or_none()
    if identity is None:
        identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name=display_name,
            picture_url=picture_url,
            role="patient",
            is_active=False,
        )
        session.add(identity)
        session.flush()
    else:
        identity.display_name = display_name
        identity.picture_url = picture_url

    current_pending = session.execute(
        select(HealthcareAccessRequest).where(
            HealthcareAccessRequest.requester_identity_id == identity.id,
            HealthcareAccessRequest.status == "pending",
        )
    ).scalar_one_or_none()
    if current_pending is not None:
        current_pending.created_at = datetime.now(tz=timezone.utc)
        session.commit()
        session.refresh(current_pending)
        return current_pending

    request = HealthcareAccessRequest(
        requester_identity_id=identity.id,
        status="pending",
    )
    session.add(request)
    session.commit()
    session.refresh(request)
    return request


def get_latest_healthcare_permission_request_status(
    session: Session,
    *,
    line_user_id: str,
) -> HealthcareAccessRequest | None:
    line_user_id = assert_valid_line_user_id(line_user_id)
    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id)
    ).scalar_one_or_none()
    if identity is None:
        return None
    return session.execute(
        select(HealthcareAccessRequest)
        .where(HealthcareAccessRequest.requester_identity_id == identity.id)
        .order_by(HealthcareAccessRequest.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def list_healthcare_permission_requests(
    session: Session,
    *,
    status: str | None,
) -> list[tuple[HealthcareAccessRequest, LiffIdentity]]:
    query: Select = (
        select(HealthcareAccessRequest, LiffIdentity)
        .join(LiffIdentity, LiffIdentity.id == HealthcareAccessRequest.requester_identity_id)
        .order_by(HealthcareAccessRequest.created_at.desc())
    )
    if status is not None:
        query = query.where(HealthcareAccessRequest.status == status)
    return list(session.execute(query).all())


def approve_healthcare_permission_request(
    session: Session,
    *,
    request_id: int,
    actor_identity_id: int,
    actor_role: str,
    role: str,
    reason: str | None,
) -> HealthcareAccessRequest:
    if actor_role != "admin":
        raise PermissionError("不可踰越階級：僅 admin 可授權角色")
    request = session.get(HealthcareAccessRequest, request_id)
    if request is None:
        raise LookupError("Healthcare permission request not found")
    if request.status != "pending":
        raise ValueError("Healthcare permission request is already resolved")

    identity = session.get(LiffIdentity, request.requester_identity_id)
    if identity is None:
        raise LookupError("Requester identity not found")

    before_role = identity.role
    identity.role = role
    identity.is_active = True
    request.status = "approved"
    request.decision_role = role
    request.reject_reason = None
    request.decided_by_identity_id = actor_identity_id
    request.decided_at = datetime.now(tz=timezone.utc)
    session.add(
        AuthorizationAuditEvent(
            actor_identity_id=actor_identity_id,
            actor_role=actor_role,
            target_identity_id=identity.id,
            action="healthcare_permission_approve",
            before_value=before_role,
            after_value=role,
            reason=reason,
        )
    )
    session.commit()
    session.refresh(request)
    return request


def reject_healthcare_permission_request(
    session: Session,
    *,
    request_id: int,
    actor_identity_id: int,
    actor_role: str,
    reason: str,
) -> HealthcareAccessRequest:
    if actor_role != "admin":
        raise PermissionError("不可踰越階級：僅 admin 可拒絕授權申請")
    request = session.get(HealthcareAccessRequest, request_id)
    if request is None:
        raise LookupError("Healthcare permission request not found")
    if request.status != "pending":
        raise ValueError("Healthcare permission request is already resolved")
    identity = session.get(LiffIdentity, request.requester_identity_id)
    if identity is None:
        raise LookupError("Requester identity not found")
    request.status = "rejected"
    request.reject_reason = reason
    request.decision_role = None
    request.decided_by_identity_id = actor_identity_id
    request.decided_at = datetime.now(tz=timezone.utc)
    session.add(
        AuthorizationAuditEvent(
            actor_identity_id=actor_identity_id,
            actor_role=actor_role,
            target_identity_id=identity.id,
            action="healthcare_permission_reject",
            before_value=identity.role,
            after_value=identity.role,
            reason=reason,
        )
    )
    session.commit()
    session.refresh(request)
    return request


def _build_list_identities_stmt(
    *,
    query: str | None,
    role: str | None,
    exclude_patient: bool,
    is_active: bool | None,
    created_from: date | None,
    created_to: date | None,
) -> Select:
    stmt: Select = select(LiffIdentity).order_by(LiffIdentity.created_at.desc())
    if query:
        q = f"%{query}%"
        stmt = stmt.where(
            or_(
                LiffIdentity.line_user_id.ilike(q),
                LiffIdentity.display_name.ilike(q),
                LiffIdentity.real_name.ilike(q),
            )
        )
    if role:
        stmt = stmt.where(LiffIdentity.role == role)
    if exclude_patient:
        stmt = stmt.where(LiffIdentity.role.in_(("staff", "admin")))
    if is_active is not None:
        stmt = stmt.where(LiffIdentity.is_active.is_(is_active))
    if created_from is not None:
        from_dt = datetime.combine(created_from, time.min, tzinfo=timezone.utc)
        stmt = stmt.where(LiffIdentity.created_at >= from_dt)
    if created_to is not None:
        to_dt = datetime.combine(created_to, time.min, tzinfo=timezone.utc) + timedelta(days=1)
        stmt = stmt.where(LiffIdentity.created_at < to_dt)
    return stmt


def list_identities(
    session: Session,
    *,
    query: str | None,
    role: str | None,
    exclude_patient: bool,
    is_active: bool | None,
    created_from: date | None,
    created_to: date | None,
    sort: str,
    limit: int,
    offset: int,
) -> tuple[list[LiffIdentity], int]:
    stmt = _build_list_identities_stmt(
        query=query,
        role=role,
        exclude_patient=exclude_patient,
        is_active=is_active,
        created_from=created_from,
        created_to=created_to,
    )
    total = int(session.execute(select(func.count()).select_from(stmt.subquery())).scalar_one() or 0)
    if sort == "assigned_count_desc":
        assigned_count = (
            select(func.count(StaffPatientAssignment.id))
            .where(StaffPatientAssignment.staff_identity_id == LiffIdentity.id)
            .correlate(LiffIdentity)
            .scalar_subquery()
        )
        display_name = func.lower(func.coalesce(LiffIdentity.real_name, LiffIdentity.display_name, LiffIdentity.line_user_id))
        stmt = stmt.order_by(None).order_by(assigned_count.desc(), display_name.asc(), LiffIdentity.id.asc())
    rows = session.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return rows, total


def preview_delete_inactive_identities(
    session: Session,
    *,
    identity_ids: list[int],
) -> dict[str, int]:
    requested_ids = {identity_id for identity_id in identity_ids if identity_id > 0}
    if not requested_ids:
        return {
            "requested_count": 0,
            "deletable_count": 0,
            "skipped_active_count": 0,
            "skipped_missing_count": 0,
        }
    rows = session.execute(
        select(LiffIdentity.id, LiffIdentity.is_active).where(LiffIdentity.id.in_(requested_ids))
    ).all()
    found_ids = {int(identity_id) for identity_id, _ in rows}
    deletable_count = sum(1 for _, is_active in rows if not is_active)
    skipped_active_count = sum(1 for _, is_active in rows if is_active)
    skipped_missing_count = len(requested_ids - found_ids)
    return {
        "requested_count": len(requested_ids),
        "deletable_count": deletable_count,
        "skipped_active_count": skipped_active_count,
        "skipped_missing_count": skipped_missing_count,
    }


def delete_inactive_identities(
    session: Session,
    *,
    identity_ids: list[int],
) -> dict[str, int]:
    preview = preview_delete_inactive_identities(session, identity_ids=identity_ids)
    if preview["deletable_count"] <= 0:
        return {
            "requested_count": preview["requested_count"],
            "deleted_count": 0,
            "skipped_active_count": preview["skipped_active_count"],
            "skipped_missing_count": preview["skipped_missing_count"],
        }
    target_ids = session.execute(
        select(LiffIdentity.id).where(
            LiffIdentity.id.in_({identity_id for identity_id in identity_ids if identity_id > 0}),
            LiffIdentity.is_active.is_(False),
        )
    ).scalars().all()
    if not target_ids:
        return {
            "requested_count": preview["requested_count"],
            "deleted_count": 0,
            "skipped_active_count": preview["skipped_active_count"],
            "skipped_missing_count": preview["skipped_missing_count"],
        }
    session.execute(delete(LiffIdentity).where(LiffIdentity.id.in_(set(int(identity_id) for identity_id in target_ids))))
    session.commit()
    return {
        "requested_count": preview["requested_count"],
        "deleted_count": len(target_ids),
        "skipped_active_count": preview["skipped_active_count"],
        "skipped_missing_count": preview["skipped_missing_count"],
    }


def update_identity_role(
    session: Session,
    *,
    actor_identity_id: int,
    actor_role: str,
    target_identity_id: int,
    role: str,
    reason: str | None,
) -> LiffIdentity:
    if actor_role != "admin":
        raise PermissionError("不可踰越階級：僅 admin 可調整角色")
    identity = session.get(LiffIdentity, target_identity_id)
    if identity is None:
        raise LookupError("Identity not found")
    before_role = identity.role
    identity.role = role
    session.add(
        AuthorizationAuditEvent(
            actor_identity_id=actor_identity_id,
            actor_role=actor_role,
            target_identity_id=identity.id,
            action="identity_role_update",
            before_value=before_role,
            after_value=role,
            reason=reason,
        )
    )
    session.commit()
    session.refresh(identity)
    return identity


def update_identity_status(
    session: Session,
    *,
    actor_identity_id: int,
    actor_role: str,
    target_identity_id: int,
    is_active: bool,
    reason: str | None,
) -> LiffIdentity:
    if actor_role != "admin":
        raise PermissionError("不可踰越階級：僅 admin 可調整帳號狀態")
    identity = session.get(LiffIdentity, target_identity_id)
    if identity is None:
        raise LookupError("Identity not found")
    before_value = "active" if identity.is_active else "inactive"
    identity.is_active = is_active
    after_value = "active" if is_active else "inactive"
    session.add(
        AuthorizationAuditEvent(
            actor_identity_id=actor_identity_id,
            actor_role=actor_role,
            target_identity_id=identity.id,
            action="identity_status_update",
            before_value=before_value,
            after_value=after_value,
            reason=reason,
        )
    )
    session.commit()
    session.refresh(identity)
    return identity


def update_identity_real_name(
    session: Session,
    *,
    actor_identity_id: int,
    actor_role: str,
    target_identity_id: int,
    real_name: str,
    reason: str | None,
) -> LiffIdentity:
    if actor_role != "admin":
        raise PermissionError("不可踰越階級：僅 admin 可調整姓名")
    identity = session.get(LiffIdentity, target_identity_id)
    if identity is None:
        raise LookupError("Identity not found")
    if identity.role not in {"staff", "admin"}:
        raise PermissionError("僅可編輯 staff/admin 的真實姓名")

    normalized_name = real_name.strip()
    if not normalized_name:
        raise ValueError("Real name cannot be empty")

    before_value = identity.real_name
    identity.real_name = normalized_name
    session.add(
        AuthorizationAuditEvent(
            actor_identity_id=actor_identity_id,
            actor_role=actor_role,
            target_identity_id=identity.id,
            action="identity_real_name_update",
            before_value=before_value,
            after_value=normalized_name,
            reason=reason,
        )
    )
    session.commit()
    session.refresh(identity)
    return identity
