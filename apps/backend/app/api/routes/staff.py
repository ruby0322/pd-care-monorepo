from __future__ import annotations

from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select

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
    StaffPatientDetailResponse,
    StaffPatientListResponse,
    StaffPendingBindingItem,
    StaffPendingBindingLinkRequest,
    StaffPendingBindingListResponse,
    StaffPendingCandidatePatient,
    StaffPatientSummary,
    StaffUploadQueueItem,
    StaffUploadQueueResponse,
    StaffUploadRecord,
)
from app.db.models import LiffIdentity, Patient, PendingBinding, Upload
from app.services.staff_dashboard import (
    calculate_age,
    link_pending_binding,
    list_annotations_for_patient,
    list_patient_upload_records,
    list_pending_bindings,
    list_staff_patients,
    list_upload_queue,
    update_pending_binding_status,
    upsert_annotation_for_upload,
)

router = APIRouter(tags=["Staff"])


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


@router.get("/v1/staff/notifications")
async def staff_notifications(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> dict[str, object]:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    # Task 7 boundary endpoint: data integration is handled in Phase 1 Task 8.
    return {"items": [], "role": principal.role}


@router.get("/v1/staff/patients", response_model=StaffPatientListResponse)
async def get_staff_patients(
    request: Request,
    months: int = Query(default=12, ge=1, le=60),
    age_min: int | None = Query(default=None, ge=0),
    age_max: int | None = Query(default=None, ge=0),
    infection_status: str = Query(default="all", pattern="^(all|suspected|normal)$"),
    sort_key: str = Query(default="latest_upload", pattern="^(latest_upload|case_number|upload_count|suspected_count|age)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    credentials=Depends(bearer_scheme),
) -> StaffPatientListResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_staff_patients(
            session,
            months=months,
            age_min=age_min,
            age_max=age_max,
            infection_status=infection_status,
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
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        patient = session.get(Patient, patient_id)
        if patient is None:
            raise HTTPException(status_code=404, detail="Patient not found")

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
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_upload_queue(session, limit=limit, suspected_only=suspected_only)
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
    require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        try:
            pending = link_pending_binding(session, pending_id=pending_id, patient_id=payload.patient_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"status": pending.status}
    finally:
        session.close()


@router.post("/v1/staff/pending-bindings/{pending_id}/approve")
async def approve_pending_binding_route(
    request: Request,
    pending_id: int,
    credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    require_staff_or_admin(get_current_principal(request, credentials))
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
            "image_url": f"/v1/staff/uploads/{upload_id}/image-public?token={token}",
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
