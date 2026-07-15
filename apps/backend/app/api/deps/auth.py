from __future__ import annotations

from fastapi import HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.models import LiffIdentity, Patient
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
        token_principal = token_service.verify_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    session = get_session(request)
    try:
        identity = session.get(LiffIdentity, token_principal.identity_id)
        if identity is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identity not found")
        if identity.line_user_id != token_principal.line_user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token subject mismatch")
        if not identity.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Identity is inactive")

        role = identity.role.strip().lower()
        if role not in {"patient", "staff", "admin"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Identity role is not allowed")

        patient_id: int | None = None
        if identity.patient_id is not None:
            patient = session.get(Patient, identity.patient_id)
            if patient is not None and patient.is_active:
                patient_id = patient.id

        return AuthPrincipal(
            identity_id=identity.id,
            line_user_id=identity.line_user_id,
            role=role,
            patient_id=patient_id,
            expires_at=token_principal.expires_at,
        )
    finally:
        session.close()


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
