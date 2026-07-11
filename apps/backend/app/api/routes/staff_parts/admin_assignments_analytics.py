from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps.auth import bearer_scheme, get_current_principal, require_admin
from app.schemas.staff_dashboard import (
    StaffActiveUsersSeriesPoint,
    StaffActiveUsersSeriesResponse,
    StaffAgeHistogramBucket,
    StaffAgeHistogramResponse,
    StaffAssignmentBulkItemResult,
    StaffAssignmentBulkRequest,
    StaffAssignmentBulkResponse,
    StaffAssignmentByStaffItem,
    StaffAssignmentByStaffListResponse,
    StaffAssignmentByStaffPatientItem,
    StaffAssignmentItem,
    StaffAssignmentListResponse,
    StaffAssignmentUnassignResult,
    StaffAssignmentUpsertRequest,
    StaffAssignmentUpsertResult,
    StaffDailySuspectedSeriesPoint,
    StaffDailySuspectedSeriesResponse,
    StaffGenderDistributionItem,
    StaffGenderDistributionResponse,
    StaffTodaySuspectedSummaryResponse,
)
from app.services.staff_dashboard import (
    bulk_assign_patients,
    ensure_staff_assignment,
    get_active_users_series,
    get_age_histogram,
    get_daily_suspected_series,
    get_today_suspected_summary,
    list_patient_assignments,
    list_patient_assignments_by_staff,
    list_staff_patients,
    list_gender_distribution,
    unassign_patient,
)

from .shared import get_staff_session

router = APIRouter(tags=["Staff"])

_GENDER_VALUES = frozenset({"male", "female", "other", "unknown"})


def _normalize_patient_gender(value: str | None) -> Literal["male", "female", "other", "unknown"]:
    if value in _GENDER_VALUES:
        return value  # type: ignore[return-value]
    return "unknown"


def _list_filtered_patient_ids_for_admin_analytics(
    session: Session,
    *,
    query: str | None,
    months: int,
    age_min: int | None,
    age_max: int | None,
    infection_status: str,
    binding_filter: str,
    is_active_filter: str,
    created_from: date | None,
    created_to: date | None,
) -> set[int]:
    rows = list_staff_patients(
        session,
        query=query,
        months=months,
        age_min=age_min,
        age_max=age_max,
        infection_status=infection_status,
        binding_filter=binding_filter,
        is_active_filter=is_active_filter,
        created_from=created_from,
        created_to=created_to,
        accessible_patient_ids=None,
    )
    return {row.patient.id for row in rows}


