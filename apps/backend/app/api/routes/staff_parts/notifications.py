from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import bearer_scheme, get_current_principal, require_staff_or_admin
from app.db.models import AIResult, Patient
from app.schemas.staff_dashboard import (
    StaffNotificationItem,
    StaffNotificationListResponse,
)
from app.services.notifications import (
    list_staff_notifications,
    mark_staff_notification_read,
)

from .shared import get_accessible_patient_ids, get_staff_session

router = APIRouter(tags=["Staff"])


@router.get("/v1/staff/notifications")
async def staff_notifications(
    request: Request,
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffNotificationListResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    accessible_patient_ids = get_accessible_patient_ids(
        session,
        role=principal.role,
        identity_id=principal.identity_id,
    )
    rows, total, unread_count = list_staff_notifications(
        session,
        limit=limit,
        offset=offset,
        accessible_patient_ids=accessible_patient_ids,
    )
    return StaffNotificationListResponse(
        items=[
            StaffNotificationItem(
                id=row.notification.id,
                patient_id=row.notification.patient_id,
                patient_case_number=row.patient.case_number,
                patient_full_name=row.patient.full_name,
                upload_id=row.notification.upload_id,
                ai_result_id=row.notification.ai_result_id,
                screening_result=row.ai_result.screening_result if row.ai_result else None,
                probability=row.ai_result.probability if row.ai_result else None,
                summary=row.notification.summary,
                status=row.notification.status,
                created_at=row.notification.created_at,
            )
            for row in rows
        ],
        total=total,
        unread_count=unread_count,
        limit=limit,
        offset=offset,
    )


@router.post("/v1/staff/notifications/{notification_id}/read", response_model=StaffNotificationItem)
async def mark_staff_notification_as_read(
    request: Request,
    notification_id: int,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffNotificationItem:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    accessible_patient_ids = get_accessible_patient_ids(
        session,
        role=principal.role,
        identity_id=principal.identity_id,
    )
    try:
        notification = mark_staff_notification_read(
            session,
            notification_id=notification_id,
            accessible_patient_ids=accessible_patient_ids,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    patient = session.get(Patient, notification.patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    ai_result = notification.ai_result_id and session.get(AIResult, notification.ai_result_id)
    return StaffNotificationItem(
        id=notification.id,
        patient_id=notification.patient_id,
        patient_case_number=patient.case_number,
        patient_full_name=patient.full_name,
        upload_id=notification.upload_id,
        ai_result_id=notification.ai_result_id,
        screening_result=ai_result.screening_result if ai_result else None,
        probability=ai_result.probability if ai_result else None,
        summary=notification.summary,
        status=notification.status,
        created_at=notification.created_at,
    )
