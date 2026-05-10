from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.schemas.upload_history import UploadHistoryDayResponse, UploadHistoryResponse
from app.services.identity import get_identity_status
from app.services.upload_history import summarize_patient_upload_history


router = APIRouter(tags=["Patient"])


def _get_session(request: Request) -> Session:
    session_factory = getattr(request.app.state, "db_session_factory", None)
    if session_factory is None:
        raise HTTPException(status_code=503, detail="Database is not initialized")
    return session_factory()


@router.get("/v1/patient/upload-history", response_model=UploadHistoryResponse)
async def patient_upload_history(
    request: Request,
    line_user_id: str = Query(..., min_length=1, max_length=128),
) -> UploadHistoryResponse:
    session = _get_session(request)
    try:
        status, patient_id, can_upload = get_identity_status(session, line_user_id=line_user_id)
        if status != "matched" or patient_id is None:
            return UploadHistoryResponse(status=status, patient_id=patient_id, can_upload=can_upload, days=[])

        days = summarize_patient_upload_history(session, patient_id=patient_id)
        return UploadHistoryResponse(
            status=status,
            patient_id=patient_id,
            can_upload=can_upload,
            days=[
                UploadHistoryDayResponse(
                    date=entry.date.isoformat(),
                    upload_count=entry.upload_count,
                    has_suspected_risk=entry.has_suspected_risk,
                )
                for entry in days
            ],
        )
    finally:
        session.close()
