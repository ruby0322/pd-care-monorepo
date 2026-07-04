from __future__ import annotations

from datetime import date, datetime, timezone

from app.services.taipei_dates import resolve_taipei_day_bounds, to_taipei_date


def test_to_taipei_date_maps_utc_boundary_to_next_local_day() -> None:
    # 17:10 UTC is the next calendar day in Asia/Taipei (+08:00).
    upload_at = datetime(2026, 5, 10, 17, 10, tzinfo=timezone.utc)
    assert to_taipei_date(upload_at) == date(2026, 5, 11)


def test_resolve_taipei_day_bounds_uses_reference_datetime() -> None:
    reference = datetime(2026, 6, 30, 20, 0, tzinfo=timezone.utc)
    local_day, local_start, local_end = resolve_taipei_day_bounds(reference)
    assert local_day == date(2026, 7, 1)
    assert local_start == datetime(2026, 6, 30, 16, 0, tzinfo=timezone.utc)
    assert local_end == datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc)
