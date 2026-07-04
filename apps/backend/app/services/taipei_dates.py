from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

TAIPEI_TIMEZONE = timezone(timedelta(hours=8))


def normalize_datetime(raw_dt: datetime) -> datetime:
    if getattr(raw_dt, "tzinfo", None) is not None:
        return raw_dt
    return raw_dt.replace(tzinfo=timezone.utc)


def to_taipei_date(raw_dt: datetime) -> date:
    return normalize_datetime(raw_dt).astimezone(TAIPEI_TIMEZONE).date()


def resolve_taipei_day_bounds(reference_dt: datetime | None = None) -> tuple[date, datetime, datetime]:
    resolved_reference = reference_dt if reference_dt is not None else datetime.now(tz=timezone.utc)
    local_day = normalize_datetime(resolved_reference).astimezone(TAIPEI_TIMEZONE).date()
    local_start = datetime.combine(local_day, time.min, tzinfo=TAIPEI_TIMEZONE)
    local_end = local_start + timedelta(days=1)
    return local_day, local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)
