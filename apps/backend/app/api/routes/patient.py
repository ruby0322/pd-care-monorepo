from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from botocore.exceptions import ClientError

from app.api.deps.auth import bearer_scheme, get_current_principal
from app.db.models import Upload
from app.schemas.identity import PatientProfileResponse
from app.schemas.prescreen import PatientPrescreenResponse
from app.schemas.upload_history import (
    PatientMarkAllMessagesReadResponse,
    PatientMessageItemResponse,
    PatientMessageListResponse,
    PatientDayUploadItemResponse,
    PatientDayUploadListResponse,
    PatientUploadDetailResponse,
    UploadHistoryDayResponse,
    UploadHistoryResponse,
    UploadHistorySummary28dResponse,
)
from app.schemas.upload import PatientUploadResponse, PatientUploadResultResponse
from app.services.auth.token_service import AuthPrincipal
from app.services.identity import get_identity_profile_by_identity_id, get_identity_status_for_principal
from app.services.model_loader import LoadedModel
from app.services.prescreen import (
    LIVE_PRESCREEN_THRESHOLD_FACTOR,
    LoadedPrescreenModel,
    PrescreenInferenceError,
    is_exit_site_present,
)
from app.services.prescreen_inference_gate import (
    PrescreenInferenceBusyError,
    get_prescreen_inference_gate,
)
from app.services.prescreen_rate_limit import prescreen_rate_limiter
from app.services.storage import StorageService
from app.services.upload import get_patient_result_for_line_user, persist_patient_upload
from app.services.symptoms import derived_symptom_fields
from app.services.upload_history import (
    get_patient_upload_detail,
    list_patient_uploads_by_local_day,
    list_patient_annotation_messages,
    mark_all_patient_annotation_messages_read,
    mark_patient_annotation_message_read,
    summarize_patient_upload_history,
    summarize_patient_upload_metrics_28d,
)


router = APIRouter(tags=["Patient"])


def _get_session(request: Request) -> Session:
    session_factory = getattr(request.app.state, "db_session_factory", None)
    if session_factory is None:
        raise HTTPException(status_code=503, detail="Database is not initialized")
    return session_factory()


def _get_loaded_model(request: Request) -> LoadedModel:
    loaded: LoadedModel | None = getattr(request.app.state, "loaded_model", None)
    if loaded is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return loaded


def _get_storage_service(request: Request) -> StorageService:
    storage_service: StorageService | None = getattr(request.app.state, "storage_service", None)
    if storage_service is None:
        raise HTTPException(status_code=503, detail="Storage is not initialized")
    return storage_service


def _get_loaded_prescreen_model(request: Request) -> LoadedPrescreenModel | None:
    return getattr(request.app.state, "loaded_prescreen_model", None)


def _resolve_self_identity_status(
    session: Session,
    *,
    principal: AuthPrincipal,
) -> tuple[str, int | None, bool]:
    return get_identity_status_for_principal(session, principal=principal)


def _resolve_matched_patient_id(
    session: Session,
    *,
    principal: AuthPrincipal,
) -> int:
    status, patient_id, can_upload = _resolve_self_identity_status(session, principal=principal)
    if status != "matched" or patient_id is None or not can_upload:
        raise HTTPException(
            status_code=403,
            detail="Patient identity is not bound or pending approval; clinical uploads are not allowed",
        )
    return patient_id


def _normalize_screening_result(
    raw_result: str,
) -> Literal["normal", "suspected", "rejected", "technical_error"]:
    if raw_result == "normal":
        return "normal"
    if raw_result == "suspected":
        return "suspected"
    if raw_result == "rejected":
        return "rejected"
    return "technical_error"


def _reject_legacy_line_user_id(request: Request) -> None:
    if "line_user_id" in request.query_params:
        raise HTTPException(status_code=400, detail="line_user_id query parameter is no longer supported")


