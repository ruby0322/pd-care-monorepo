from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import LiffIdentity
from app.services.auth.line_provider import LineIdentityProvider
from app.services.auth.token_service import AuthTokenService


@dataclass(frozen=True)
class AuthLoginResult:
    access_token: str
    expires_in: int
    role: str
    line_user_id: str


class AuthService:
    def __init__(self, *, line_provider: LineIdentityProvider, token_service: AuthTokenService, token_ttl_seconds: int) -> None:
        self._line_provider = line_provider
        self._token_service = token_service
        self._token_ttl_seconds = token_ttl_seconds

    def login_staff_or_admin(
        self,
        session: Session,
        *,
        line_id_token: str,
    ) -> AuthLoginResult:
        profile = self._line_provider.verify_id_token(line_id_token=line_id_token)
        identity = session.execute(
            select(LiffIdentity).where(LiffIdentity.line_user_id == profile.line_user_id)
        ).scalar_one_or_none()
        if identity is None:
            raise PermissionError("此 LINE 帳號尚未開通護理師或管理員權限")

        identity.display_name = profile.display_name
        identity.picture_url = profile.picture_url
        role = identity.role.strip().lower()
        if role not in {"staff", "admin"}:
            session.rollback()
            raise PermissionError("此帳號角色無法登入護理師後台")

        token = self._token_service.issue_token(
            identity_id=identity.id,
            line_user_id=identity.line_user_id,
            role=role,
            patient_id=identity.patient_id,
            ttl_seconds=self._token_ttl_seconds,
        )
        session.commit()
        return AuthLoginResult(
            access_token=token,
            expires_in=self._token_ttl_seconds,
            role=role,
            line_user_id=identity.line_user_id,
        )
