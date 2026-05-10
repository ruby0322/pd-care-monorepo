from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.api.deps.auth import get_session
from app.schemas.auth import AuthTokenResponse, StaffLineLoginRequest
from app.services.auth import AuthService, AuthTokenService, LineIdentityProvider


router = APIRouter(tags=["Auth"])


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
            result = auth_service.login_staff_or_admin(
                session,
                line_id_token=payload.line_id_token,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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
