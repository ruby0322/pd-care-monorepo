from __future__ import annotations

from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from botocore.exceptions import ClientError

from app.api.deps.auth import (
    bearer_scheme,
    get_current_principal,
    get_session,
    require_admin,
    require_staff_or_admin,
)
from app.schemas.staff_dashboard import (
    StaffAnnotationItem,
    StaffAnnotationListResponse,
    StaffAnnotationUpsertRequest,
    StaffNotificationItem,
    StaffNotificationListResponse,
    StaffPatientDetailResponse,
    StaffPatientListResponse,
    StaffPendingBindingItem,
    StaffPendingBindingLinkRequest,
    StaffPendingBindingCreatePatientRequest,
    StaffPendingBindingListResponse,
    StaffPatientStatusUpdateRequest,
    StaffPendingCandidatePatient,
    StaffPatientSummary,
    StaffUploadQueueItem,
    StaffUploadQueueResponse,
    StaffUploadRecord,
)
from app.schemas.admin_user_management import (
    AdminApproveHealthcarePermissionRequest,
    AdminHealthcarePermissionRequestItem,
    AdminHealthcarePermissionRequestListResponse,
    AdminIdentityItem,
    AdminIdentityListResponse,
    AdminRejectHealthcarePermissionRequest,
    AdminUpdateIdentityRoleRequest,
    AdminUpdateIdentityStatusRequest,
)
from app.db.models import AIResult, LiffIdentity, Patient, PendingBinding, Upload
from app.services.admin_user_management import (
    approve_healthcare_permission_request,
    list_healthcare_permission_requests,
    list_identities,
    reject_healthcare_permission_request,
    update_identity_role,
    update_identity_status,
)
from app.services.notifications import (
    list_staff_notifications,
    mark_staff_notification_read,
)
from app.services.staff_dashboard import (
    calculate_age,
    create_patient_and_link_pending_binding,
    ensure_staff_assignment,
    link_pending_binding,
    list_assigned_patient_ids,
    list_annotations_for_patient,
    list_patient_upload_records,
    list_pending_bindings,
    list_staff_patients,
    list_upload_queue,
    update_pending_binding_status,
    update_patient_active_status,
    upsert_annotation_for_upload,
)

router = APIRouter(tags=["Staff"])


def _get_accessible_patient_ids(session, *, role: str, identity_id: int) -> set[int] | None:
    if role == "admin":
        return None
    return list_assigned_patient_ids(session, staff_identity_id=identity_id)


def _assert_patient_access(session, *, role: str, identity_id: int, patient_id: int) -> None:
    if role == "admin":
        return
    allowed = list_assigned_patient_ids(session, staff_identity_id=identity_id)
    if patient_id not in allowed:
        raise HTTPException(status_code=403, detail="Forbidden: patient is not assigned to this staff")


