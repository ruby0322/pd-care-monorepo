from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.db.models import LiffIdentity, Patient, PendingBinding


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
        )
        session.add(identity)
    else:
        identity.display_name = display_name
        identity.picture_url = picture_url

    # Once a LINE user is bound to a patient, do not downgrade it back to pending.
    # This keeps access stable across repeated login/bind attempts.
    if identity.patient_id is not None:
        _resolve_pending_bindings(session, line_user_id=line_user_id)
        session.commit()
        return ("matched", identity.patient_id, True)

    if patient is not None:
        identity.patient_id = patient.id
        _resolve_pending_bindings(session, line_user_id=line_user_id)
        session.commit()
        return ("matched", patient.id, True)

    identity.patient_id = None
    existing_pending = session.execute(
        select(PendingBinding).where(
            PendingBinding.line_user_id == line_user_id,
            PendingBinding.case_number == case_number,
            PendingBinding.birth_date == birth_date,
            PendingBinding.status == "pending",
        )
    ).scalar_one_or_none()
    if existing_pending is None:
        session.add(
            PendingBinding(
                line_user_id=line_user_id,
                case_number=case_number,
                birth_date=birth_date,
                status="pending",
            )
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


def get_identity_status(session: Session, *, line_user_id: str) -> tuple[str, int | None, bool]:
    identity = session.execute(
        select(LiffIdentity).where(LiffIdentity.line_user_id == line_user_id)
    ).scalar_one_or_none()
    if identity and identity.patient_id is not None:
        return ("matched", identity.patient_id, True)

    has_pending = session.execute(
        select(PendingBinding.id).where(
            PendingBinding.line_user_id == line_user_id,
            PendingBinding.status == "pending",
        )
    ).scalar_one_or_none()
    if has_pending is not None:
        return ("pending", None, False)

    return ("unbound", None, False)


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
