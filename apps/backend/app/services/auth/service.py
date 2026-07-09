from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import HealthcareAccessRequest, LiffIdentity, Patient, PendingBinding
from app.services.auth.line_provider import LineIdentityProfile
from app.services.auth.line_provider import LineIdentityProvider
from app.services.auth.token_service import AuthTokenService


@dataclass(frozen=True)
class AuthLoginResult:
    access_token: str
    expires_in: int
    role: str
    line_user_id: str


AuthNextStep = Literal[
    "role_select",
    "onboarding_patient",
    "onboarding_admin",
    "patient_app",
    "app_selection",
]
PatientBindingStatus = Literal["matched", "pending", "unbound"]
HealthcareAccessStatus = Literal["none", "pending", "approved", "rejected"]
RoleValue = Literal["patient", "staff", "admin"] | None


@dataclass(frozen=True)
class AuthBootstrapResult:
    line_user_id: str
    identity_exists: bool
    role: RoleValue
    is_active: bool
    patient_binding_status: PatientBindingStatus
    healthcare_access_status: HealthcareAccessStatus
    next_step: AuthNextStep
    allowed_apps: list[str]


class AuthFlowPermissionError(PermissionError):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class AuthService:
    def __init__(self, *, line_provider: LineIdentityProvider, token_service: AuthTokenService, token_ttl_seconds: int) -> None:
        self._line_provider = line_provider
        self._token_service = token_service
        self._token_ttl_seconds = token_ttl_seconds

    @staticmethod
    def _normalize_role(identity: LiffIdentity | None) -> RoleValue:
        if identity is None:
            return None
        role = identity.role.strip().lower()
        if role in {"patient", "staff", "admin"}:
            return role
        return None

    @staticmethod
    def _resolve_patient_binding_status(session: Session, line_user_id: str, identity: LiffIdentity | None) -> PatientBindingStatus:
        if identity is not None and identity.patient_id is not None:
            patient = session.get(Patient, identity.patient_id)
            if patient is not None and patient.is_active:
                return "matched"

        has_pending_binding = session.execute(
            select(PendingBinding.id).where(
                PendingBinding.line_user_id == line_user_id,
                PendingBinding.status == "pending",
            )
        ).scalar_one_or_none()
        if has_pending_binding is not None:
            return "pending"
        return "unbound"

    @staticmethod
    def _resolve_healthcare_access_status(session: Session, identity: LiffIdentity | None) -> HealthcareAccessStatus:
        if identity is None:
            return "none"
        latest_request = session.execute(
            select(HealthcareAccessRequest.status)
            .where(HealthcareAccessRequest.requester_identity_id == identity.id)
            .order_by(HealthcareAccessRequest.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest_request in {"pending", "approved", "rejected"}:
            return latest_request
        return "none"

    @staticmethod
    def _build_allowed_apps(*, role: RoleValue, is_active: bool, patient_binding_status: PatientBindingStatus) -> list[str]:
        allowed_apps: list[str] = []
        if role in {"staff", "admin"} and is_active:
            allowed_apps.append("admin")
        if patient_binding_status == "matched" and is_active:
            allowed_apps.append("patient")
        return allowed_apps

    @staticmethod
    def _resolve_next_step(
        *,
        identity_exists: bool,
        role: RoleValue,
        is_active: bool,
        patient_binding_status: PatientBindingStatus,
        healthcare_access_status: HealthcareAccessStatus,
    ) -> AuthNextStep:
        if not identity_exists:
            return "role_select"
        if role in {"staff", "admin"} and is_active:
            return "app_selection"
        if healthcare_access_status in {"pending", "rejected"}:
            return "onboarding_admin"
        if patient_binding_status in {"pending", "unbound"}:
            return "onboarding_patient"
        if role == "patient" and is_active and patient_binding_status == "matched":
            return "patient_app"
        return "role_select"

    def bootstrap_by_line_identity(
        self,
        session: Session,
        *,
        line_id_token: str,
    ) -> AuthBootstrapResult:
        profile = self._line_provider.verify_id_token(line_id_token=line_id_token)
        return self._build_bootstrap_by_profile(session, profile=profile)

    def _build_bootstrap_by_profile(
        self,
        session: Session,
        *,
        profile: LineIdentityProfile,
    ) -> AuthBootstrapResult:
        identity = session.execute(
            select(LiffIdentity).where(LiffIdentity.line_user_id == profile.line_user_id)
        ).scalar_one_or_none()

        role = self._normalize_role(identity)
        identity_exists = identity is not None and role is not None
        is_active = bool(identity.is_active) if identity is not None else False
        patient_binding_status = self._resolve_patient_binding_status(session, profile.line_user_id, identity)
        healthcare_access_status = self._resolve_healthcare_access_status(session, identity)
        next_step = self._resolve_next_step(
            identity_exists=identity_exists,
            role=role,
            is_active=is_active,
            patient_binding_status=patient_binding_status,
            healthcare_access_status=healthcare_access_status,
        )
        allowed_apps = self._build_allowed_apps(
            role=role,
            is_active=is_active,
            patient_binding_status=patient_binding_status,
        )
        return AuthBootstrapResult(
            line_user_id=profile.line_user_id,
            identity_exists=identity_exists,
            role=role,
            is_active=is_active,
            patient_binding_status=patient_binding_status,
            healthcare_access_status=healthcare_access_status,
            next_step=next_step,
            allowed_apps=allowed_apps,
        )

    def login_by_line_identity(
        self,
        session: Session,
        *,
        line_id_token: str,
    ) -> AuthLoginResult:
        profile = self._line_provider.verify_id_token(line_id_token=line_id_token)
        bootstrap = self._build_bootstrap_by_profile(session, profile=profile)
        if bootstrap.next_step not in {"patient_app", "app_selection"}:
            raise AuthFlowPermissionError(
                code="ONBOARDING_REQUIRED",
                detail="此帳號尚在註冊或審核流程中，請先完成 onboarding。",
            )
        identity = session.execute(
            select(LiffIdentity).where(LiffIdentity.line_user_id == bootstrap.line_user_id)
        ).scalar_one_or_none()
        if identity is None:
            raise AuthFlowPermissionError(
                code="IDENTITY_NOT_FOUND",
                detail="此 LINE 帳號尚未建立身份資料。",
            )

        identity.display_name = profile.display_name
        identity.picture_url = profile.picture_url
        role = identity.role.strip().lower()
        if role not in {"patient", "staff", "admin"}:
            session.rollback()
            raise AuthFlowPermissionError(
                code="ROLE_NOT_ALLOWED",
                detail="此帳號角色無法登入系統",
            )
        if not identity.is_active:
            session.rollback()
            raise AuthFlowPermissionError(
                code="IDENTITY_INACTIVE",
                detail="此帳號已停用，請聯絡管理員",
            )

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

    def login_staff_or_admin(
        self,
        session: Session,
        *,
        line_id_token: str,
    ) -> AuthLoginResult:
        result = self.login_by_line_identity(session, line_id_token=line_id_token)
        if result.role not in {"staff", "admin"}:
            session.rollback()
            raise PermissionError("此帳號角色無法登入護理師後台")
        return result
