from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Select, and_, select
from sqlalchemy.orm import Session

from app.db.models import AIResult, Annotation, LiffIdentity, Patient, Upload
from app.services.taipei_dates import normalize_datetime, to_taipei_date
RISKY_ANNOTATION_LABELS = {"suspected", "confirmed_infection"}


@dataclass(frozen=True)
class HistoryOverviewDaySummary:
    local_date: date
    upload_count: int
    uploaded_users: int
    suspected_infected_users: int
    infection_rate: float
    risky_patient_count: int
    has_infection_risk: bool


@dataclass(frozen=True)
class HistoryOverviewUploadItemData:
    upload_id: int
    patient_id: int
    case_number: str
    patient_full_name: str | None
    gender: str
    line_user_id: str | None
    line_display_name: str | None
    real_name: str | None
    picture_url: str | None
    created_at: datetime
    screening_result: str
    probability: float | None
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    annotation_label: str | None
    annotation_comment: str | None
    risk_rank: int


@dataclass(frozen=True)
class HistoryOverviewUserGroupData:
    patient_id: int
    case_number: str
    patient_full_name: str | None
    gender: str
    age: int | None
    line_user_id: str | None
    line_display_name: str | None
    real_name: str | None
    picture_url: str | None
    upload_count: int
    highest_risk_rank: int
    highest_risk_count: int
    latest_upload_at: datetime | None
    uploads: list[HistoryOverviewUploadItemData]


@dataclass(frozen=True)
class HistoryOverviewData:
    local_date: date
    sort_by: str
    group_by_user: bool
    group_sort_by: str
    uploaded_users: int
    uploads: int
    suspected_infected_users: int
    infection_rate: float
    items: list[HistoryOverviewUploadItemData]
    groups: list[HistoryOverviewUserGroupData]


@dataclass(frozen=True)
class HistoryOverviewCalendarItem:
    local_date: date
    risky_patient_count: int
    has_infection_risk: bool


@dataclass(frozen=True)
class _RawUploadRow:
    upload_id: int
    patient_id: int
    case_number: str
    birth_date: str
    patient_full_name: str | None
    gender: str
    line_user_id: str | None
    line_display_name: str | None
    real_name: str | None
    picture_url: str | None
    created_at: datetime
    screening_result: str
    probability: float | None
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    annotation_label: str | None
    annotation_comment: str | None
    local_date: date


def _calculate_age(birth_date: str) -> int | None:
    try:
        parsed = datetime.strptime(birth_date, "%Y-%m-%d").date()
    except ValueError:
        return None
    today = datetime.now(tz=timezone.utc).date()
    years = today.year - parsed.year
    if (today.month, today.day) < (parsed.month, parsed.day):
        years -= 1
    return max(years, 0)


def _load_identity_by_patient(session: Session, *, patient_ids: set[int]) -> dict[int, LiffIdentity]:
    if not patient_ids:
        return {}
    rows = session.execute(
        select(LiffIdentity)
        .where(
            and_(
                LiffIdentity.patient_id.in_(patient_ids),
                LiffIdentity.role == "patient",
            )
        )
        .order_by(LiffIdentity.patient_id.asc(), LiffIdentity.id.asc())
    ).scalars()
    result: dict[int, LiffIdentity] = {}
    for row in rows:
        if row.patient_id is None:
            continue
        if row.patient_id not in result:
            result[row.patient_id] = row
    return result


def _load_latest_annotation_by_upload(session: Session, *, upload_ids: set[int]) -> dict[int, Annotation]:
    if not upload_ids:
        return {}
    rows = session.execute(
        select(Annotation)
        .where(Annotation.upload_id.in_(upload_ids))
        .order_by(Annotation.upload_id.asc(), Annotation.created_at.desc())
    ).scalars()
    result: dict[int, Annotation] = {}
    for row in rows:
        if row.upload_id not in result:
            result[row.upload_id] = row
    return result


def _risk_rank(*, screening_result: str, annotation_label: str | None) -> int:
    if annotation_label == "confirmed_infection":
        return 0
    if annotation_label == "suspected":
        return 1
    if annotation_label == "normal":
        return 2
    if annotation_label == "rejected":
        return 3
    if screening_result == "suspected":
        return 1
    if screening_result == "normal":
        return 2
    return 3


