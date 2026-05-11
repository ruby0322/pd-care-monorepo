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
from app.schemas.upload_history import (
    PatientDayUploadItemResponse,
    PatientDayUploadListResponse,
    PatientUploadDetailResponse,
    UploadHistoryDayResponse,
    UploadHistoryResponse,
    UploadHistorySummary28dResponse,
)
from app.schemas.upload import PatientUploadResponse, PatientUploadResultResponse
from app.services.auth.token_service import AuthPrincipal
from app.services.identity import get_identity_profile, get_identity_status
from app.services.model_loader import LoadedModel
from app.services.storage import StorageService
from app.services.upload import get_patient_result_for_line_user, persist_patient_upload
from app.services.upload_history import (
    get_patient_upload_detail,
    list_patient_uploads_by_local_day,
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


def _resolve_patient_line_user_id(
    *,
    principal: AuthPrincipal,
    provided_line_user_id: str | None,
) -> str:
    if principal.role == "staff":
        raise HTTPException(status_code=403, detail="Staff role cannot access patient endpoints")

    if principal.role == "admin":
        if provided_line_user_id:
            return provided_line_user_id
        return principal.line_user_id

    if provided_line_user_id and provided_line_user_id != principal.line_user_id:
        raise HTTPException(status_code=403, detail="Patient token cannot access another patient's records")
    return principal.line_user_id


def _resolve_matched_patient_id(session: Session, *, line_user_id: str) -> int:
    status, patient_id, can_upload = get_identity_status(session, line_user_id=line_user_id)
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


@router.get("/v1/patient/upload-history", response_model=UploadHistoryResponse)
async def patient_upload_history(
    request: Request,
    line_user_id: str | None = Query(default=None, min_length=1, max_length=128),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UploadHistoryResponse:
    principal = get_current_principal(request, credentials)
    resolved_line_user_id = _resolve_patient_line_user_id(
        principal=principal,
        provided_line_user_id=line_user_id,
    )
    session = _get_session(request)
    try:
        status, patient_id, can_upload = get_identity_status(session, line_user_id=resolved_line_user_id)
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
    line_user_id: str | None = Query(default=None, min_length=1, max_length=128),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientProfileResponse:
    principal = get_current_principal(request, credentials)
    resolved_line_user_id = _resolve_patient_line_user_id(
        principal=principal,
        provided_line_user_id=line_user_id,
    )
    session = _get_session(request)
    try:
        status, patient_id, can_upload = get_identity_status(session, line_user_id=resolved_line_user_id)
        try:
            profile = get_identity_profile(session, line_user_id=resolved_line_user_id)
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
    line_user_id: str | None = Query(default=None, min_length=1, max_length=128),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientDayUploadListResponse:
    principal = get_current_principal(request, credentials)
    resolved_line_user_id = _resolve_patient_line_user_id(
        principal=principal,
        provided_line_user_id=line_user_id,
    )
    try:
        local_day = date.fromisoformat(date_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must be in YYYY-MM-DD format") from exc

    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, line_user_id=resolved_line_user_id)
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
    line_user_id: str | None = Query(default=None, min_length=1, max_length=128),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadDetailResponse:
    principal = get_current_principal(request, credentials)
    resolved_line_user_id = _resolve_patient_line_user_id(
        principal=principal,
        provided_line_user_id=line_user_id,
    )
    session = _get_session(request)
    try:
        patient_id = _resolve_matched_patient_id(session, line_user_id=resolved_line_user_id)
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


@router.post("/v1/patient/uploads", response_model=PatientUploadResponse)
async def upload_patient_image(
    request: Request,
    line_user_id: str | None = Form(default=None, min_length=1, max_length=128),
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadResponse:
    principal = get_current_principal(request, credentials)
    resolved_line_user_id = _resolve_patient_line_user_id(
        principal=principal,
        provided_line_user_id=line_user_id,
    )
    settings = request.app.state.settings
    loaded_model = _get_loaded_model(request)
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
        status, patient_id, can_upload = get_identity_status(session, line_user_id=resolved_line_user_id)
        if status != "matched" or patient_id is None or not can_upload:
            raise HTTPException(
                status_code=403,
                detail="Patient identity is not bound or pending approval; clinical uploads are not allowed",
            )

        persisted = persist_patient_upload(
            session,
            settings=settings,
            loaded_model=loaded_model,
            storage_service=storage_service,
            patient_id=patient_id,
            content_type=content_type,
            filename=file.filename,
            image_bytes=payload,
        )
        return PatientUploadResponse(
            upload_id=persisted.upload.id,
            ai_result_id=persisted.ai_result.id,
            patient_id=patient_id,
            screening_result=persisted.ai_result.screening_result,
            model_version=persisted.ai_result.model_version,
            threshold=persisted.ai_result.threshold,
            notification_id=persisted.notification.id if persisted.notification else None,
            prediction=persisted.prediction,
        )
    finally:
        session.close()


@router.get("/v1/patient/uploads/result", response_model=PatientUploadResultResponse)
async def get_patient_upload_result(
    request: Request,
    line_user_id: str | None = Query(default=None, min_length=1, max_length=128),
    upload_id: int | None = Query(default=None, ge=1),
    ai_result_id: int | None = Query(default=None, ge=1),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadResultResponse:
    principal = get_current_principal(request, credentials)
    resolved_line_user_id = _resolve_patient_line_user_id(
        principal=principal,
        provided_line_user_id=line_user_id,
    )
    if upload_id is None and ai_result_id is None:
        raise HTTPException(status_code=400, detail="Either upload_id or ai_result_id is required")

    session = _get_session(request)
    try:
        try:
            persisted = get_patient_result_for_line_user(
                session,
                line_user_id=resolved_line_user_id,
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
            created_at=persisted.ai_result.created_at,
        )
    finally:
        session.close()
