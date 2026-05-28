from __future__ import annotations

from collections.abc import Generator

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import get_session
from app.db.models import Upload
from app.services.staff_dashboard import list_assigned_patient_ids


def get_staff_session(request: Request) -> Generator[Session, None, None]:
    session = get_session(request)
    try:
        yield session
    finally:
        session.close()


def get_accessible_patient_ids(session: Session, *, role: str, identity_id: int) -> set[int] | None:
    if role == "admin":
        return None
    return list_assigned_patient_ids(session, staff_identity_id=identity_id)


def assert_patient_access(session: Session, *, role: str, identity_id: int, patient_id: int) -> None:
    if role == "admin":
        return
    allowed = list_assigned_patient_ids(session, staff_identity_id=identity_id)
    if patient_id not in allowed:
        raise HTTPException(status_code=403, detail="Forbidden: patient is not assigned to this staff")


def get_upload_or_404(session: Session, *, upload_id: int) -> Upload:
    upload = session.get(Upload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    return upload


def assert_upload_access(session: Session, *, role: str, identity_id: int, upload_id: int) -> Upload:
    upload = get_upload_or_404(session, upload_id=upload_id)
    assert_patient_access(
        session,
        role=role,
        identity_id=identity_id,
        patient_id=upload.patient_id,
    )
    return upload
