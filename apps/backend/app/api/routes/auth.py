from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import get_session
from app.schemas.auth import AuthBootstrapResponse, AuthTokenResponse, StaffLineLoginRequest
from app.services.auth import AuthService, AuthTokenService, LineIdentityProvider
from app.services.auth.service import AuthFlowPermissionError


router = APIRouter(tags=["Auth"])


def _bootstrap_unavailable(message: str = "Auth bootstrap is temporarily unavailable") -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "BOOTSTRAP_UNAVAILABLE",
            "message": message,
        },
    )


def _get_bootstrap_session(request: Request) -> Session:
    session_factory = getattr(request.app.state, "db_session_factory", None)
    if session_factory is None:
        raise _bootstrap_unavailable("Database is not initialized")
    return session_factory()


def _build_auth_service(request: Request) -> AuthService:
    settings = request.app.state.settings
    return AuthService(
        line_provider=LineIdentityProvider(
            verify_mode=settings.line_verify_mode,
            channel_id=settings.line_channel_id,
            verify_endpoint=settings.line_verify_endpoint,
            timeout_seconds=settings.line_verify_timeout_seconds,
        ),
        token_service=AuthTokenService(secret=settings.auth_token_secret),
        token_ttl_seconds=settings.auth_token_ttl_seconds,
    )


@router.post("/v1/auth/login", response_model=AuthTokenResponse)
async def login_staff_or_admin(request: Request, payload: StaffLineLoginRequest) -> AuthTokenResponse:
    session = get_session(request)
    try:
        auth_service = _build_auth_service(request)
        try:
            result = auth_service.login_by_line_identity(
                session,
                line_id_token=payload.line_id_token,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except AuthFlowPermissionError as exc:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": exc.code,
                    "message": exc.detail,
                },
            ) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

        return AuthTokenResponse(
            access_token=result.access_token,
            expires_in=result.expires_in,
            role=result.role,
            line_user_id=result.line_user_id,
        )
    finally:
        session.close()


@router.post("/v1/auth/bootstrap", response_model=AuthBootstrapResponse)
async def auth_bootstrap(request: Request, payload: StaffLineLoginRequest) -> AuthBootstrapResponse:
    session = _get_bootstrap_session(request)
    try:
        auth_service = _build_auth_service(request)
        try:
            result = auth_service.bootstrap_by_line_identity(
                session,
                line_id_token=payload.line_id_token,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        return AuthBootstrapResponse(
            line_user_id=result.line_user_id,
            identity_exists=result.identity_exists,
            role=result.role,
            is_active=result.is_active,
            patient_binding_status=result.patient_binding_status,
            healthcare_access_status=result.healthcare_access_status,
            next_step=result.next_step,
            allowed_apps=result.allowed_apps,  # type: ignore[arg-type]
        )
    finally:
        session.close()