def _is_infected_user(*, screening_result: str, annotation_label: str | None) -> bool:
    if annotation_label == "confirmed_infection":
        return True
    if annotation_label is None and screening_result == "suspected":
        return True
    return False


def _raw_rows(session: Session, *, accessible_patient_ids: set[int] | None = None) -> list[_RawUploadRow]:
    base_query: Select = (
        select(Upload, AIResult, Patient)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .join(Patient, Patient.id == Upload.patient_id)
    )
    if accessible_patient_ids is not None:
        if not accessible_patient_ids:
            return []
        base_query = base_query.where(Patient.id.in_(accessible_patient_ids))
    upload_rows = session.execute(base_query).all()
    patient_ids = {patient.id for _, _, patient in upload_rows}
    upload_ids = {upload.id for upload, _, _ in upload_rows}
    identity_by_patient = _load_identity_by_patient(session, patient_ids=patient_ids)
    latest_annotation_by_upload = _load_latest_annotation_by_upload(session, upload_ids=upload_ids)

    result: list[_RawUploadRow] = []
    for upload, ai_result, patient in upload_rows:
        identity = identity_by_patient.get(patient.id)
        annotation = latest_annotation_by_upload.get(upload.id)
        result.append(
            _RawUploadRow(
                upload_id=upload.id,
                patient_id=patient.id,
                case_number=patient.case_number,
                birth_date=patient.birth_date,
                patient_full_name=patient.full_name,
                gender=patient.gender,
                line_user_id=identity.line_user_id if identity else None,
                line_display_name=identity.display_name if identity else None,
                real_name=identity.real_name if identity else None,
                picture_url=identity.picture_url if identity else None,
                created_at=upload.created_at,
                screening_result=ai_result.screening_result,
                probability=ai_result.probability,
                symptom_pain=upload.symptom_pain,
                symptom_discharge=upload.symptom_discharge,
                symptom_pus=upload.symptom_pus,
                annotation_label=annotation.label if annotation else None,
                annotation_comment=annotation.comment if annotation else None,
                local_date=to_taipei_date(upload.created_at),
            )
        )
    return result


def list_history_overview_days(
    session: Session,
    *,
    accessible_patient_ids: set[int] | None = None,
) -> list[HistoryOverviewDaySummary]:
    rows = _raw_rows(session, accessible_patient_ids=accessible_patient_ids)
    grouped: dict[date, list[_RawUploadRow]] = defaultdict(list)
    for row in rows:
        grouped[row.local_date].append(row)

    result: list[HistoryOverviewDaySummary] = []
    for local_day in sorted(grouped.keys(), reverse=True):
        day_rows = grouped[local_day]
        patient_ids = {row.patient_id for row in day_rows}
        infected_patient_ids = {
            row.patient_id
            for row in day_rows
            if _is_infected_user(screening_result=row.screening_result, annotation_label=row.annotation_label)
        }
        uploaded_users = len(patient_ids)
        suspected_infected_users = len(infected_patient_ids)
        infection_rate = (suspected_infected_users / uploaded_users) if uploaded_users > 0 else 0.0
        result.append(
            HistoryOverviewDaySummary(
                local_date=local_day,
                upload_count=len(day_rows),
                uploaded_users=uploaded_users,
                suspected_infected_users=suspected_infected_users,
                infection_rate=infection_rate,
                risky_patient_count=suspected_infected_users,
                has_infection_risk=suspected_infected_users > 0,
            )
        )
    return result


def _to_upload_item(row: _RawUploadRow) -> HistoryOverviewUploadItemData:
    return HistoryOverviewUploadItemData(
        upload_id=row.upload_id,
        patient_id=row.patient_id,
        case_number=row.case_number,
        patient_full_name=row.patient_full_name,
        gender=row.gender,
        line_user_id=row.line_user_id,
        line_display_name=row.line_display_name,
        real_name=row.real_name,
        picture_url=row.picture_url,
        created_at=row.created_at,
        screening_result=row.screening_result,
        probability=row.probability,
        symptom_pain=row.symptom_pain,
        symptom_discharge=row.symptom_discharge,
        symptom_pus=row.symptom_pus,
        annotation_label=row.annotation_label,
        annotation_comment=row.annotation_comment,
        risk_rank=_risk_rank(screening_result=row.screening_result, annotation_label=row.annotation_label),
    )


