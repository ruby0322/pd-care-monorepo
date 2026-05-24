from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AIResult, Notification, Patient


@dataclass
class StaffNotificationRow:
    notification: Notification
    patient: Patient
    ai_result: AIResult | None


def list_staff_notifications(
    session: Session,
    *,
    limit: int,
    offset: int,
    accessible_patient_ids: set[int] | None = None,
) -> tuple[list[StaffNotificationRow], int, int]:
    if accessible_patient_ids is not None and not accessible_patient_ids:
        return [], 0, 0

    total_query = select(func.count(Notification.id))
    unread_query = select(func.count(Notification.id)).where(Notification.status == "new")
    rows_query = (
        select(Notification, Patient, AIResult)
        .join(Patient, Patient.id == Notification.patient_id)
        .join(AIResult, AIResult.id == Notification.ai_result_id, isouter=True)
    )
    if accessible_patient_ids is not None:
        scope_filter = Notification.patient_id.in_(accessible_patient_ids)
        total_query = total_query.where(scope_filter)
        unread_query = unread_query.where(scope_filter)
        rows_query = rows_query.where(scope_filter)

    total = session.execute(total_query).scalar_one()
    unread_count = session.execute(unread_query).scalar_one()
    rows = session.execute(
        rows_query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).offset(offset)
    ).all()
    items = [StaffNotificationRow(notification=notification, patient=patient, ai_result=ai_result) for notification, patient, ai_result in rows]
    return items, int(total), int(unread_count)


def mark_staff_notification_read(
    session: Session,
    *,
    notification_id: int,
    accessible_patient_ids: set[int] | None = None,
) -> Notification:
    notification = session.get(Notification, notification_id)
    if notification is None:
        raise LookupError("Notification not found")
    if accessible_patient_ids is not None and notification.patient_id not in accessible_patient_ids:
        raise PermissionError("Forbidden: patient is not assigned to this staff")
    if notification.status == "new":
        notification.status = "reviewed"
        session.commit()
        session.refresh(notification)
    return notification
