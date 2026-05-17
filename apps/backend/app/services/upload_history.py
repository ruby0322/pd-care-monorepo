from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db.models import AIResult, Annotation, Upload


@dataclass(frozen=True)
class UploadHistoryDay:
    date: date
    upload_count: int
    has_suspected_risk: bool


@dataclass(frozen=True)
class UploadHistorySummary28d:
    all_upload_count_28d: int
    suspected_upload_count_28d: int
    continuous_upload_streak_days: int


@dataclass(frozen=True)
class PatientDayUpload:
    upload_id: int
    created_at: datetime
    screening_result: str
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    annotation_label: str | None
    annotation_comment: str | None


@dataclass(frozen=True)
class PatientUploadDetail:
    upload_id: int
    created_at: datetime
    object_key: str
    content_type: str
    screening_result: str
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    annotation_label: str | None
    annotation_comment: str | None
    local_date: date
    prev_upload_id: int | None
    next_upload_id: int | None


@dataclass(frozen=True)
class PatientAnnotationMessage:
    annotation_id: int
    upload_id: int
    created_at: datetime
    label: str
    comment: str | None
    is_read: bool
    object_key: str


RISKY_ANNOTATION_LABELS = {"suspected", "confirmed_infection"}


def _resolve_local_timezone(timezone_name: str) -> timezone:
    if timezone_name == "Asia/Taipei":
        return timezone(timedelta(hours=8))
    if timezone_name == "UTC":
        return timezone.utc
    return timezone.utc


def _normalize_datetime(raw_dt: datetime) -> datetime:
    # created_at is a datetime from DB; normalize missing timezone to UTC.
    if getattr(raw_dt, "tzinfo", None) is not None:
        return raw_dt
    return raw_dt.replace(tzinfo=timezone.utc)


def _load_latest_annotation_by_upload(session: Session, *, patient_id: int) -> dict[int, Annotation]:
    rows = session.execute(
        select(Annotation)
        .where(Annotation.patient_id == patient_id)
        .order_by(Annotation.upload_id.asc(), Annotation.created_at.desc())
    ).scalars()
    latest_by_upload: dict[int, Annotation] = {}
    for item in rows:
        if item.upload_id not in latest_by_upload:
            latest_by_upload[item.upload_id] = item
    return latest_by_upload


def summarize_patient_upload_history(
    session: Session,
    *,
    patient_id: int,
    timezone_name: str = "Asia/Taipei",
) -> list[UploadHistoryDay]:
    rows: Sequence[tuple] = session.execute(
        select(Upload.id, Upload.created_at, AIResult.screening_result)
        .outerjoin(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()

    local_timezone = _resolve_local_timezone(timezone_name)
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, patient_id=patient_id)
    by_day: dict[date, UploadHistoryDay] = {}
    for upload_id, created_at, screening_result in rows:
        if screening_result == "rejected":
            continue
        normalized = _normalize_datetime(created_at)
        day_key = normalized.astimezone(local_timezone).date()
        existing = by_day.get(day_key)
        latest_annotation = latest_annotation_by_upload.get(upload_id)
        has_suspected = screening_result == "suspected" or (
            latest_annotation is not None and latest_annotation.label in RISKY_ANNOTATION_LABELS
        )
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


def summarize_patient_upload_metrics_28d(
    session: Session,
    *,
    patient_id: int,
    timezone_name: str = "Asia/Taipei",
    today: date | None = None,
) -> UploadHistorySummary28d:
    local_timezone = _resolve_local_timezone(timezone_name)
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, patient_id=patient_id)
    rows: Sequence[tuple] = session.execute(
        select(Upload.id, Upload.created_at, AIResult.screening_result)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()

    local_today = today or date.today()
    window_start = local_today - timedelta(days=27)
    uploads_by_date: dict[date, int] = {}
    all_upload_count_28d = 0
    suspected_upload_count_28d = 0

    for upload_id, created_at, screening_result in rows:
        if screening_result == "rejected":
            continue
        normalized = _normalize_datetime(created_at)
        local_date = normalized.astimezone(local_timezone).date()
        if local_date < window_start or local_date > local_today:
            continue

        uploads_by_date[local_date] = uploads_by_date.get(local_date, 0) + 1
        all_upload_count_28d += 1

        latest_annotation = latest_annotation_by_upload.get(upload_id)
        has_suspected = screening_result == "suspected" or (
            latest_annotation is not None and latest_annotation.label in RISKY_ANNOTATION_LABELS
        )
        if has_suspected:
            suspected_upload_count_28d += 1

    streak = 0
    for offset in range(28):
        checking = local_today - timedelta(days=offset)
        if uploads_by_date.get(checking, 0) <= 0:
            break
        streak += 1

    return UploadHistorySummary28d(
        all_upload_count_28d=all_upload_count_28d,
        suspected_upload_count_28d=suspected_upload_count_28d,
        continuous_upload_streak_days=streak,
    )


def list_patient_uploads_by_local_day(
    session: Session,
    *,
    patient_id: int,
    local_day: date,
    timezone_name: str = "Asia/Taipei",
) -> list[PatientDayUpload]:
    local_timezone = _resolve_local_timezone(timezone_name)
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, patient_id=patient_id)
    rows: Sequence[tuple] = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()

    result: list[PatientDayUpload] = []
    for upload, ai_result in rows:
        normalized = _normalize_datetime(upload.created_at)
        upload_day = normalized.astimezone(local_timezone).date()
        if upload_day != local_day:
            continue
        latest_annotation = latest_annotation_by_upload.get(upload.id)
        result.append(
            PatientDayUpload(
                upload_id=upload.id,
                created_at=upload.created_at,
                screening_result=ai_result.screening_result,
                probability=ai_result.probability,
                threshold=ai_result.threshold,
                model_version=ai_result.model_version,
                error_reason=ai_result.error_reason,
                annotation_label=latest_annotation.label if latest_annotation else None,
                annotation_comment=latest_annotation.comment if latest_annotation else None,
            )
        )
    return result