@router.get("/v1/staff/me")
async def get_staff_profile(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    return {
        "line_user_id": principal.line_user_id,
        "role": principal.role,
    }


@router.get("/v1/staff/admin/probe")
async def admin_probe(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    principal = require_admin(get_current_principal(request, credentials))
    return {"status": "ok", "role": principal.role}


@router.get("/v1/staff/admin/users", response_model=AdminIdentityListResponse)
async def list_admin_users(
    request: Request,
    query: str | None = Query(default=None, min_length=1, max_length=128),
    role: str | None = Query(default=None, pattern="^(patient|staff|admin)$"),
    is_active: bool | None = Query(default=None),
    credentials=Depends(bearer_scheme),
) -> AdminIdentityListResponse:
    require_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_identities(session, query=query, role=role, is_active=is_active)
        return AdminIdentityListResponse(
            items=[
                AdminIdentityItem(
                    id=row.id,
                    line_user_id=row.line_user_id,
                    display_name=row.display_name,
                    role=row.role,  # type: ignore[arg-type]
                    is_active=row.is_active,
                    patient_id=row.patient_id,
                    created_at=row.created_at,
                )
                for row in rows
            ]
        )
    finally:
        session.close()


@router.post("/v1/staff/admin/users/{identity_id}/role", response_model=AdminIdentityItem)
async def update_admin_user_role(
    request: Request,
    identity_id: int,
    payload: AdminUpdateIdentityRoleRequest,
    credentials=Depends(bearer_scheme),
) -> AdminIdentityItem:
    principal = require_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            identity = update_identity_role(
                session,
                actor_identity_id=principal.identity_id,
                actor_role=principal.role,
                target_identity_id=identity_id,
                role=payload.role,
                reason=payload.reason,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        return AdminIdentityItem(
            id=identity.id,
            line_user_id=identity.line_user_id,
            display_name=identity.display_name,
            role=identity.role,  # type: ignore[arg-type]
            is_active=identity.is_active,
            patient_id=identity.patient_id,
            created_at=identity.created_at,
        )
    finally:
        session.close()


@router.post("/v1/staff/admin/users/{identity_id}/status", response_model=AdminIdentityItem)
async def update_admin_user_status(
    request: Request,
    identity_id: int,
    payload: AdminUpdateIdentityStatusRequest,
    credentials=Depends(bearer_scheme),
) -> AdminIdentityItem:
    principal = require_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            identity = update_identity_status(
                session,
                actor_identity_id=principal.identity_id,
                actor_role=principal.role,
                target_identity_id=identity_id,
                is_active=payload.is_active,
                reason=payload.reason,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        return AdminIdentityItem(
            id=identity.id,
            line_user_id=identity.line_user_id,
            display_name=identity.display_name,
            role=identity.role,  # type: ignore[arg-type]
            is_active=identity.is_active,
            patient_id=identity.patient_id,
            created_at=identity.created_at,
        )
    finally:
        session.close()


@router.get("/v1/staff/admin/access-requests", response_model=AdminHealthcarePermissionRequestListResponse)
async def list_admin_access_requests(
    request: Request,
    status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$"),
    credentials=Depends(bearer_scheme),
) -> AdminHealthcarePermissionRequestListResponse:
    require_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_healthcare_permission_requests(session, status=status)
        return AdminHealthcarePermissionRequestListResponse(
            items=[
                AdminHealthcarePermissionRequestItem(
                    id=access_request.id,
                    requester_identity_id=identity.id,
                    line_user_id=identity.line_user_id,
                    display_name=identity.display_name,
                    requester_role=identity.role,  # type: ignore[arg-type]
                    status=access_request.status,  # type: ignore[arg-type]
                    reject_reason=access_request.reject_reason,
                    decision_role=access_request.decision_role,  # type: ignore[arg-type]
                    created_at=access_request.created_at,
                    decided_at=access_request.decided_at,
                )
                for access_request, identity in rows
            ]
        )
    finally:
        session.close()


@router.post("/v1/staff/admin/access-requests/{request_id}/approve", response_model=AdminHealthcarePermissionRequestItem)
async def approve_admin_access_request(
    request: Request,
    request_id: int,
    payload: AdminApproveHealthcarePermissionRequest,
    credentials=Depends(bearer_scheme),
) -> AdminHealthcarePermissionRequestItem:
    principal = require_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            access_request = approve_healthcare_permission_request(
                session,
                request_id=request_id,
                actor_identity_id=principal.identity_id,
                actor_role=principal.role,
                role=payload.role,
                reason=payload.reason,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        identity = session.get(LiffIdentity, access_request.requester_identity_id)
        if identity is None:
            raise HTTPException(status_code=404, detail="Requester identity not found")
        return AdminHealthcarePermissionRequestItem(
            id=access_request.id,
            requester_identity_id=identity.id,
            line_user_id=identity.line_user_id,
            display_name=identity.display_name,
            requester_role=identity.role,  # type: ignore[arg-type]
            status=access_request.status,  # type: ignore[arg-type]
            reject_reason=access_request.reject_reason,
            decision_role=access_request.decision_role,  # type: ignore[arg-type]
            created_at=access_request.created_at,
            decided_at=access_request.decided_at,
        )
    finally:
        session.close()


@router.post("/v1/staff/admin/access-requests/{request_id}/reject", response_model=AdminHealthcarePermissionRequestItem)
async def reject_admin_access_request(
    request: Request,
    request_id: int,
    payload: AdminRejectHealthcarePermissionRequest,
    credentials=Depends(bearer_scheme),
) -> AdminHealthcarePermissionRequestItem:
    principal = require_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            access_request = reject_healthcare_permission_request(
                session,
                request_id=request_id,
                actor_identity_id=principal.identity_id,
                actor_role=principal.role,
                reason=payload.reason,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        identity = session.get(LiffIdentity, access_request.requester_identity_id)
        if identity is None:
            raise HTTPException(status_code=404, detail="Requester identity not found")
        return AdminHealthcarePermissionRequestItem(
            id=access_request.id,
            requester_identity_id=identity.id,
            line_user_id=identity.line_user_id,
            display_name=identity.display_name,
            requester_role=identity.role,  # type: ignore[arg-type]
            status=access_request.status,  # type: ignore[arg-type]
            reject_reason=access_request.reject_reason,
            decision_role=access_request.decision_role,  # type: ignore[arg-type]
            created_at=access_request.created_at,
            decided_at=access_request.decided_at,
        )
    finally:
        session.close()


@router.get("/v1/staff/notifications")
async def staff_notifications(
    request: Request,
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    credentials=Depends(bearer_scheme),
) -> StaffNotificationListResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows, total, unread_count = list_staff_notifications(session, limit=limit, offset=offset)
        return StaffNotificationListResponse(
            items=[
                StaffNotificationItem(
                    id=row.notification.id,
                    patient_id=row.notification.patient_id,
                    patient_case_number=row.patient.case_number,
                    patient_full_name=row.patient.full_name,
                    upload_id=row.notification.upload_id,
                    ai_result_id=row.notification.ai_result_id,
                    screening_result=row.ai_result.screening_result if row.ai_result else None,
                    probability=row.ai_result.probability if row.ai_result else None,
                    summary=row.notification.summary,
                    status=row.notification.status,
                    created_at=row.notification.created_at,
                )
                for row in rows
            ],
            total=total,
            unread_count=unread_count,
            limit=limit,
            offset=offset,
        )
    finally:
        session.close()


@router.post("/v1/staff/notifications/{notification_id}/read", response_model=StaffNotificationItem)
async def mark_staff_notification_as_read(
    request: Request,
    notification_id: int,
    credentials=Depends(bearer_scheme),
) -> StaffNotificationItem:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            notification = mark_staff_notification_read(session, notification_id=notification_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        patient = session.get(Patient, notification.patient_id)
        if patient is None:
            raise HTTPException(status_code=404, detail="Patient not found")
        ai_result = notification.ai_result_id and session.get(AIResult, notification.ai_result_id)
        return StaffNotificationItem(
            id=notification.id,
            patient_id=notification.patient_id,
            patient_case_number=patient.case_number,
            patient_full_name=patient.full_name,
            upload_id=notification.upload_id,
            ai_result_id=notification.ai_result_id,
            screening_result=ai_result.screening_result if ai_result else None,
            probability=ai_result.probability if ai_result else None,
            summary=notification.summary,
            status=notification.status,
            created_at=notification.created_at,
        )
    finally:
        session.close()


@router.get("/v1/staff/patients", response_model=StaffPatientListResponse)
async def get_staff_patients(
    request: Request,
    months: int = Query(default=12, ge=1, le=60),
    age_min: int | None = Query(default=None, ge=0),
    age_max: int | None = Query(default=None, ge=0),
    infection_status: str = Query(default="all", pattern="^(all|suspected|normal)$"),
    is_active_filter: str = Query(default="all", pattern="^(all|active|inactive)$"),
    sort_key: str = Query(default="latest_upload", pattern="^(latest_upload|case_number|upload_count|suspected_count|age)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    credentials=Depends(bearer_scheme),
) -> StaffPatientListResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        rows = list_staff_patients(
            session,
            months=months,
            age_min=age_min,
            age_max=age_max,
            infection_status=infection_status,
            is_active_filter=is_active_filter,
            accessible_patient_ids=accessible_patient_ids,
        )
        reverse = sort_dir == "desc"
        if sort_key == "case_number":
            rows.sort(key=lambda row: row.patient.case_number, reverse=reverse)
        elif sort_key == "upload_count":
            rows.sort(key=lambda row: row.upload_count, reverse=reverse)
        elif sort_key == "suspected_count":
            rows.sort(key=lambda row: row.suspected_count, reverse=reverse)
        elif sort_key == "age":
            rows.sort(key=lambda row: calculate_age(row.patient.birth_date) or -1, reverse=reverse)
        else:
            rows.sort(key=lambda row: row.latest_upload_at or row.patient.created_at, reverse=reverse)

        items = [
            StaffPatientSummary(
                patient_id=row.patient.id,
                case_number=row.patient.case_number,
                full_name=row.patient.full_name,
                line_user_id=row.line_user_id,
                age=calculate_age(row.patient.birth_date),
                upload_count=row.upload_count,
                suspected_count=row.suspected_count,
                latest_upload_at=row.latest_upload_at,
                is_active=row.patient.is_active,
            )
            for row in rows
        ]
        return StaffPatientListResponse(
            months=months,
            total_patients=len(items),
            total_uploads=sum(item.upload_count for item in items),
            suspected_patients=sum(1 for item in items if item.suspected_count > 0),
            items=items,
        )
    finally:
        session.close()


@router.get("/v1/staff/patients/{patient_id}", response_model=StaffPatientDetailResponse)
async def get_staff_patient_detail(
    request: Request,
    patient_id: int,
    credentials=Depends(bearer_scheme),
) -> StaffPatientDetailResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        patient = session.get(Patient, patient_id)
        if patient is None:
            raise HTTPException(status_code=404, detail="Patient not found")
        _assert_patient_access(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
            patient_id=patient_id,
        )

        uploads = list_patient_upload_records(session, patient_id=patient_id)
        line_user_id = session.execute(
            select(LiffIdentity.line_user_id).where(LiffIdentity.patient_id == patient_id).limit(1)
        ).scalars().first()
        return StaffPatientDetailResponse(
            patient_id=patient.id,
            case_number=patient.case_number,
            full_name=patient.full_name,
            birth_date=patient.birth_date,
            age=calculate_age(patient.birth_date),
            line_user_id=line_user_id,
            is_active=patient.is_active,
            total_uploads=len(uploads),
            suspected_uploads=sum(1 for _, ai_result, _ in uploads if ai_result.screening_result == "suspected"),
            rejected_uploads=sum(1 for _, ai_result, _ in uploads if ai_result.screening_result == "rejected"),
            uploads=[
                StaffUploadRecord(
                    upload_id=upload.id,
                    created_at=upload.created_at,
                    screening_result=ai_result.screening_result,
                    probability=ai_result.probability,
                    threshold=ai_result.threshold,
                    model_version=ai_result.model_version,
                    error_reason=ai_result.error_reason,
                    content_type=upload.content_type,
                    has_annotation=has_annotation,
                )
                for upload, ai_result, has_annotation in uploads
            ],
        )
    finally:
        session.close()


@router.get("/v1/staff/uploads/queue", response_model=StaffUploadQueueResponse)
async def get_staff_upload_queue(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    suspected_only: bool = Query(default=False),
    credentials=Depends(bearer_scheme),
) -> StaffUploadQueueResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        rows = list_upload_queue(
            session,
            limit=limit,
            suspected_only=suspected_only,
            accessible_patient_ids=accessible_patient_ids,
        )
        return StaffUploadQueueResponse(
            items=[
                StaffUploadQueueItem(
                    upload_id=upload.id,
                    patient_id=patient.id,
                    case_number=patient.case_number,
                    full_name=patient.full_name,
                    line_user_id=line_user_id,
                    created_at=upload.created_at,
                    screening_result=ai_result.screening_result,
                    probability=ai_result.probability,
                    has_annotation=has_annotation,
                )
                for upload, ai_result, patient, line_user_id, has_annotation in rows
            ]
        )
    finally:
        session.close()


@router.post("/v1/staff/uploads/{upload_id}/annotation", response_model=StaffAnnotationItem)
async def upsert_staff_annotation(
    request: Request,
    upload_id: int,
    payload: StaffAnnotationUpsertRequest,
    credentials=Depends(bearer_scheme),
) -> StaffAnnotationItem:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        reviewer = session.get(LiffIdentity, principal.identity_id)
        if reviewer is None:
            raise HTTPException(status_code=401, detail="Identity not found")
        try:
            annotation = upsert_annotation_for_upload(
                session,
                upload_id=upload_id,
                reviewer_identity_id=principal.identity_id,
                label=payload.label,
                comment=payload.comment,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return StaffAnnotationItem(
            id=annotation.id,
            upload_id=annotation.upload_id,
            patient_id=annotation.patient_id,
            label=annotation.label,
            comment=annotation.comment,
            reviewer_line_user_id=reviewer.line_user_id,
            created_at=annotation.created_at,
        )
    finally:
        session.close()


@router.get("/v1/staff/patients/{patient_id}/annotations", response_model=StaffAnnotationListResponse)
async def get_staff_annotations(
    request: Request,
    patient_id: int,
    credentials=Depends(bearer_scheme),
) -> StaffAnnotationListResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_annotations_for_patient(session, patient_id=patient_id)
        return StaffAnnotationListResponse(
            items=[
                StaffAnnotationItem(
                    id=annotation.id,
                    upload_id=annotation.upload_id,
                    patient_id=annotation.patient_id,
                    label=annotation.label,
                    comment=annotation.comment,
                    reviewer_line_user_id=line_user_id,
                    created_at=annotation.created_at,
                )
                for annotation, line_user_id in rows
            ]
        )
    finally:
        session.close()


@router.get("/v1/staff/pending-bindings", response_model=StaffPendingBindingListResponse)
async def get_pending_bindings(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> StaffPendingBindingListResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_pending_bindings(session)
        return StaffPendingBindingListResponse(
            items=[
                StaffPendingBindingItem(
                    id=pending.id,
                    line_user_id=pending.line_user_id,
                    case_number=pending.case_number,
                    birth_date=pending.birth_date,
                    status=pending.status,
                    created_at=pending.created_at,
                    candidates=[
                        StaffPendingCandidatePatient(
                            patient_id=patient.id,
                            case_number=patient.case_number,
                            full_name=patient.full_name,
                        )
                        for patient in candidates
                    ],
                )
                for pending, candidates in rows
            ]
        )
    finally:
        session.close()


@router.post("/v1/staff/pending-bindings/{pending_id}/link")
async def link_pending_binding_route(
    request: Request,
    pending_id: int,
    payload: StaffPendingBindingLinkRequest,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            pending = link_pending_binding(session, pending_id=pending_id, patient_id=payload.patient_id)
            if principal.role == "staff":
                ensure_staff_assignment(
                    session,
                    staff_identity_id=principal.identity_id,
                    patient_id=payload.patient_id,
                )
                session.commit()
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"status": pending.status}
    finally:
        session.close()


@router.post("/v1/staff/pending-bindings/{pending_id}/create-patient")
async def create_patient_and_link_pending_binding_route(
    request: Request,
    pending_id: int,
    payload: StaffPendingBindingCreatePatientRequest,
    credentials=Depends(bearer_scheme),
) -> dict[str, str | int]:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            pending, patient = create_patient_and_link_pending_binding(
                session,
                pending_id=pending_id,
                full_name=payload.full_name,
            )
            if principal.role == "staff":
                ensure_staff_assignment(
                    session,
                    staff_identity_id=principal.identity_id,
                    patient_id=patient.id,
                )
                session.commit()
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"status": pending.status, "patient_id": patient.id}
    finally:
        session.close()


@router.post("/v1/staff/pending-bindings/{pending_id}/approve")
async def approve_pending_binding_route(
    request: Request,
    pending_id: int,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        pending = session.get(PendingBinding, pending_id)
        if pending is None:
            raise HTTPException(status_code=404, detail="Pending binding not found")
        candidates = session.execute(
            select(Patient).where(
                Patient.case_number == pending.case_number,
                Patient.birth_date == pending.birth_date,
                Patient.is_active.is_(True),
            )
        ).scalars().all()
        if len(candidates) != 1:
            raise HTTPException(status_code=400, detail="Approval requires exactly one matched patient; use link endpoint")
        resolved = link_pending_binding(session, pending_id=pending_id, patient_id=candidates[0].id)
        if principal.role == "staff":
            ensure_staff_assignment(
                session,
                staff_identity_id=principal.identity_id,
                patient_id=candidates[0].id,
            )
            session.commit()
        return {"status": resolved.status}
    finally:
        session.close()


@router.post("/v1/staff/pending-bindings/{pending_id}/reject")
async def reject_pending_binding_route(
    request: Request,
    pending_id: int,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            pending = update_pending_binding_status(session, pending_id=pending_id, status="rejected")
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"status": pending.status}
    finally:
        session.close()


@router.get("/v1/staff/uploads/{upload_id}/image")
async def get_staff_upload_image(
    request: Request,
    upload_id: int,
    credentials=Depends(bearer_scheme),
) -> StreamingResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        upload = session.get(Upload, upload_id)
        if upload is None:
            raise HTTPException(status_code=404, detail="Upload not found")

        storage_service = getattr(request.app.state, "storage_service", None)
        if storage_service is None:
            raise HTTPException(status_code=503, detail="Storage is not initialized")
        stream = storage_service.open_image_stream(upload.object_key)
        if hasattr(stream, "iter_chunks"):
            iterator = stream.iter_chunks()
        else:
            data = stream.read()

            def _single_chunk() -> Iterator[bytes]:
                yield data

            iterator = _single_chunk()
        return StreamingResponse(iterator, media_type=upload.content_type)
    finally:
        session.close()


@router.get("/v1/staff/uploads/{upload_id}/image-access")
async def get_staff_upload_image_access(
    request: Request,
    upload_id: int,
    credentials=Depends(bearer_scheme),
) -> dict[str, object]:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        upload = session.get(Upload, upload_id)
        if upload is None:
            raise HTTPException(status_code=404, detail="Upload not found")
        storage_service = getattr(request.app.state, "storage_service", None)
        if storage_service is None:
            raise HTTPException(status_code=503, detail="Storage is not initialized")
        ttl_seconds = int(request.app.state.settings.image_access_token_ttl_seconds)
        token = storage_service.generate_access_token(upload.object_key, subject="staff", ttl_seconds=ttl_seconds)
        return {
            # Frontend production rewrite maps /api/* -> backend; return same-origin /api path to avoid 404 on Next.js routes.
            "image_url": f"/api/v1/staff/uploads/{upload_id}/image-public?token={token}",
            "expires_in": ttl_seconds,
        }
    finally:
        session.close()


@router.get("/v1/staff/uploads/{upload_id}/image-public")
async def get_staff_upload_image_public(
    request: Request,
    upload_id: int,
    token: str = Query(..., min_length=1),
) -> StreamingResponse:
    session = get_session(request)
    try:
        upload = session.get(Upload, upload_id)
        if upload is None:
            raise HTTPException(status_code=404, detail="Image not found")
        storage_service = getattr(request.app.state, "storage_service", None)
        if storage_service is None:
            raise HTTPException(status_code=503, detail="Storage is not initialized")
        is_valid = storage_service.validate_access_token(token, upload.object_key, subject="staff")
        if not is_valid:
            raise HTTPException(status_code=403, detail="Invalid or expired image token")
        try:
            stream = storage_service.open_image_stream(upload.object_key)
        except ClientError as exc:
            error_code = str(exc.response.get("Error", {}).get("Code", ""))
            if error_code in {"NoSuchKey", "NotFound", "404"}:
                raise HTTPException(status_code=404, detail="Image not found") from exc
            raise HTTPException(status_code=502, detail="Image storage request failed") from exc
        if hasattr(stream, "iter_chunks"):
            iterator = stream.iter_chunks()
        else:
            data = stream.read()

            def _single_chunk() -> Iterator[bytes]:
                yield data

            iterator = _single_chunk()
        return StreamingResponse(iterator, media_type=upload.content_type)
    finally:
        session.close()


@router.post("/v1/staff/patients/{patient_id}/status", response_model=StaffPatientSummary)
async def update_staff_patient_status(
    request: Request,
    patient_id: int,
    payload: StaffPatientStatusUpdateRequest,
    credentials=Depends(bearer_scheme),
) -> StaffPatientSummary:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        _assert_patient_access(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
            patient_id=patient_id,
        )
        try:
            patient = update_patient_active_status(
                session,
                patient_id=patient_id,
                is_active=payload.is_active,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        row = list_staff_patients(
            session,
            months=12,
            age_min=None,
            age_max=None,
            infection_status="all",
            is_active_filter="all",
            accessible_patient_ids=_get_accessible_patient_ids(
                session,
                role=principal.role,
                identity_id=principal.identity_id,
            ),
        )
        picked = next((item for item in row if item.patient.id == patient.id), None)
        if picked is None:
            raise HTTPException(status_code=403, detail="Forbidden: patient is not assigned to this staff")
        return StaffPatientSummary(
            patient_id=picked.patient.id,
            case_number=picked.patient.case_number,
            full_name=picked.patient.full_name,
            line_user_id=picked.line_user_id,
            age=calculate_age(picked.patient.birth_date),
            upload_count=picked.upload_count,
            suspected_count=picked.suspected_count,
            latest_upload_at=picked.latest_upload_at,
            is_active=picked.patient.is_active,
        )
    finally:
        session.close()
