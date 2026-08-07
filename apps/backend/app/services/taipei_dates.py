from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy.sql.elements import ColumnElement

TAIPEI_TIMEZONE = timezone(timedelta(hours=8))


def normalize_datetime(raw_dt: datetime) -> datetime:
    if getattr(raw_dt, "tzinfo", None) is not None:
        return raw_dt
    return raw_dt.replace(tzinfo=timezone.utc)


def to_taipei_date(raw_dt: datetime) -> date:
    return normalize_datetime(raw_dt).astimezone(TAIPEI_TIMEZONE).date()


def upload_taipei_local_date_expr(created_at_column: ColumnElement[Any], *, dialect_name: str) -> ColumnElement[Any]:
    """SQL expression for Upload.created_at as a Taipei calendar date."""
    from sqlalchemy import func

    if dialect_name == "postgresql":
        return func.date(func.timezone("Asia/Taipei", created_at_column))
    # SQLite tests: fixed +8h offset matches to_taipei_date() for UTC-stored timestamps.
    return func.date(func.datetime(created_at_column, "+8 hours"))


def coerce_sql_local_date(value: date | str) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def resolve_taipei_day_bounds_for_date(local_day: date) -> tuple[date, datetime, datetime]:
    local_start = datetime.combine(local_day, time.min, tzinfo=TAIPEI_TIMEZONE)
    local_end = local_start + timedelta(days=1)
    return local_day, local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


def resolve_taipei_day_bounds(reference_dt: datetime | None = None) -> tuple[date, datetime, datetime]:
    resolved_reference = reference_dt if reference_dt is not None else datetime.now(tz=timezone.utc)
    local_day = normalize_datetime(resolved_reference).astimezone(TAIPEI_TIMEZONE).date()
    return resolve_taipei_day_bounds_for_date(local_day)
