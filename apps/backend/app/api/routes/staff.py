from __future__ import annotations

from collections.abc import Iterator
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from botocore.exceptions import ClientError

from app.api.routes.staff_parts import (
    admin_assignments_analytics_router,
    admin_users_access_router,
    notifications_router,
)
from app.api.routes.staff_parts.shared import (
    assert_patient_access as _assert_patient_access,
    assert_upload_access as _assert_upload_access,
    get_accessible_patient_ids as _get_accessible_patient_ids,
)
from app.api.deps.auth import (
    bearer_scheme,
    get_current_principal,
    get_session,
    require_staff_or_admin,
)
from app.schemas.staff_dashboard import (
    StaffAnnotationItem,
    StaffAnnotationListResponse,
    StaffAnnotationUpsertRequest,
    StaffPatientCreateRequest,
    StaffPatientCreateResponse,
    StaffPatientDetailResponse,
    StaffPatientListResponse,
    StaffPendingBindingItem,
    StaffPendingBindingLinkRequest,
    StaffPendingBindingCreatePatientRequest,
    StaffPendingBindingBulkRejectResponse,
    StaffPendingBindingListResponse,
    StaffPatientBulkDeleteImpact,
    StaffPatientBulkDeletePreviewResponse,
    StaffPatientBulkDeleteRequest,
    StaffPatientBulkDeleteResultResponse,
    StaffPatientStatusUpdateRequest,
    StaffPendingCandidatePatient,
    StaffPatientSummary,
    StaffUploadQueueItem,
    StaffUploadQueueResponse,
    StaffUploadRecord,
    StaffHistoryOverviewCalendarItem,
    StaffHistoryOverviewCalendarResponse,
    StaffHistoryOverviewDayItem,
    StaffHistoryOverviewDaysResponse,
    StaffHistoryOverviewKpi,
    StaffHistoryOverviewResponse,
    StaffHistoryOverviewUploadItem,
    StaffHistoryOverviewUserGroupItem,
)
from app.db.models import LiffIdentity, Patient, PendingBinding, Upload
from app.services.staff_dashboard import (
    bulk_reject_pending_bindings,
    calculate_age,
    create_patient_record,
    delete_inactive_patients,
    create_patient_and_link_pending_binding,
    DuplicatePatientError,
    ensure_staff_assignment,
    link_pending_binding,
    list_annotations_for_patient,
    list_patient_upload_records,
    list_pending_bindings,
    list_staff_patients,
    list_upload_queue,
    preview_delete_inactive_patients,
    update_pending_binding_status,
    update_patient_active_status,
    upsert_annotation_for_upload,
)
from app.services.staff_history_overview import (
    get_history_overview,
    get_history_overview_calendar_month,
    list_history_overview_days,
)

router = APIRouter(tags=["Staff"])


router.include_router(admin_users_access_router)
router.include_router(admin_assignments_analytics_router)
router.include_router(notifications_router)


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


@router.post("/v1/staff/patients", response_model=StaffPatientCreateResponse)
async def create_staff_patient(
    request: Request,
    payload: StaffPatientCreateRequest,
    credentials=Depends(bearer_scheme),
) -> StaffPatientCreateResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            patient = create_patient_record(
                session,
                case_number=payload.case_number,
                birth_date=payload.birth_date,
                full_name=payload.full_name,
                gender=payload.gender,
            )
            if principal.role == "staff":
                ensure_staff_assignment(
                    session,
                    staff_identity_id=principal.identity_id,
                    patient_id=patient.id,
                )
                session.commit()
        except DuplicatePatientError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return StaffPatientCreateResponse(
            patient_id=patient.id,
            case_number=patient.case_number,
            birth_date=patient.birth_date,
            full_name=patient.full_name,
            gender=patient.gender,  # type: ignore[arg-type]
            is_active=patient.is_active,
        )
    finally:
        session.close()


