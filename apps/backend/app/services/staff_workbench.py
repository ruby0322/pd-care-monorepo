"""Admin dashboard workbench: week metrics + available dates + day attention in one session."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.db.models import AIResult, Patient, Upload
from app.services.attention_triage import workbench_upload_where_clauses
from app.services.staff_dashboard import TodayAttentionPatientRow, list_today_attention_patients
from app.services.staff_history_overview import HistoryOverviewDaySummary, list_history_overview_days
from app.services.taipei_dates import (
    coerce_sql_local_date,
    resolve_taipei_day_bounds_for_date,
    upload_taipei_local_date_expr,
)


@dataclass(frozen=True)
class WorkbenchWeekDayMetrics:
    local_date: date
    upload_count: int
    uploaded_users: int
    risky_patient_count: int
    unhandled_patient_count: int


@dataclass(frozen=True)
class WorkbenchDashboardData:
    local_date: date
    week_start: date
    available_dates: list[date]
    week_days: list[WorkbenchWeekDayMetrics]
    attention_total_uploads: int
    attention_rows: list[TodayAttentionPatientRow]


def list_workbench_dates(
    session: Session,
    *,
    accessible_patient_ids: set[int] | None = None,
) -> list[date]:
    """Distinct Taipei local dates with at least one workbench-eligible upload."""
    if accessible_patient_ids is not None and not accessible_patient_ids:
        return []
    bind = session.get_bind()
    dialect_name = bind.dialect.name if bind is not None else "postgresql"
    local_day = upload_taipei_local_date_expr(Upload.created_at, dialect_name=dialect_name)
    stmt: Select = (
        select(local_day)
        .select_from(Upload)
        .join(AIResult, AIResult.upload_id == Upload.id)
        .join(Patient, Patient.id == Upload.patient_id)
        .where(*workbench_upload_where_clauses())
    )
    if accessible_patient_ids is not None:
        stmt = stmt.where(Patient.id.in_(accessible_patient_ids))
    stmt = stmt.distinct().order_by(local_day.desc())
    rows = session.execute(stmt).scalars().all()
    return [coerce_sql_local_date(row) for row in rows]


def aggregate_workbench_week(
    session: Session,
    *,
    week_start: date,
    accessible_patient_ids: set[int] | None = None,
) -> list[WorkbenchWeekDayMetrics]:
    """Metrics for the 7 Taipei days starting at week_start (inclusive). Always returns 7 entries."""
    week_end = week_start + timedelta(days=6)
    _, created_from, _ = resolve_taipei_day_bounds_for_date(week_start)
    _, _, created_to = resolve_taipei_day_bounds_for_date(week_end)
    day_summaries = list_history_overview_days(
        session,
        accessible_patient_ids=accessible_patient_ids,
        scope="workbench",
        created_from=created_from,
        created_to=created_to,
    )
    by_date = {item.local_date: item for item in day_summaries}
    result: list[WorkbenchWeekDayMetrics] = []
    for offset in range(7):
        day = week_start + timedelta(days=offset)
        summary: HistoryOverviewDaySummary | None = by_date.get(day)
        if summary is None:
            result.append(
                WorkbenchWeekDayMetrics(
                    local_date=day,
                    upload_count=0,
                    uploaded_users=0,
                    risky_patient_count=0,
                    unhandled_patient_count=0,
                )
            )
        else:
            result.append(
                WorkbenchWeekDayMetrics(
                    local_date=summary.local_date,
                    upload_count=summary.upload_count,
                    uploaded_users=summary.uploaded_users,
                    risky_patient_count=summary.risky_patient_count,
                    unhandled_patient_count=summary.unhandled_patient_count,
                )
            )
    return result


def get_workbench_dashboard(
    session: Session,
    *,
    local_date: date,
    week_start: date,
    accessible_patient_ids: set[int] | None = None,
) -> WorkbenchDashboardData:
    available_dates = list_workbench_dates(session, accessible_patient_ids=accessible_patient_ids)
    week_days = aggregate_workbench_week(
        session,
        week_start=week_start,
        accessible_patient_ids=accessible_patient_ids,
    )
    attention_date, total_uploads, attention_rows = list_today_attention_patients(
        session,
        accessible_patient_ids=accessible_patient_ids,
        local_date=local_date,
    )
    return WorkbenchDashboardData(
        local_date=attention_date,
        week_start=week_start,
        available_dates=available_dates,
        week_days=week_days,
        attention_total_uploads=total_uploads,
        attention_rows=attention_rows,
    )
