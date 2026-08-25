from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.db.models import AIResult, Annotation, Upload
from app.services.attention_triage import (
    TriageUploadRef,
    calendar_tier_to_attention_tier,
    select_day_cover_upload,
)
from app.services.symptoms import calendar_risk_tier


@dataclass(frozen=True)
class UploadHistoryDay:
    date: date
    upload_count: int
    has_suspected_risk: bool
    has_symptom_elevated_risk: bool
    representative_upload_id: int | None = None
    representative_object_key: str | None = None


@dataclass
class _UploadHistoryDayBucket:
    upload_count: int = 0
    has_suspected_risk: bool = False
    has_symptom_elevated_risk: bool = False
    refs: list[TriageUploadRef] = field(default_factory=list)
    object_key_by_upload_id: dict[int, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PatientUploadLifetimeMetrics:
    continuous_upload_streak_days: int
    longest_continuous_upload_streak_days: int
    total_upload_count: int


@dataclass(frozen=True)
class PatientUploadHistoryBundle:
    days: list[UploadHistoryDay]
    metrics: PatientUploadLifetimeMetrics


@dataclass(frozen=True)
class PatientDayUpload:
    upload_id: int
    created_at: datetime
    screening_result: str
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    symptom_cloudy_dialysate: bool
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
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    symptom_cloudy_dialysate: bool
    annotation_label: str | None
    annotation_comment: str | None
    local_date: date
    prev_upload_id: int | None
    next_upload_id: int | None


@dataclass(frozen=True)
class PatientGalleryUploadItem:
    upload_id: int
    created_at: datetime
    local_date: date
    object_key: str
    has_suspected_risk: bool
    has_symptom_elevated_risk: bool


@dataclass(frozen=True)
class PatientGalleryUploadsPage:
    items: list[PatientGalleryUploadItem]
    has_more_older: bool


@dataclass(frozen=True)
class PatientGalleryMonthBundle:
    month: str
    days: list[UploadHistoryDay]
    has_more_older: bool


@dataclass(frozen=True)
class PatientAnnotationMessage:
    annotation_id: int
    upload_id: int
    created_at: datetime
    label: str
    comment: str | None
    is_read: bool
    object_key: str


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


def _load_patient_upload_history_rows(session: Session, *, patient_id: int) -> Sequence[tuple]:
    return session.execute(
        select(
            Upload.id,
            Upload.created_at,
            Upload.object_key,
            AIResult.screening_result,
            Upload.symptom_pain,
            Upload.symptom_pus,
            Upload.symptom_cloudy_dialysate,
        )
        .outerjoin(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()


def _lifetime_metrics_from_date_counts(
    uploads_by_date: dict[date, int],
    *,
    today: date,
) -> PatientUploadLifetimeMetrics:
    streak = 0
    checking = today
    while uploads_by_date.get(checking, 0) > 0:
        streak += 1
        checking -= timedelta(days=1)

    longest = 0
    run = 0
    previous_day: date | None = None
    for current_day in sorted(uploads_by_date):
        if previous_day is not None and current_day == previous_day + timedelta(days=1):
            run += 1
        else:
            run = 1
        longest = max(longest, run)
        previous_day = current_day

    return PatientUploadLifetimeMetrics(
        continuous_upload_streak_days=streak,
        longest_continuous_upload_streak_days=longest,
        total_upload_count=sum(uploads_by_date.values()),
    )


def summarize_patient_upload_history_with_metrics(
    session: Session,
    *,
    patient_id: int,
    timezone_name: str = "Asia/Taipei",
    today: date | None = None,
) -> PatientUploadHistoryBundle:
    rows = _load_patient_upload_history_rows(session, patient_id=patient_id)
    local_timezone = _resolve_local_timezone(timezone_name)
    local_today = today or datetime.now(tz=timezone.utc).astimezone(local_timezone).date()
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, patient_id=patient_id)
    by_day: dict[date, _UploadHistoryDayBucket] = {}
    uploads_by_date: dict[date, int] = {}

    for (
        upload_id,
        created_at,
        object_key,
        screening_result,
        symptom_pain,
        symptom_pus,
        symptom_cloudy_dialysate,
    ) in rows:
        if screening_result == "rejected":
            continue
        normalized = _normalize_datetime(created_at)
        day_key = normalized.astimezone(local_timezone).date()
        latest_annotation = latest_annotation_by_upload.get(upload_id)
        tier = calendar_risk_tier(
            screening_result=screening_result,
            annotation_label=latest_annotation.label if latest_annotation else None,
            symptom_pain=bool(symptom_pain),
            symptom_pus=bool(symptom_pus),
            symptom_cloudy_dialysate=bool(symptom_cloudy_dialysate),
        )
        bucket = by_day.setdefault(day_key, _UploadHistoryDayBucket())
        bucket.upload_count += 1
        bucket.has_suspected_risk = bucket.has_suspected_risk or tier == "suspected"
        bucket.has_symptom_elevated_risk = bucket.has_symptom_elevated_risk or tier == "elevated"
        bucket.refs.append(
            TriageUploadRef(
                upload_id=upload_id,
                created_at=normalized,
                tier=calendar_tier_to_attention_tier(tier),
                has_annotation=latest_annotation is not None,
            )
        )
        bucket.object_key_by_upload_id[upload_id] = object_key
        # Lifetime metrics keep the previous inner-join rule: only scored (non-rejected) uploads.
        if screening_result is not None and day_key <= local_today:
            uploads_by_date[day_key] = uploads_by_date.get(day_key, 0) + 1

    days: list[UploadHistoryDay] = []
    for day_key in sorted(by_day.keys()):
        bucket = by_day[day_key]
        cover = select_day_cover_upload(bucket.refs)
        cover_id = cover.upload_id if cover is not None else None
        days.append(
            UploadHistoryDay(
                date=day_key,
                upload_count=bucket.upload_count,
                has_suspected_risk=bucket.has_suspected_risk,
                has_symptom_elevated_risk=bucket.has_symptom_elevated_risk,
                representative_upload_id=cover_id,
                representative_object_key=bucket.object_key_by_upload_id.get(cover_id) if cover_id is not None else None,
            )
        )
    return PatientUploadHistoryBundle(
        days=days,
        metrics=_lifetime_metrics_from_date_counts(uploads_by_date, today=local_today),
    )


def summarize_patient_upload_history(
    session: Session,
    *,
    patient_id: int,
    timezone_name: str = "Asia/Taipei",
) -> list[UploadHistoryDay]:
    return summarize_patient_upload_history_with_metrics(
        session,
        patient_id=patient_id,
        timezone_name=timezone_name,
    ).days


def summarize_patient_upload_lifetime_metrics(
    session: Session,
    *,
    patient_id: int,
    timezone_name: str = "Asia/Taipei",
    today: date | None = None,
) -> PatientUploadLifetimeMetrics:
    local_timezone = _resolve_local_timezone(timezone_name)
    rows: Sequence[tuple] = session.execute(
        select(Upload.created_at, AIResult.screening_result)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .order_by(Upload.created_at.asc())
    ).all()

    local_today = today or datetime.now(tz=timezone.utc).astimezone(local_timezone).date()
    uploads_by_date: dict[date, int] = {}

    for created_at, screening_result in rows:
        if screening_result == "rejected":
            continue
        normalized = _normalize_datetime(created_at)
        local_date = normalized.astimezone(local_timezone).date()
        if local_date > local_today:
            continue
        uploads_by_date[local_date] = uploads_by_date.get(local_date, 0) + 1

    return _lifetime_metrics_from_date_counts(uploads_by_date, today=local_today)


def _parse_gallery_month_key(month_key: str) -> date:
    parts = month_key.split("-")
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        raise ValueError("month must be in YYYY-MM format")
    try:
        year = int(parts[0])
        month = int(parts[1])
        return date(year, month, 1)
    except ValueError as exc:
        raise ValueError("month must be in YYYY-MM format") from exc


def _gallery_qualifying_clause():
    return or_(AIResult.screening_result.is_(None), AIResult.screening_result != "rejected")


def list_patient_gallery_uploads(
    session: Session,
    *,
    patient_id: int,
    before_id: int | None = None,
    limit: int = 30,
    timezone_name: str = "Asia/Taipei",
) -> PatientGalleryUploadsPage:
    local_timezone = _resolve_local_timezone(timezone_name)
    stmt = (
        select(Upload, AIResult)
        .outerjoin(AIResult, AIResult.upload_id == Upload.id)
        .where(Upload.patient_id == patient_id)
        .where(_gallery_qualifying_clause())
    )
    if before_id is not None:
        cursor = session.get(Upload, before_id)
        if cursor is None or cursor.patient_id != patient_id:
            raise LookupError("Gallery cursor upload was not found")
        cursor_result = session.execute(select(AIResult).where(AIResult.upload_id == cursor.id)).scalar_one_or_none()
        if cursor_result is not None and cursor_result.screening_result == "rejected":
            raise LookupError("Gallery cursor upload was not found")
        stmt = stmt.where(
            or_(
                Upload.created_at < cursor.created_at,
                and_(Upload.created_at == cursor.created_at, Upload.id < cursor.id),
            )
        )
    stmt = stmt.order_by(Upload.created_at.desc(), Upload.id.desc()).limit(limit + 1)
    rows = session.execute(stmt).all()
    has_more_older = len(rows) > limit
    page_rows = list(reversed(rows[:limit]))
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, patient_id=patient_id)
    items: list[PatientGalleryUploadItem] = []
    for upload, ai_result in page_rows:
        screening_result = ai_result.screening_result if ai_result is not None else None
        latest_annotation = latest_annotation_by_upload.get(upload.id)
        tier = calendar_risk_tier(
            screening_result=screening_result,
            annotation_label=latest_annotation.label if latest_annotation else None,
            symptom_pain=bool(upload.symptom_pain),
            symptom_pus=bool(upload.symptom_pus),
            symptom_cloudy_dialysate=bool(upload.symptom_cloudy_dialysate),
        )
        normalized = _normalize_datetime(upload.created_at)
        items.append(
            PatientGalleryUploadItem(
                upload_id=upload.id,
                created_at=upload.created_at,
                local_date=normalized.astimezone(local_timezone).date(),
                object_key=upload.object_key,
                has_suspected_risk=tier == "suspected",
                has_symptom_elevated_risk=tier == "elevated",
            )
        )
    return PatientGalleryUploadsPage(items=items, has_more_older=has_more_older)


def list_patient_gallery_month(
    session: Session,
    *,
    patient_id: int,
    month_key: str,
    timezone_name: str = "Asia/Taipei",
) -> PatientGalleryMonthBundle:
    month_start = _parse_gallery_month_key(month_key)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    days = summarize_patient_upload_history(session, patient_id=patient_id, timezone_name=timezone_name)
    month_days = [day for day in days if month_start <= day.date < next_month]
    has_more_older = any(day.date < month_start for day in days)
    return PatientGalleryMonthBundle(month=month_key, days=month_days, has_more_older=has_more_older)


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
                symptom_pain=upload.symptom_pain,
                symptom_discharge=upload.symptom_discharge,
                symptom_pus=upload.symptom_pus,
                symptom_cloudy_dialysate=upload.symptom_cloudy_dialysate,
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
        symptom_pain=selected_upload.symptom_pain,
        symptom_discharge=selected_upload.symptom_discharge,
        symptom_pus=selected_upload.symptom_pus,
        symptom_cloudy_dialysate=selected_upload.symptom_cloudy_dialysate,
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


def mark_all_patient_annotation_messages_read(session: Session, *, patient_id: int) -> int:
    now = datetime.now(tz=timezone.utc)
    result = session.execute(
        update(Annotation)
        .where(and_(Annotation.patient_id == patient_id, Annotation.patient_read_at.is_(None)))
        .values(patient_read_at=now)
    )
    session.commit()
    return int(result.rowcount or 0)
