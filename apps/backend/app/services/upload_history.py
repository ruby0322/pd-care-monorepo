from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AIResult, Upload


@dataclass(frozen=True)
class UploadHistoryDay:
    date: date
    upload_count: int
    has_suspected_risk: bool


def summarize_patient_upload_history(
    session: Session,
    *,
    patient_id: int,
    timezone_name: str = "Asia/Taipei",
) -> list[UploadHistoryDay]:
    rows: Sequence[tuple] = session.execute(
        select(Upload.created_at, AIResult.screening_result)
        .outerjoin(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()

    if timezone_name == "Asia/Taipei":
        local_timezone = timezone(timedelta(hours=8))
    elif timezone_name == "UTC":
        local_timezone = timezone.utc
    else:
        local_timezone = timezone.utc
    by_day: dict[date, UploadHistoryDay] = {}
    for created_at, screening_result in rows:
        normalized = created_at if created_at.tzinfo is not None else created_at.replace(tzinfo=timezone.utc)
        day_key = normalized.astimezone(local_timezone).date()
        existing = by_day.get(day_key)
        has_suspected = screening_result == "suspected"
        if existing is None:
            by_day[day_key] = UploadHistoryDay(
                date=day_key,
                upload_count=1,
                has_suspected_risk=has_suspected,
            )
            continue

        by_day[day_key] = UploadHistoryDay(
            date=day_key,
            upload_count=existing.upload_count + 1,
            has_suspected_risk=existing.has_suspected_risk or has_suspected,
        )

    return [by_day[current] for current in sorted(by_day.keys())]