@router.get("/v1/staff/admin/assignments", response_model=StaffAssignmentListResponse)
async def list_admin_assignments(
    request: Request,
    query: str | None = Query(default=None, min_length=1, max_length=128),
    binding_filter: str = Query(default="bound", pattern="^(bound|all|unbound_only)$"),
    assignment_filter: str | None = Query(default=None, pattern="^(all|assigned|unassigned)$"),
    assignee_role: str = Query(default="all", pattern="^(all|staff|admin)$"),
    assignee_active: str = Query(default="all", pattern="^(all|active|inactive)$"),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAssignmentListResponse:
    require_admin(get_current_principal(request, credentials))
    rows, total = list_patient_assignments(
        session,
        query=query,
        assignment_filter=assignment_filter,
        binding_filter=binding_filter,
        assignee_role=assignee_role,
        assignee_active=assignee_active,
        limit=limit,
        offset=offset,
    )
    return StaffAssignmentListResponse(
        items=[
            StaffAssignmentItem(
                patient_id=row.patient.id,
                case_number=row.patient.case_number,
                patient_full_name=row.patient.full_name,
                gender=_normalize_patient_gender(row.patient.gender),
                picture_url=row.patient_picture_url,
                staff_identity_id=row.staff_identity_id,
                staff_line_user_id=row.staff_line_user_id,
                staff_display_name=row.staff_display_name,
            )
            for row in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/v1/staff/admin/assignments/by-staff", response_model=StaffAssignmentByStaffListResponse)
async def list_admin_assignments_by_staff(
    request: Request,
    staff_identity_ids: list[int] = Query(default=[]),
    staff_identity_ids_bracket: list[int] = Query(default=[], alias="staff_identity_ids[]"),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAssignmentByStaffListResponse:
    require_admin(get_current_principal(request, credentials))
    merged_staff_ids = [*staff_identity_ids, *staff_identity_ids_bracket]
    grouped_rows = list_patient_assignments_by_staff(
        session,
        staff_identity_ids=merged_staff_ids,
    )
    requested_staff_ids = sorted({staff_id for staff_id in merged_staff_ids if staff_id > 0})
    return StaffAssignmentByStaffListResponse(
        items=[
            StaffAssignmentByStaffItem(
                staff_identity_id=staff_id,
                assigned_count=len(grouped_rows.get(staff_id, [])),
                assigned_patients=[
                    StaffAssignmentByStaffPatientItem(
                        patient_id=patient_id,
                        case_number=case_number,
                        patient_full_name=patient_full_name,
                        gender=_normalize_patient_gender(gender),
                        picture_url=picture_url,
                    )
                    for patient_id, case_number, patient_full_name, gender, picture_url in grouped_rows.get(staff_id, [])
                ],
            )
            for staff_id in requested_staff_ids
        ]
    )


@router.post("/v1/staff/admin/assignments", response_model=StaffAssignmentUpsertResult)
async def upsert_admin_assignment(
    request: Request,
    payload: StaffAssignmentUpsertRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAssignmentUpsertResult:
    require_admin(get_current_principal(request, credentials))
    try:
        status = ensure_staff_assignment(
            session,
            staff_identity_id=payload.staff_identity_id,
            patient_id=payload.patient_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StaffAssignmentUpsertResult(
        patient_id=payload.patient_id,
        staff_identity_id=payload.staff_identity_id,
        status=status,
    )


@router.delete("/v1/staff/admin/assignments/{patient_id}", response_model=StaffAssignmentUnassignResult)
async def delete_admin_assignment(
    request: Request,
    patient_id: int,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAssignmentUnassignResult:
    require_admin(get_current_principal(request, credentials))
    try:
        status = unassign_patient(session, patient_id=patient_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StaffAssignmentUnassignResult(
        patient_id=patient_id,
        status=status,
    )


@router.post("/v1/staff/admin/assignments/bulk", response_model=StaffAssignmentBulkResponse)
async def bulk_upsert_admin_assignment(
    request: Request,
    payload: StaffAssignmentBulkRequest,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAssignmentBulkResponse:
    require_admin(get_current_principal(request, credentials))
    rows = bulk_assign_patients(
        session,
        assignments=[(item.patient_id, item.staff_identity_id) for item in payload.assignments],
    )
    return StaffAssignmentBulkResponse(
        results=[
            StaffAssignmentBulkItemResult(
                patient_id=row.patient_id,
                staff_identity_id=row.staff_identity_id,
                status=row.status,
                detail=row.detail,
            )
            for row in rows
        ]
    )


@router.get("/v1/staff/admin/analytics/gender-distribution", response_model=StaffGenderDistributionResponse)
async def get_admin_gender_distribution(
    request: Request,
    query: str | None = Query(default=None, min_length=1, max_length=128),
    months: int = Query(default=12, ge=1, le=60),
    age_min: int | None = Query(default=None, ge=0),
    age_max: int | None = Query(default=None, ge=0),
    infection_status: str = Query(default="all", pattern="^(all|suspected|normal)$"),
    binding_filter: str = Query(default="all", pattern="^(bound|all|unbound_only)$"),
    is_active_filter: str = Query(default="all", pattern="^(all|active|inactive)$"),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffGenderDistributionResponse:
    require_admin(get_current_principal(request, credentials))
    filtered_patient_ids = _list_filtered_patient_ids_for_admin_analytics(
        session,
        query=query,
        months=months,
        age_min=age_min,
        age_max=age_max,
        infection_status=infection_status,
        binding_filter=binding_filter,
        is_active_filter=is_active_filter,
        created_from=created_from,
        created_to=created_to,
    )
    rows = list_gender_distribution(session, accessible_patient_ids=filtered_patient_ids)
    items = [StaffGenderDistributionItem(gender=gender, count=count) for gender, count in rows]
    return StaffGenderDistributionResponse(
        total_patients=sum(item.count for item in items),
        items=items,
    )


@router.get("/v1/staff/admin/analytics/suspected-infections/today", response_model=StaffTodaySuspectedSummaryResponse)
async def get_admin_today_suspected_summary(
    request: Request,
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffTodaySuspectedSummaryResponse:
    require_admin(get_current_principal(request, credentials))
    summary_date, total_uploads, suspected_uploads = get_today_suspected_summary(
        session, accessible_patient_ids=None
    )
    normal_uploads = max(total_uploads - suspected_uploads, 0)
    ratio = (suspected_uploads / total_uploads) if total_uploads > 0 else 0.0
    return StaffTodaySuspectedSummaryResponse(
        date=summary_date.isoformat(),
        total_uploads=total_uploads,
        suspected_uploads=suspected_uploads,
        normal_uploads=normal_uploads,
        suspected_ratio=ratio,
    )


@router.get("/v1/staff/admin/analytics/age-histogram", response_model=StaffAgeHistogramResponse)
async def get_admin_age_histogram(
    request: Request,
    query: str | None = Query(default=None, min_length=1, max_length=128),
    months: int = Query(default=12, ge=1, le=60),
    age_min: int | None = Query(default=None, ge=0),
    age_max: int | None = Query(default=None, ge=0),
    infection_status: str = Query(default="all", pattern="^(all|suspected|normal)$"),
    binding_filter: str = Query(default="all", pattern="^(bound|all|unbound_only)$"),
    is_active_filter: str = Query(default="all", pattern="^(all|active|inactive)$"),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    bucket_size: int = Query(default=10, ge=1, le=30),
    include_inactive: bool = Query(default=False),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffAgeHistogramResponse:
    require_admin(get_current_principal(request, credentials))
    filtered_patient_ids = _list_filtered_patient_ids_for_admin_analytics(
        session,
        query=query,
        months=months,
        age_min=age_min,
        age_max=age_max,
        infection_status=infection_status,
        binding_filter=binding_filter,
        is_active_filter=is_active_filter,
        created_from=created_from,
        created_to=created_to,
    )
    rows = get_age_histogram(
        session,
        bucket_size=bucket_size,
        include_inactive=include_inactive,
        accessible_patient_ids=filtered_patient_ids,
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


@router.get("/v1/staff/admin/analytics/active-users", response_model=StaffActiveUsersSeriesResponse)
async def get_admin_active_users_series(
    request: Request,
    active_window_days: int = Query(default=7, ge=1, le=120),
    lookback_days: int = Query(default=30, ge=7, le=365),
    interval: str = Query(default="day", pattern="^(day|week)$"),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffActiveUsersSeriesResponse:
    require_admin(get_current_principal(request, credentials))
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
        items=[StaffActiveUsersSeriesPoint(date=day, active_users=count) for day, count in rows],
    )


@router.get("/v1/staff/admin/analytics/daily-suspected-series", response_model=StaffDailySuspectedSeriesResponse)
async def get_admin_daily_suspected_series(
    request: Request,
    lookback_days: int = Query(default=30, ge=7, le=365),
    credentials=Depends(bearer_scheme),
    session: Session = Depends(get_staff_session),
) -> StaffDailySuspectedSeriesResponse:
    require_admin(get_current_principal(request, credentials))
    rows = get_daily_suspected_series(
        session,
        lookback_days=lookback_days,
        accessible_patient_ids=None,
    )
    return StaffDailySuspectedSeriesResponse(
        lookback_days=lookback_days,
        items=[
            StaffDailySuspectedSeriesPoint(
                date=day,
                total_uploads=total,
                suspected_uploads=suspected,
                suspected_ratio=(suspected / total) if total > 0 else 0.0,
            )
            for day, total, suspected in rows
        ],
    )
