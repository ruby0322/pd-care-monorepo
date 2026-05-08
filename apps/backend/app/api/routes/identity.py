from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.schemas.identity import BindIdentityRequest, IdentityBindResponse, IdentityStatusResponse
from app.services.identity import bind_identity, get_identity_status


router = APIRouter(tags=["Identity"])


def _get_session(request: Request) -> Session:
    session_factory = getattr(request.app.state, "db_session_factory", None)
    if session_factory is None:
        raise HTTPException(status_code=503, detail="Database is not initialized")
    return session_factory()


@router.post("/v1/identity/bind", response_model=IdentityBindResponse)
async def bind_patient_identity(request: Request, payload: BindIdentityRequest) -> IdentityBindResponse:
    session = _get_session(request)
    try:
        status, patient_id, can_upload = bind_identity(
            session,
            line_user_id=payload.line_user_id,
            display_name=payload.display_name,
            picture_url=payload.picture_url,
            case_number=payload.case_number,
            birth_date=payload.birth_date,
        )
        return IdentityBindResponse(status=status, patient_id=patient_id, can_upload=can_upload)
    finally:
        session.close()


@router.get("/v1/identity/bind/status", response_model=IdentityStatusResponse)
async def patient_identity_status(
    request: Request,
    line_user_id: str = Query(..., min_length=1, max_length=128),
) -> IdentityStatusResponse:
    session = _get_session(request)
    try:
        status, patient_id, can_upload = get_identity_status(session, line_user_id=line_user_id)
        return IdentityStatusResponse(status=status, patient_id=patient_id, can_upload=can_upload)
    finally:
        session.close()