@router.get("/v1/staff/patients", response_model=StaffPatientListResponse)
async def get_staff_patients(
    request: Request,
    query: str | None = Query(default=None, min_length=1, max_length=128),
    months: int = Query(default=12, ge=1, le=60),
    age_min: int | None = Query(default=None, ge=0),
    age_max: int | None = Query(default=None, ge=0),
    infection_status: str = Query(default="all", pattern="^(all|suspected|normal)$"),
    binding_filter: str = Query(default="bound", pattern="^(bound|all|unbound_only)$"),
    is_active_filter: str = Query(default="all", pattern="^(all|active|inactive)$"),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
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
            query=query,
            months=months,
            age_min=age_min,
            age_max=age_max,
            infection_status=infection_status,
            binding_filter=binding_filter,
            is_active_filter=is_active_filter,
            created_from=created_from,
            created_to=created_to,
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

        total_patients = len(rows)
        total_uploads = sum(row.upload_count for row in rows)
        suspected_patients = sum(1 for row in rows if row.latest_upload_status == "suspected")
        paged_rows = rows[offset : offset + limit]

        items = [
            StaffPatientSummary(
                patient_id=row.patient.id,
                case_number=row.patient.case_number,
                full_name=row.patient.full_name,
                gender=row.patient.gender,  # type: ignore[arg-type]
                line_display_name=row.line_display_name,
                line_user_id=row.line_user_id,
                age=calculate_age(row.patient.birth_date),
                upload_count=row.upload_count,
                suspected_count=row.suspected_count,
                latest_upload_at=row.latest_upload_at,
                is_active=row.patient.is_active,
            )
            for row in paged_rows
        ]
        return StaffPatientListResponse(
            months=months,
            total_patients=total_patients,
            total_uploads=total_uploads,
            suspected_patients=suspected_patients,
            limit=limit,
            offset=offset,
            items=items,
        )
    finally:
        session.close()


@router.post("/v1/staff/patients/delete/preview", response_model=StaffPatientBulkDeletePreviewResponse)
async def preview_delete_staff_patients(
    request: Request,
    payload: StaffPatientBulkDeleteRequest,
    credentials=Depends(bearer_scheme),
) -> StaffPatientBulkDeletePreviewResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        result = preview_delete_inactive_patients(
            session,
            patient_ids=payload.patient_ids,
            accessible_patient_ids=accessible_patient_ids,
        )
        impact = result["impact"]
        assert isinstance(impact, dict)
        return StaffPatientBulkDeletePreviewResponse(
            requested_count=result["requested_count"],
            deletable_count=result["deletable_count"],
            skipped_active_count=result["skipped_active_count"],
            skipped_forbidden_count=result["skipped_forbidden_count"],
            skipped_missing_count=result["skipped_missing_count"],
            impact=StaffPatientBulkDeleteImpact(
                patients=int(impact["patients"]),
                uploads=int(impact["uploads"]),
                ai_results=int(impact["ai_results"]),
                annotations=int(impact["annotations"]),
                notifications=int(impact["notifications"]),
                assignments=int(impact["assignments"]),
            ),
        )
    finally:
        session.close()


@router.post("/v1/staff/patients/delete", response_model=StaffPatientBulkDeleteResultResponse)
async def delete_staff_patients(
    request: Request,
    payload: StaffPatientBulkDeleteRequest,
    credentials=Depends(bearer_scheme),
) -> StaffPatientBulkDeleteResultResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        result = delete_inactive_patients(
            session,
            patient_ids=payload.patient_ids,
            accessible_patient_ids=accessible_patient_ids,
        )
        impact = result["impact"]
        assert isinstance(impact, dict)
        return StaffPatientBulkDeleteResultResponse(
            requested_count=result["requested_count"],
            deleted_count=result["deleted_count"],
            skipped_active_count=result["skipped_active_count"],
            skipped_forbidden_count=result["skipped_forbidden_count"],
            skipped_missing_count=result["skipped_missing_count"],
            impact=StaffPatientBulkDeleteImpact(
                patients=int(impact["patients"]),
                uploads=int(impact["uploads"]),
                ai_results=int(impact["ai_results"]),
                annotations=int(impact["annotations"]),
                notifications=int(impact["notifications"]),
                assignments=int(impact["assignments"]),
            ),
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
        line_identity = session.execute(
            select(LiffIdentity.display_name, LiffIdentity.line_user_id).where(LiffIdentity.patient_id == patient_id).limit(1)
        ).first()
        return StaffPatientDetailResponse(
            patient_id=patient.id,
            case_number=patient.case_number,
            full_name=patient.full_name,
            gender=patient.gender,  # type: ignore[arg-type]
            birth_date=patient.birth_date,
            age=calculate_age(patient.birth_date),
            line_display_name=line_identity[0] if line_identity else None,
            line_user_id=line_identity[1] if line_identity else None,
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
                    symptom_pain=upload.symptom_pain,
                    symptom_discharge=upload.symptom_discharge,
                    symptom_pus=upload.symptom_pus,
                )
                for upload, ai_result, patient, line_user_id, has_annotation in rows
            ]
        )
    finally:
        session.close()


