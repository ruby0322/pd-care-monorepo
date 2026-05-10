from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api.deps.auth import bearer_scheme, get_optional_principal
from app.schemas.upload_history import UploadHistoryDayResponse, UploadHistoryResponse
from app.schemas.upload import PatientUploadResponse, PatientUploadResultResponse
from app.services.identity import get_identity_status
from app.services.model_loader import LoadedModel
from app.services.storage import StorageService
from app.services.upload import get_patient_result_for_line_user, persist_patient_upload
from app.services.upload_history import summarize_patient_upload_history


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
    request: Request,
    *,
    provided_line_user_id: str | None,
    credentials: HTTPAuthorizationCredentials | None,
) -> str:
    principal = get_optional_principal(request, credentials)
    if principal is None:
        if not provided_line_user_id:
            raise HTTPException(status_code=400, detail="line_user_id is required")
        return provided_line_user_id

    if principal.role == "staff":
        raise HTTPException(status_code=403, detail="Staff role cannot access patient endpoints")

    if principal.role == "admin":
        if provided_line_user_id:
            return provided_line_user_id
        return principal.line_user_id

    if provided_line_user_id and provided_line_user_id != principal.line_user_id:
        raise HTTPException(status_code=403, detail="Patient token cannot access another patient's records")
    return principal.line_user_id


@router.get("/v1/patient/upload-history", response_model=UploadHistoryResponse)
async def patient_upload_history(
    request: Request,
    line_user_id: str | None = Query(default=None, min_length=1, max_length=128),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> UploadHistoryResponse:
    resolved_line_user_id = _resolve_patient_line_user_id(
        request,
        provided_line_user_id=line_user_id,
        credentials=credentials,
    )
    session = _get_session(request)
    try:
        status, patient_id, can_upload = get_identity_status(session, line_user_id=resolved_line_user_id)
        if status != "matched" or patient_id is None:
            return UploadHistoryResponse(status=status, patient_id=patient_id, can_upload=can_upload, days=[])

        days = summarize_patient_upload_history(session, patient_id=patient_id)
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
        )
    finally:
        session.close()


@router.post("/v1/patient/uploads", response_model=PatientUploadResponse)
async def upload_patient_image(
    request: Request,
    line_user_id: str | None = Form(default=None, min_length=1, max_length=128),
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> PatientUploadResponse:
    resolved_line_user_id = _resolve_patient_line_user_id(
        request,
        provided_line_user_id=line_user_id,
        credentials=credentials,
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
    resolved_line_user_id = _resolve_patient_line_user_id(
        request,
        provided_line_user_id=line_user_id,
        credentials=credentials,
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

        raw_screening = persisted.ai_result.screening_result
        if raw_screening == "normal":
            screening_result = "normal"
        elif raw_screening == "suspected":
            screening_result = "suspected"
        elif raw_screening == "rejected":
            screening_result = "rejected"
        else:
            screening_result = "technical_error"

        return PatientUploadResultResponse(
            upload_id=persisted.upload.id,
            ai_result_id=persisted.ai_result.id,
            patient_id=persisted.upload.patient_id,
            screening_result=screening_result,
            probability=persisted.ai_result.probability,
            threshold=persisted.ai_result.threshold,
            model_version=persisted.ai_result.model_version,
            error_reason=persisted.ai_result.error_reason,
            created_at=persisted.ai_result.created_at,
        )
    finally:
        session.close()
