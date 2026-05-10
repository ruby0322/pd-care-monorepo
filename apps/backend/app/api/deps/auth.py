from __future__ import annotations

from fastapi import HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.models import LiffIdentity
from app.services.auth import AuthPrincipal, AuthTokenService


bearer_scheme = HTTPBearer(auto_error=False)


def get_session(request: Request) -> Session:
    session_factory = getattr(request.app.state, "db_session_factory", None)
    if session_factory is None:
        raise HTTPException(status_code=503, detail="Database is not initialized")
    return session_factory()


def get_token_service(request: Request) -> AuthTokenService:
    settings = request.app.state.settings
    return AuthTokenService(secret=settings.auth_token_secret)


def get_current_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> AuthPrincipal:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    if credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication scheme")

    token_service = get_token_service(request)
    try:
        principal = token_service.verify_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return principal


def get_optional_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> AuthPrincipal | None:
    if credentials is None:
        return None
    return get_current_principal(request, credentials)


def require_staff_or_admin(principal: AuthPrincipal) -> AuthPrincipal:
    if principal.role not in {"staff", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff or admin role is required")
    return principal


def require_admin(principal: AuthPrincipal) -> AuthPrincipal:
    if principal.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role is required")
    return principal


def load_identity(session: Session, principal: AuthPrincipal) -> LiffIdentity:
    identity = session.get(LiffIdentity, principal.identity_id)
    if identity is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identity not found")
    return identity
