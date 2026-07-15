from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.db.models import AuthorizationAuditEvent, LiffIdentity, Patient, PendingBinding
from app.services.auth.token_service import AuthPrincipal
from app.services.identity_validation import assert_valid_line_user_id


def _select_active_patient(case_number: str, birth_date: str) -> Select[tuple[Patient]]:
    return select(Patient).where(
        Patient.case_number == case_number,
        Patient.birth_date == birth_date,
        Patient.is_active.is_(True),
    )


def bind_identity(
    session: Session,
    *,
    line_user_id: str,
    display_name: str | None,
    picture_url: str | None,
    case_number: str,
    birth_date: str,
) -> tuple[str, int | None, bool]:
    line_user_id = assert_valid_line_user_id(line_user_id)
    patient_matches = session.execute(_select_active_patient(case_number, birth_date)).scalars().all()
    patient = patient_matches[0] if len(patient_matches) == 1 else None

    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id)
    ).scalar_one_or_none()

    if identity is None:
        identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name=display_name,
            picture_url=picture_url,
            patient_id=None,
            role="patient",
            is_active=False,
        )
        session.add(identity)
    else:
        identity.display_name = display_name
        identity.picture_url = picture_url

    before_patient_id = identity.patient_id

    # Once a LINE user is bound to a patient, do not downgrade it back to pending.
    # This keeps access stable across repeated login/bind attempts.
    if identity.patient_id is not None:
        active_patient = session.get(Patient, identity.patient_id)
        if active_patient is not None and active_patient.is_active:
            identity.is_active = True
            _resolve_pending_bindings(session, line_user_id=line_user_id)
            _record_patient_binding_audit(
                session,
                identity=identity,
                before_patient_id=before_patient_id,
                reason="identity_bind_reconfirm",
            )
            session.commit()
            return ("matched", identity.patient_id, True)
        identity.patient_id = None

    if patient is not None:
        identity.patient_id = patient.id
        identity.is_active = True
        _resolve_pending_bindings(session, line_user_id=line_user_id)
        _record_patient_binding_audit(
            session,
            identity=identity,
            before_patient_id=before_patient_id,
            reason="identity_bind_matched",
        )
        session.commit()
        return ("matched", patient.id, True)

    identity.patient_id = None
    if identity.role == "patient":
        identity.is_active = False
    _replace_existing_pending_bindings(session, line_user_id=line_user_id)
    session.add(
        PendingBinding(
            line_user_id=line_user_id,
            case_number=case_number,
            birth_date=birth_date,
            status="pending",
        )
    )
    _record_patient_binding_audit(
        session,
        identity=identity,
        before_patient_id=before_patient_id,
        reason="identity_bind_pending",
    )
    session.commit()
    return ("pending", None, False)


def _resolve_pending_bindings(session: Session, *, line_user_id: str) -> None:
    pending_rows = session.execute(
        select(PendingBinding).where(
            PendingBinding.line_user_id == line_user_id,
            PendingBinding.status == "pending",
        )
    ).scalars().all()
    for pending in pending_rows:
        pending.status = "approved"


def _replace_existing_pending_bindings(session: Session, *, line_user_id: str) -> None:
    pending_rows = session.execute(
        select(PendingBinding).where(
            PendingBinding.line_user_id == line_user_id,
            PendingBinding.status == "pending",
        )
    ).scalars().all()
    for pending in pending_rows:
        pending.status = "replaced"


def get_identity_status(session: Session, *, line_user_id: str) -> tuple[str, int | None, bool]:
    line_user_id = assert_valid_line_user_id(line_user_id)
    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id)
    ).scalar_one_or_none()
    if identity and identity.patient_id is not None:
        before_patient_id = identity.patient_id
        patient = session.get(Patient, identity.patient_id)
        if patient is not None and patient.is_active:
            return ("matched", identity.patient_id, True)
        identity.patient_id = None
        if identity.role == "patient":
            identity.is_active = False
        _record_patient_binding_audit(
            session,
            identity=identity,
            before_patient_id=before_patient_id,
            reason="identity_status_unbound_inactive_patient",
        )
        session.commit()

    has_pending = session.execute(
        select(PendingBinding.id).where(
            PendingBinding.line_user_id == line_user_id,
            PendingBinding.status == "pending",
        )
    ).scalar_one_or_none()
    if has_pending is not None:
        return ("pending", None, False)

    return ("unbound", None, False)


def get_identity_status_for_principal(
    session: Session,
    *,
    principal: AuthPrincipal,
) -> tuple[str, int | None, bool]:
    if principal.patient_id is not None:
        patient = session.get(Patient, principal.patient_id)
        if patient is not None and patient.is_active:
            return ("matched", patient.id, True)

    has_pending = session.execute(
        select(PendingBinding.id).where(
            PendingBinding.line_user_id == principal.line_user_id,
            PendingBinding.status == "pending",
        )
    ).scalar_one_or_none()
    if has_pending is not None:
        return ("pending", None, False)

    return ("unbound", None, False)


def _record_patient_binding_audit(
    session: Session,
    *,
    identity: LiffIdentity,
    before_patient_id: int | None,
    reason: str,
) -> None:
    after_patient_id = identity.patient_id
    if before_patient_id == after_patient_id or identity.id is None:
        return
    session.add(
        AuthorizationAuditEvent(
            actor_identity_id=identity.id,
            actor_role=identity.role,
            target_identity_id=identity.id,
            action="identity_patient_binding_update",
            before_value=str(before_patient_id) if before_patient_id is not None else None,
            after_value=str(after_patient_id) if after_patient_id is not None else None,
            reason=reason,
        )
    )


@dataclass(frozen=True)
class IdentityProfile:
    line_user_id: str
    display_name: str | None
    picture_url: str | None
    patient_id: int | None
    full_name: str | None
    case_number: str | None
    birth_date: str | None


def get_identity_profile(session: Session, *, line_user_id: str) -> IdentityProfile:
    line_user_id = assert_valid_line_user_id(line_user_id)
    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id)
    ).scalar_one_or_none()
    if identity is None:
        raise LookupError("Identity not found")

    patient = session.get(Patient, identity.patient_id) if identity.patient_id is not None else None
    return IdentityProfile(
        line_user_id=identity.line_user_id,
        display_name=identity.display_name,
        picture_url=identity.picture_url,
        patient_id=identity.patient_id,
        full_name=patient.full_name if patient else None,
        case_number=patient.case_number if patient else None,
        birth_date=patient.birth_date if patient else None,
    )


def get_identity_profile_by_identity_id(session: Session, *, identity_id: int) -> IdentityProfile:
    identity = session.get(LiffIdentity, identity_id)
    if identity is None:
        raise LookupError("Identity not found")

    patient = session.get(Patient, identity.patient_id) if identity.patient_id is not None else None
    return IdentityProfile(
        line_user_id=identity.line_user_id,
        display_name=identity.display_name,
        picture_url=identity.picture_url,
        patient_id=identity.patient_id,
        full_name=patient.full_name if patient else None,
        case_number=patient.case_number if patient else None,
        birth_date=patient.birth_date if patient else None,
    )