@router.get("/v1/staff/uploads/history-overview/days", response_model=StaffHistoryOverviewDaysResponse)
async def get_staff_history_overview_days(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> StaffHistoryOverviewDaysResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        rows = list_history_overview_days(
            session,
            accessible_patient_ids=accessible_patient_ids,
        )
        return StaffHistoryOverviewDaysResponse(
            items=[
                StaffHistoryOverviewDayItem(
                    local_date=row.local_date.isoformat(),
                    upload_count=row.upload_count,
                    uploaded_users=row.uploaded_users,
                    suspected_infected_users=row.suspected_infected_users,
                    infection_rate=row.infection_rate,
                    risky_patient_count=row.risky_patient_count,
                    has_infection_risk=row.has_infection_risk,
                )
                for row in rows
            ]
        )
    finally:
        session.close()


@router.get("/v1/staff/uploads/history-overview", response_model=StaffHistoryOverviewResponse)
async def get_staff_history_overview(
    request: Request,
    local_date: date = Query(...),
    sort_by: str = Query(default="timeline", pattern="^(timeline|risk)$"),
    group_by_user: bool = Query(default=False),
    group_sort_by: str = Query(default="infection_risk", pattern="^(uploads|age|infection_risk)$"),
    credentials=Depends(bearer_scheme),
) -> StaffHistoryOverviewResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        data = get_history_overview(
            session,
            local_day=local_date,
            sort_by=sort_by,
            group_by_user=group_by_user,
            group_sort_by=group_sort_by,
            accessible_patient_ids=accessible_patient_ids,
        )
        return StaffHistoryOverviewResponse(
            local_date=data.local_date.isoformat(),
            sort_by="risk" if data.sort_by == "risk" else "timeline",
            group_by_user=data.group_by_user,
            group_sort_by=data.group_sort_by if data.group_sort_by in {"uploads", "age", "infection_risk"} else "infection_risk",
            kpi=StaffHistoryOverviewKpi(
                uploaded_users=data.uploaded_users,
                uploads=data.uploads,
                suspected_infected_users=data.suspected_infected_users,
                infection_rate=data.infection_rate,
            ),
            items=[
                StaffHistoryOverviewUploadItem(
                    upload_id=item.upload_id,
                    patient_id=item.patient_id,
                    case_number=item.case_number,
                    patient_full_name=item.patient_full_name,
                    gender=item.gender,  # type: ignore[arg-type]
                    line_user_id=item.line_user_id,
                    line_display_name=item.line_display_name,
                    real_name=item.real_name,
                    picture_url=item.picture_url,
                    age=item.age,
                    created_at=item.created_at,
                    screening_result=item.screening_result,
                    probability=item.probability,
                    threshold=item.threshold,
                    model_version=item.model_version,
                    symptom_pain=item.symptom_pain,
                    symptom_discharge=item.symptom_discharge,
                    symptom_pus=item.symptom_pus,
                    annotation_label=item.annotation_label,
                    annotation_comment=item.annotation_comment,
                    risk_rank=item.risk_rank,
                )
                for item in data.items
            ],
            groups=[
                StaffHistoryOverviewUserGroupItem(
                    patient_id=group.patient_id,
                    case_number=group.case_number,
                    patient_full_name=group.patient_full_name,
                    gender=group.gender,  # type: ignore[arg-type]
                    age=group.age,
                    line_user_id=group.line_user_id,
                    line_display_name=group.line_display_name,
                    real_name=group.real_name,
                    picture_url=group.picture_url,
                    upload_count=group.upload_count,
                    highest_risk_rank=group.highest_risk_rank,
                    highest_risk_count=group.highest_risk_count,
                    latest_upload_at=group.latest_upload_at,
                    uploads=[
                        StaffHistoryOverviewUploadItem(
                            upload_id=item.upload_id,
                            patient_id=item.patient_id,
                            case_number=item.case_number,
                            patient_full_name=item.patient_full_name,
                            gender=item.gender,  # type: ignore[arg-type]
                            line_user_id=item.line_user_id,
                            line_display_name=item.line_display_name,
                            real_name=item.real_name,
                            picture_url=item.picture_url,
                            age=item.age,
                            created_at=item.created_at,
                            screening_result=item.screening_result,
                            probability=item.probability,
                            threshold=item.threshold,
                            model_version=item.model_version,
                            symptom_pain=item.symptom_pain,
                            symptom_discharge=item.symptom_discharge,
                            symptom_pus=item.symptom_pus,
                            annotation_label=item.annotation_label,
                            annotation_comment=item.annotation_comment,
                            risk_rank=item.risk_rank,
                        )
                        for item in group.uploads
                    ],
                )
                for group in data.groups
            ],
        )
    finally:
        session.close()


@router.get("/v1/staff/uploads/history-overview/calendar", response_model=StaffHistoryOverviewCalendarResponse)
async def get_staff_history_overview_calendar(
    request: Request,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    credentials=Depends(bearer_scheme),
) -> StaffHistoryOverviewCalendarResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        accessible_patient_ids = _get_accessible_patient_ids(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
        )
        rows = get_history_overview_calendar_month(
            session,
            year=year,
            month=month,
            accessible_patient_ids=accessible_patient_ids,
        )
        return StaffHistoryOverviewCalendarResponse(
            year=year,
            month=month,
            items=[
                StaffHistoryOverviewCalendarItem(
                    local_date=item.local_date.isoformat(),
                    risky_patient_count=item.risky_patient_count,
                    has_infection_risk=item.has_infection_risk,
                )
                for item in rows
            ],
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
        _assert_upload_access(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
            upload_id=upload_id,
        )
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
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        _assert_patient_access(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
            patient_id=patient_id,
        )
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


@router.post("/v1/staff/pending-bindings/reject-all", response_model=StaffPendingBindingBulkRejectResponse)
async def reject_all_pending_bindings_route(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> StaffPendingBindingBulkRejectResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rejected_count = bulk_reject_pending_bindings(session)
        return StaffPendingBindingBulkRejectResponse(rejected_count=rejected_count)
    finally:
        session.close()


@router.get("/v1/staff/uploads/{upload_id}/image")
async def get_staff_upload_image(
    request: Request,
    upload_id: int,
    credentials=Depends(bearer_scheme),
) -> StreamingResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        upload = _assert_upload_access(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
            upload_id=upload_id,
        )

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
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        upload = _assert_upload_access(
            session,
            role=principal.role,
            identity_id=principal.identity_id,
            upload_id=upload_id,
        )
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
            query=None,
            months=12,
            age_min=None,
            age_max=None,
            infection_status="all",
            binding_filter="all",
            is_active_filter="all",
            created_from=None,
            created_to=None,
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
            gender=picked.patient.gender,  # type: ignore[arg-type]
            line_display_name=picked.line_display_name,
            line_user_id=picked.line_user_id,
            age=calculate_age(picked.patient.birth_date),
            upload_count=picked.upload_count,
            suspected_count=picked.suspected_count,
            latest_upload_at=picked.latest_upload_at,
            is_active=picked.patient.is_active,
        )
    finally:
        session.close()