def get_patient_upload_detail(
    session: Session,
    *,
    patient_id: int,
    upload_id: int,
    timezone_name: str = "Asia/Taipei",
) -> PatientUploadDetail:
    local_timezone = _resolve_local_timezone(timezone_name)
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, patient_id=patient_id)
    rows: Sequence[tuple] = session.execute(
        select(Upload, AIResult)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()

    if not rows:
        raise LookupError("Patient upload was not found")

    ordered_by_day: dict[date, list[tuple[Upload, AIResult]]] = {}
    selected_pair: tuple[Upload, AIResult] | None = None
    for upload, ai_result in rows:
        normalized = _normalize_datetime(upload.created_at)
        local_day = normalized.astimezone(local_timezone).date()
        if local_day not in ordered_by_day:
            ordered_by_day[local_day] = []
        ordered_by_day[local_day].append((upload, ai_result))
        if upload.id == upload_id:
            selected_pair = (upload, ai_result)

    if selected_pair is None:
        raise LookupError("Patient upload was not found")

    selected_upload, selected_ai_result = selected_pair
    selected_local_date = _normalize_datetime(selected_upload.created_at).astimezone(local_timezone).date()
    same_day_rows = ordered_by_day.get(selected_local_date, [])
    selected_index = next((idx for idx, (upload, _) in enumerate(same_day_rows) if upload.id == upload_id), -1)
    if selected_index < 0:
        raise LookupError("Patient upload was not found")

    prev_upload_id = same_day_rows[selected_index - 1][0].id if selected_index > 0 else None
    next_upload_id = (
        same_day_rows[selected_index + 1][0].id if selected_index < len(same_day_rows) - 1 else None
    )
    latest_annotation = latest_annotation_by_upload.get(selected_upload.id)

    return PatientUploadDetail(
        upload_id=selected_upload.id,
        created_at=selected_upload.created_at,
        object_key=selected_upload.object_key,
        content_type=selected_upload.content_type,
        screening_result=selected_ai_result.screening_result,
        probability=selected_ai_result.probability,
        threshold=selected_ai_result.threshold,
        model_version=selected_ai_result.model_version,
        error_reason=selected_ai_result.error_reason,
        annotation_label=latest_annotation.label if latest_annotation else None,
        annotation_comment=latest_annotation.comment if latest_annotation else None,
        local_date=selected_local_date,
        prev_upload_id=prev_upload_id,
        next_upload_id=next_upload_id,
    )


def list_patient_annotation_messages(
    session: Session,
    *,
    patient_id: int,
    limit: int,
    offset: int = 0,
    unread_only: bool = False,
) -> tuple[list[PatientAnnotationMessage], int, int]:
    unread_filter = Annotation.patient_read_at.is_(None)
    base_query = select(Annotation, Upload).join(Upload, Upload.id == Annotation.upload_id).where(Annotation.patient_id == patient_id)
    if unread_only:
        base_query = base_query.where(unread_filter)

    rows = session.execute(
        base_query.order_by(Annotation.created_at.desc(), Annotation.id.desc()).offset(offset).limit(limit)
    ).all()
    items = [
        PatientAnnotationMessage(
            annotation_id=annotation.id,
            upload_id=annotation.upload_id,
            created_at=annotation.created_at,
            label=annotation.label,
            comment=annotation.comment,
            is_read=annotation.patient_read_at is not None,
            object_key=upload.object_key,
        )
        for annotation, upload in rows
    ]

    total = session.execute(select(func.count(Annotation.id)).where(Annotation.patient_id == patient_id)).scalar_one()
    unread_count = session.execute(
        select(func.count(Annotation.id)).where(and_(Annotation.patient_id == patient_id, unread_filter))
    ).scalar_one()
    return items, int(total), int(unread_count)


def mark_patient_annotation_message_read(
    session: Session,
    *,
    patient_id: int,
    annotation_id: int,
) -> Annotation:
    annotation = session.execute(
        select(Annotation).where(and_(Annotation.id == annotation_id, Annotation.patient_id == patient_id))
    ).scalar_one_or_none()
    if annotation is None:
        raise LookupError("Annotation message was not found")
    if annotation.patient_read_at is None:
        annotation.patient_read_at = datetime.now(tz=timezone.utc)
        session.commit()
        session.refresh(annotation)
    return annotation
