from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.orm import Session

from app.schemas.admin_user_management import (
    HealthcarePermissionRequestCreateRequest,
    HealthcarePermissionRequestCreateResponse,
    HealthcarePermissionRequestStatusRequest,
    HealthcarePermissionRequestStatusResponse,
)
from app.schemas.identity import BindIdentityRequest, IdentityBindResponse, IdentityStatusRequest, IdentityStatusResponse
from app.services.auth import LineIdentityProvider
from app.services.admin_user_management import (
    create_or_replace_healthcare_permission_request,
    get_latest_healthcare_permission_request_status,
)
from app.services.identity import bind_identity, get_identity_status


router = APIRouter(tags=["Identity"])


def _get_session(request: Request) -> Session:
    session_factory = getattr(request.app.state, "db_session_factory", None)
    if session_factory is None:
        raise HTTPException(status_code=503, detail="Database is not initialized")
    return session_factory()


def _build_line_provider(request: Request) -> LineIdentityProvider:
    settings = request.app.state.settings
    return LineIdentityProvider(
        verify_mode=settings.line_verify_mode,
        channel_id=settings.line_channel_id,
        verify_endpoint=settings.line_verify_endpoint,
        timeout_seconds=settings.line_verify_timeout_seconds,
    )


@router.post("/v1/identity/bind", response_model=IdentityBindResponse)
async def bind_patient_identity(request: Request, payload: BindIdentityRequest) -> IdentityBindResponse:
    session = _get_session(request)
    try:
        line_provider = _build_line_provider(request)
        try:
            profile = line_provider.verify_id_token(line_id_token=payload.line_id_token)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        status, patient_id, can_upload = bind_identity(
            session,
            line_user_id=profile.line_user_id,
            display_name=profile.display_name,
            picture_url=profile.picture_url,
            case_number=payload.case_number,
            birth_date=payload.birth_date,
        )
        return IdentityBindResponse(status=status, patient_id=patient_id, can_upload=can_upload)
    finally:
        session.close()


@router.post("/v1/identity/bind/status", response_model=IdentityStatusResponse)
async def patient_identity_status(
    request: Request,
    payload: IdentityStatusRequest,
) -> IdentityStatusResponse:
    session = _get_session(request)
    try:
        line_provider = _build_line_provider(request)
        try:
            profile = line_provider.verify_id_token(line_id_token=payload.line_id_token)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        status, patient_id, can_upload = get_identity_status(session, line_user_id=profile.line_user_id)
        return IdentityStatusResponse(status=status, patient_id=patient_id, can_upload=can_upload)
    finally:
        session.close()


@router.post("/v1/identity/healthcare-access-request", response_model=HealthcarePermissionRequestCreateResponse)
async def create_healthcare_access_request(
    request: Request,
    payload: HealthcarePermissionRequestCreateRequest,
) -> HealthcarePermissionRequestCreateResponse:
    session = _get_session(request)
    try:
        line_provider = _build_line_provider(request)
        try:
            profile = line_provider.verify_id_token(line_id_token=payload.line_id_token)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        access_request = create_or_replace_healthcare_permission_request(
            session,
            line_user_id=profile.line_user_id,
            display_name=profile.display_name,
            picture_url=profile.picture_url,
        )
        return HealthcarePermissionRequestCreateResponse(
            request_id=access_request.id,
            status=access_request.status,  # type: ignore[arg-type]
        )
    finally:
        session.close()


@router.post("/v1/identity/healthcare-access-request/status", response_model=HealthcarePermissionRequestStatusResponse)
async def get_healthcare_access_request_status(
    request: Request,
    payload: HealthcarePermissionRequestStatusRequest,
) -> HealthcarePermissionRequestStatusResponse:
    session = _get_session(request)
    try:
        line_provider = _build_line_provider(request)
        try:
            profile = line_provider.verify_id_token(line_id_token=payload.line_id_token)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        access_request = get_latest_healthcare_permission_request_status(session, line_user_id=profile.line_user_id)
        if access_request is None:
            return HealthcarePermissionRequestStatusResponse(
                status="none",
                reject_reason=None,
                decision_role=None,
            )
        return HealthcarePermissionRequestStatusResponse(
            status=access_request.status,  # type: ignore[arg-type]
            reject_reason=access_request.reject_reason,
            decision_role=access_request.decision_role,  # type: ignore[arg-type]
        )
    finally:
        session.close()