def _sort_uploads(items: list[HistoryOverviewUploadItemData], *, sort_by: str) -> list[HistoryOverviewUploadItemData]:
    if sort_by == "risk":
        return sorted(
            items,
            key=lambda item: (
                item.risk_rank,
                -(item.probability or -1),
                -normalize_datetime(item.created_at).timestamp(),
            ),
        )
    return sorted(items, key=lambda item: normalize_datetime(item.created_at), reverse=True)


def _sort_groups(groups: list[HistoryOverviewUserGroupData], *, group_sort_by: str) -> list[HistoryOverviewUserGroupData]:
    if group_sort_by == "uploads":
        return sorted(
            groups,
            key=lambda group: (group.upload_count, normalize_datetime(group.latest_upload_at).timestamp() if group.latest_upload_at else -1),
            reverse=True,
        )
    if group_sort_by == "age":
        return sorted(
            groups,
            key=lambda group: (group.age if group.age is not None else -1, group.upload_count),
            reverse=True,
        )
    return sorted(
        groups,
        key=lambda group: (
            group.highest_risk_rank,
            -group.highest_risk_count,
            -(normalize_datetime(group.latest_upload_at).timestamp() if group.latest_upload_at else -1),
        ),
    )


def get_history_overview(
    session: Session,
    *,
    local_day: date,
    sort_by: str,
    group_by_user: bool,
    group_sort_by: str,
    accessible_patient_ids: set[int] | None = None,
) -> HistoryOverviewData:
    rows = [row for row in _raw_rows(session, accessible_patient_ids=accessible_patient_ids) if row.local_date == local_day]
    upload_items = [_to_upload_item(row) for row in rows]
    sorted_items = _sort_uploads(upload_items, sort_by=sort_by)

    patient_ids = {row.patient_id for row in rows}
    infected_patient_ids = {
        row.patient_id
        for row in rows
        if _is_infected_user(screening_result=row.screening_result, annotation_label=row.annotation_label)
    }
    uploaded_users = len(patient_ids)
    suspected_infected_users = len(infected_patient_ids)
    infection_rate = (suspected_infected_users / uploaded_users) if uploaded_users > 0 else 0.0

    grouped_items: dict[int, list[HistoryOverviewUploadItemData]] = defaultdict(list)
    for item in sorted_items:
        grouped_items[item.patient_id].append(item)

    groups: list[HistoryOverviewUserGroupData] = []
    for patient_item_list in grouped_items.values():
        first = patient_item_list[0]
        highest_risk_rank = min(item.risk_rank for item in patient_item_list)
        highest_risk_count = sum(1 for item in patient_item_list if item.risk_rank == highest_risk_rank)
        latest_upload_at = max((item.created_at for item in patient_item_list), default=None)
        age = next((_calculate_age(row.birth_date) for row in rows if row.patient_id == first.patient_id), None)
        groups.append(
            HistoryOverviewUserGroupData(
                patient_id=first.patient_id,
                case_number=first.case_number,
                patient_full_name=first.patient_full_name,
                gender=first.gender,
                age=age,
                line_user_id=first.line_user_id,
                line_display_name=first.line_display_name,
                real_name=first.real_name,
                picture_url=first.picture_url,
                upload_count=len(patient_item_list),
                highest_risk_rank=highest_risk_rank,
                highest_risk_count=highest_risk_count,
                latest_upload_at=latest_upload_at,
                uploads=patient_item_list,
            )
        )

    sorted_groups = _sort_groups(groups, group_sort_by=group_sort_by)

    return HistoryOverviewData(
        local_date=local_day,
        sort_by=sort_by,
        group_by_user=group_by_user,
        group_sort_by=group_sort_by,
        uploaded_users=uploaded_users,
        uploads=len(sorted_items),
        suspected_infected_users=suspected_infected_users,
        infection_rate=infection_rate,
        items=sorted_items if not group_by_user else [],
        groups=sorted_groups if group_by_user else [],
    )


def get_history_overview_calendar_month(
    session: Session,
    *,
    year: int,
    month: int,
    accessible_patient_ids: set[int] | None = None,
) -> list[HistoryOverviewCalendarItem]:
    days = list_history_overview_days(session, accessible_patient_ids=accessible_patient_ids)
    return [
        HistoryOverviewCalendarItem(
            local_date=item.local_date,
            risky_patient_count=item.risky_patient_count,
            has_infection_risk=item.has_infection_risk,
        )
        for item in days
        if item.local_date.year == year and item.local_date.month == month
    ]
