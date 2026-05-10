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
) -> tuple[list[StaffNotificationRow], int, int]:
    total = session.execute(select(func.count(Notification.id))).scalar_one()
    unread_count = session.execute(
        select(func.count(Notification.id)).where(Notification.status == "new")
    ).scalar_one()
    rows = session.execute(
        select(Notification, Patient, AIResult)
        .join(Patient, Patient.id == Notification.patient_id)
        .join(AIResult, AIResult.id == Notification.ai_result_id, isouter=True)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [StaffNotificationRow(notification=notification, patient=patient, ai_result=ai_result) for notification, patient, ai_result in rows]
    return items, int(total), int(unread_count)


def mark_staff_notification_read(session: Session, *, notification_id: int) -> Notification:
    notification = session.get(Notification, notification_id)
    if notification is None:
        raise LookupError("Notification not found")
    if notification.status == "new":
        notification.status = "reviewed"
        session.commit()
        session.refresh(notification)
    return notification
