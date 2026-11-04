from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import bearer_scheme, get_current_principal, require_staff_or_admin
from app.schemas.staff_dashboard import (
    StaffActiveUsersSeriesPoint,
    StaffActiveUsersSeriesResponse,
    StaffAgeHistogramBucket,
    StaffAgeHistogramResponse,
    StaffDailySuspectedSeriesPoint,
    StaffDailySuspectedSeriesResponse,
    StaffGenderDistributionItem,
    StaffGenderDistributionResponse,
    StaffTodaySuspectedSummaryResponse,
)
from app.services.staff_dashboard import (
    get_active_users_series,
    get_age_histogram,
    get_daily_suspected_series,
    get_period_suspected_summary,
    get_today_suspected_summary,
    list_gender_distribution,
)

from .shared import get_staff_session

# De-identified cohort aggregates: counts and trends only, never patient identity.
# Unlike /v1/staff/admin/analytics/* these are open to staff as well as admin, because
# cohort-level operational insight carries no per-patient disclosure.
router = APIRouter(tags=["Staff"])


@router.get("/v1/staff/analytics/suspected-series", response_model=StaffDailySuspectedSeriesResponse)
async def get_cohort_daily_suspected_series(
    request: Request,
    lookback_days: int = Query(default=30, ge=7, le=365),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffDailySuspectedSeriesResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    rows = get_daily_suspected_series(session, lookback_days=lookback_days, accessible_patient_ids=None)
    return StaffDailySuspectedSeriesResponse(
        lookback_days=lookback_days,
        items=[
            StaffDailySuspectedSeriesPoint(
                date=day,
                total_uploads=total,
                suspected_uploads=suspected,
                symptom_elevated_uploads=elevated,
                suspected_ratio=(suspected / total) if total > 0 else 0.0,
            )
            for day, total, suspected, elevated in rows
        ],
    )


@router.get("/v1/staff/analytics/suspected-summary", response_model=StaffTodaySuspectedSummaryResponse)
async def get_cohort_suspected_summary(
    request: Request,
    months: int | None = Query(default=None, ge=1, le=60),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffTodaySuspectedSummaryResponse:
    """Today summary when months is omitted; otherwise aggregate over the trailing month window."""
    require_staff_or_admin(get_current_principal(request, credentials))
    if months is None:
        (
            summary_date,
            total_uploads,
            suspected_uploads,
            symptom_elevated_uploads,
            suspected_users,
            symptom_elevated_users,
        ) = get_today_suspected_summary(session, accessible_patient_ids=None)
    else:
        (
            summary_date,
            total_uploads,
            suspected_uploads,
            symptom_elevated_uploads,
            suspected_users,
            symptom_elevated_users,
        ) = get_period_suspected_summary(session, months=months, accessible_patient_ids=None)
    normal_uploads = max(total_uploads - suspected_uploads - symptom_elevated_uploads, 0)
    return StaffTodaySuspectedSummaryResponse(
        date=summary_date.isoformat(),
        total_uploads=total_uploads,
        suspected_uploads=suspected_uploads,
        symptom_elevated_uploads=symptom_elevated_uploads,
        suspected_users=suspected_users,
        symptom_elevated_users=symptom_elevated_users,
        normal_uploads=normal_uploads,
        suspected_ratio=(suspected_uploads / total_uploads) if total_uploads > 0 else 0.0,
    )


@router.get("/v1/staff/analytics/age-histogram", response_model=StaffAgeHistogramResponse)
async def get_cohort_age_histogram(
    request: Request,
    bucket_size: int = Query(default=10, ge=1, le=30),
    include_inactive: bool = Query(default=False),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAgeHistogramResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    rows = get_age_histogram(
        session,
        bucket_size=bucket_size,
        include_inactive=include_inactive,
        accessible_patient_ids=None,
    )
    items = [
        StaffAgeHistogramBucket(
            range_start=start,
            range_end=start + bucket_size - 1,
            label=f"{start}-{start + bucket_size - 1}",
            count=count,
        )
        for start, count in rows
    ]
    return StaffAgeHistogramResponse(
        bucket_size=bucket_size,
        total_patients=sum(item.count for item in items),
        items=items,
    )


@router.get("/v1/staff/analytics/gender-distribution", response_model=StaffGenderDistributionResponse)
async def get_cohort_gender_distribution(
    request: Request,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffGenderDistributionResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    rows = list_gender_distribution(session, accessible_patient_ids=None)
    items = [StaffGenderDistributionItem(gender=gender, count=count) for gender, count in rows]
    return StaffGenderDistributionResponse(
        total_patients=sum(item.count for item in items),
        items=items,
    )


@router.get("/v1/staff/analytics/active-users", response_model=StaffActiveUsersSeriesResponse)
async def get_cohort_active_users_series(
    request: Request,
    active_window_days: int = Query(default=7, ge=1, le=120),
    lookback_days: int = Query(default=30, ge=7, le=365),
    interval: str = Query(default="day", pattern="^(day|week)$"),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffActiveUsersSeriesResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    rows = get_active_users_series(
        session,
        active_window_days=active_window_days,
        lookback_days=lookback_days,
        interval=interval,
        accessible_patient_ids=None,
    )
    return StaffActiveUsersSeriesResponse(
        active_window_days=active_window_days,
        lookback_days=lookback_days,
        interval=interval,  # type: ignore[arg-type]
        items=[
            StaffActiveUsersSeriesPoint(date=day, active_users=active_count, registered_users=registered_count)
            for day, active_count, registered_count in rows
        ],
    )