@router.get("/v1/patient/upload-history", response_model=UploadHistoryResponse)
async def patient_upload_history(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UploadHistoryResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    session = _get_session(request)
    try:
        status, patient_id, can_upload = _resolve_self_identity_status(session, principal=principal)
        if status != "matched" or patient_id is None:
            return UploadHistoryResponse(
                status=status,
                patient_id=patient_id,
                can_upload=can_upload,
                days=[],
                summary_28d=UploadHistorySummary28dResponse(
                    all_upload_count_28d=0,
                    suspected_upload_count_28d=0,
                    continuous_upload_streak_days=0,
                ),
            )

        days = summarize_patient_upload_history(session, patient_id=patient_id)
        summary_28d = summarize_patient_upload_metrics_28d(session, patient_id=patient_id)
        return UploadHistoryResponse(
            status=status,
            patient_id=patient_id,
            can_upload=can_upload,
            days=[
                UploadHistoryDayResponse(
                    date=entry.date.isoformat(),
                    upload_count=entry.upload_count,
                    has_suspected_risk=entry.has_suspected_risk,
                    has_symptom_elevated_risk=entry.has_symptom_elevated_risk,
                )
                for entry in days
            ],
            summary_28d=UploadHistorySummary28dResponse(
                all_upload_count_28d=summary_28d.all_upload_count_28d,
                suspected_upload_count_28d=summary_28d.suspected_upload_count_28d,
                continuous_upload_streak_days=summary_28d.continuous_upload_streak_days,
            ),
        )
    finally:
        session.close()


@router.get("/v1/patient/profile", response_model=PatientProfileResponse)
async def patient_profile(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientProfileResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    session = _get_session(request)
    try:
        status, patient_id, can_upload = _resolve_self_identity_status(session, principal=principal)
        try:
            profile = get_identity_profile_by_identity_id(session, identity_id=principal.identity_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        return PatientProfileResponse(
            status=status,
            can_upload=can_upload,
            line_user_id=profile.line_user_id,
            display_name=profile.display_name,
            picture_url=profile.picture_url,
            patient_id=patient_id,
            full_name=profile.full_name,
            case_number=profile.case_number,
            birth_date=profile.birth_date,
        )
    finally:
        session.close()


@router.get("/v1/patient/uploads/by-day", response_model=PatientDayUploadListResponse)
async def patient_uploads_by_day(
    request: Request,
    date_key: str = Query(alias="date", min_length=10, max_length=10),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientDayUploadListResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    try:
        local_day = date.fromisoformat(date_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format") from exc

    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, principal=principal)
        items = list_patient_uploads_by_local_day(session, patient_id=patient_id, local_day=local_day)
        return PatientDayUploadListResponse(
            date=local_day.isoformat(),
            items=[
                PatientDayUploadItemResponse(
                    upload_id=item.upload_id,
                    created_at=item.created_at,
                    screening_result=_normalize_screening_result(item.screening_result),
                    probability=item.probability,
                    threshold=item.threshold,
                    model_version=item.model_version,
                    error_reason=item.error_reason,
                    **derived_symptom_fields(
                        screening_result=item.screening_result,
                        symptom_pain=item.symptom_pain,
                        symptom_discharge=item.symptom_discharge,
                        symptom_pus=item.symptom_pus,
                        symptom_cloudy_dialysate=item.symptom_cloudy_dialysate,
                    ),
                    annotation_label=item.annotation_label,
                    annotation_comment=item.annotation_comment,
                )
                for item in items
            ],
        )
    finally:
        session.close()


@router.get("/v1/patient/uploads/{upload_id}/detail", response_model=PatientUploadDetailResponse)
async def patient_upload_detail(
    request: Request,
    upload_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadDetailResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, principal=principal)
        try:
            detail = get_patient_upload_detail(session, patient_id=patient_id, upload_id=upload_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        storage_service = _get_storage_service(request)
        ttl_seconds = int(request.app.state.settings.image_access_token_ttl_seconds)
        token = storage_service.generate_access_token(detail.object_key, subject="patient", ttl_seconds=ttl_seconds)
        image_url = f"/api/v1/patient/uploads/{detail.upload_id}/image-public?token={token}"

        return PatientUploadDetailResponse(
            upload_id=detail.upload_id,
            created_at=detail.created_at,
            date=detail.local_date.isoformat(),
            screening_result=_normalize_screening_result(detail.screening_result),
            probability=detail.probability,
            threshold=detail.threshold,
            model_version=detail.model_version,
            error_reason=detail.error_reason,
            **derived_symptom_fields(
                screening_result=detail.screening_result,
                symptom_pain=detail.symptom_pain,
                symptom_discharge=detail.symptom_discharge,
                symptom_pus=detail.symptom_pus,
                symptom_cloudy_dialysate=detail.symptom_cloudy_dialysate,
            ),
            annotation_label=detail.annotation_label,
            annotation_comment=detail.annotation_comment,
            image_url=image_url,
            image_expires_in=ttl_seconds,
            prev_upload_id=detail.prev_upload_id,
            next_upload_id=detail.next_upload_id,
        )
    finally:
        session.close()


@router.get("/v1/patient/uploads/{upload_id}/image-public")
async def patient_upload_image_public(
    request: Request,
    upload_id: int,
    token: str = Query(..., min_length=1),
) -> StreamingResponse:
    storage_service = _get_storage_service(request)
    session = _get_session(request)
    try:
        upload = session.get(Upload, upload_id)
        if upload is None:
            raise HTTPException(status_code=404, detail="Image not found")

        is_valid = storage_service.validate_access_token(token, upload.object_key, subject="patient")
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

            def _single_chunk():
                yield data

            iterator = _single_chunk()
        return StreamingResponse(iterator, media_type=upload.content_type)
    finally:
        session.close()


@router.get("/v1/patient/messages", response_model=PatientMessageListResponse)
async def patient_messages(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientMessageListResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, principal=principal)
        rows, total, unread_count = list_patient_annotation_messages(
            session,
            patient_id=patient_id,
            limit=limit,
            offset=offset,
            unread_only=unread_only,
        )
        storage_service = _get_storage_service(request)
        ttl_seconds = int(request.app.state.settings.image_access_token_ttl_seconds)
        items = []
        for row in rows:
            token = storage_service.generate_access_token(row.object_key, subject="patient", ttl_seconds=ttl_seconds)
            image_url = f"/api/v1/patient/uploads/{row.upload_id}/image-public?token={token}"
            items.append(
                PatientMessageItemResponse(
                    annotation_id=row.annotation_id,
                    upload_id=row.upload_id,
                    created_at=row.created_at,
                    label=row.label,
                    comment=row.comment,
                    is_read=row.is_read,
                    image_url=image_url,
                    image_expires_in=ttl_seconds,
                )
            )
        return PatientMessageListResponse(
            items=items,
            total=total,
            unread_count=unread_count,
            limit=limit,
            offset=offset,
        )
    finally:
        session.close()


@router.post("/v1/patient/messages/read-all", response_model=PatientMarkAllMessagesReadResponse)
async def mark_all_patient_messages_read(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientMarkAllMessagesReadResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, principal=principal)
        updated_count = mark_all_patient_annotation_messages_read(session, patient_id=patient_id)
        return PatientMarkAllMessagesReadResponse(updated_count=updated_count, unread_count=0)
    finally:
        session.close()


@router.post("/v1/patient/messages/{annotation_id}/read", response_model=PatientMessageItemResponse)
async def mark_patient_message_read(
    request: Request,
    annotation_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientMessageItemResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, principal=principal)
        try:
            annotation = mark_patient_annotation_message_read(
                session,
                patient_id=patient_id,
                annotation_id=annotation_id,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        upload = session.get(Upload, annotation.upload_id)
        if upload is None:
            raise HTTPException(status_code=404, detail="Upload not found")
        storage_service = _get_storage_service(request)
        ttl_seconds = int(request.app.state.settings.image_access_token_ttl_seconds)
        token = storage_service.generate_access_token(upload.object_key, subject="patient", ttl_seconds=ttl_seconds)
        image_url = f"/api/v1/patient/uploads/{upload.id}/image-public?token={token}"
        return PatientMessageItemResponse(
            annotation_id=annotation.id,
            upload_id=upload.id,
            created_at=annotation.created_at,
            label=annotation.label,
            comment=annotation.comment,
            is_read=True,
            image_url=image_url,
            image_expires_in=ttl_seconds,
        )
    finally:
        session.close()


@router.post("/v1/patient/prescreen", response_model=PatientPrescreenResponse)
async def prescreen_patient_image(
    request: Request,
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientPrescreenResponse:
    """Stateless presence check for live capture guidance. Does not persist."""
    principal = get_current_principal(request, credentials)
    settings = request.app.state.settings
    loaded_prescreen_model = _get_loaded_prescreen_model(request)

    content_type = (file.content_type or "").lower()
    if content_type not in settings.accepted_content_types:
        accepted = ", ".join(settings.accepted_content_types)
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content type {content_type!r}. Allowed: {accepted}",
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(payload) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded file exceeds MAX_UPLOAD_MB={settings.max_upload_mb}",
        )

    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, principal=principal)
    finally:
        session.close()

    if not prescreen_rate_limiter.allow(patient_id):
        raise HTTPException(status_code=429, detail="Prescreen rate limit exceeded; retry shortly")

    if not settings.prescreen_enabled or loaded_prescreen_model is None:
        return PatientPrescreenResponse(present=True, checked=False)

    try:
        live_threshold = loaded_prescreen_model.threshold * LIVE_PRESCREEN_THRESHOLD_FACTOR
        gate = get_prescreen_inference_gate(
            max_concurrent=settings.prescreen_max_concurrent,
            wait_timeout_seconds=settings.prescreen_inference_wait_seconds,
        )
        present = await gate.run(
            is_exit_site_present,
            loaded_prescreen_model,
            payload,
            threshold_override=live_threshold,
        )
    except (PrescreenInferenceError, PrescreenInferenceBusyError):
        return PatientPrescreenResponse(present=True, checked=False)

    return PatientPrescreenResponse(present=present, checked=True)


@router.post("/v1/patient/uploads", response_model=PatientUploadResponse)
async def upload_patient_image(
    request: Request,
    pain: bool = Form(default=False),
    discharge: bool = Form(default=False),
    pus: bool = Form(default=False),
    cloudy_dialysate: bool = Form(default=False),
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadResponse:
    principal = get_current_principal(request, credentials)
    form = await request.form()
    if "line_user_id" in form:
        raise HTTPException(status_code=400, detail="line_user_id form field is no longer supported")
    settings = request.app.state.settings
    loaded_model = _get_loaded_model(request)
    loaded_prescreen_model = _get_loaded_prescreen_model(request)
    storage_service = _get_storage_service(request)

    content_type = (file.content_type or "").lower()
    if content_type not in settings.accepted_content_types:
        accepted = ", ".join(settings.accepted_content_types)
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content type {content_type!r}. Allowed: {accepted}",
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(payload) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded file exceeds MAX_UPLOAD_MB={settings.max_upload_mb}",
        )

    session = _get_session(request)
    try:
        status, patient_id, can_upload = _resolve_self_identity_status(session, principal=principal)
        if status != "matched" or patient_id is None or not can_upload:
            raise HTTPException(
                status_code=403,
                detail="Patient identity is not bound or pending approval; clinical uploads are not allowed",
            )

        persisted = persist_patient_upload(
            session,
            settings=settings,
            loaded_model=loaded_model,
            loaded_prescreen_model=loaded_prescreen_model,
            storage_service=storage_service,
            patient_id=patient_id,
            content_type=content_type,
            filename=file.filename,
            image_bytes=payload,
            symptom_pain=pain,
            symptom_discharge=discharge,
            symptom_pus=pus,
            symptom_cloudy_dialysate=cloudy_dialysate,
        )
        return PatientUploadResponse(
            upload_id=persisted.upload.id,
            ai_result_id=persisted.ai_result.id,
            patient_id=patient_id,
            screening_result=persisted.ai_result.screening_result,
            model_version=persisted.ai_result.model_version,
            threshold=persisted.ai_result.threshold,
            notification_id=persisted.notification.id if persisted.notification else None,
            **derived_symptom_fields(
                screening_result=persisted.ai_result.screening_result,
                symptom_pain=persisted.upload.symptom_pain,
                symptom_discharge=persisted.upload.symptom_discharge,
                symptom_pus=persisted.upload.symptom_pus,
                symptom_cloudy_dialysate=persisted.upload.symptom_cloudy_dialysate,
            ),
            prediction=persisted.prediction,
        )
    finally:
        session.close()


@router.get("/v1/patient/uploads/result", response_model=PatientUploadResultResponse)
async def get_patient_upload_result(
    request: Request,
    upload_id: int | None = Query(default=None, ge=1),
    ai_result_id: int | None = Query(default=None, ge=1),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadResultResponse:
    _reject_legacy_line_user_id(request)
    principal = get_current_principal(request, credentials)
    if upload_id is None and ai_result_id is None:
        raise HTTPException(status_code=400, detail="Either upload_id or ai_result_id is required")

    session = _get_session(request)
    try:
        try:
            persisted = get_patient_result_for_line_user(
                session,
                line_user_id=principal.line_user_id,
                upload_id=upload_id,
                ai_result_id=ai_result_id,
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        return PatientUploadResultResponse(
            upload_id=persisted.upload.id,
            ai_result_id=persisted.ai_result.id,
            patient_id=persisted.upload.patient_id,
            screening_result=_normalize_screening_result(persisted.ai_result.screening_result),
            probability=persisted.ai_result.probability,
            threshold=persisted.ai_result.threshold,
            model_version=persisted.ai_result.model_version,
            error_reason=persisted.ai_result.error_reason,
            **derived_symptom_fields(
                screening_result=persisted.ai_result.screening_result,
                symptom_pain=persisted.upload.symptom_pain,
                symptom_discharge=persisted.upload.symptom_discharge,
                symptom_pus=persisted.upload.symptom_pus,
                symptom_cloudy_dialysate=persisted.upload.symptom_cloudy_dialysate,
            ),
            created_at=persisted.ai_result.created_at,
        )
    finally:
        session.close()
