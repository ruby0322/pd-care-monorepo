from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class StaffPatientSummary(BaseModel):
    patient_id: int
    case_number: str
    full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    line_display_name: str | None
    line_user_id: str | None
    age: int | None
    upload_count: int
    suspected_count: int
    latest_upload_at: datetime | None
    is_active: bool


class StaffPatientListResponse(BaseModel):
    months: int
    total_patients: int
    total_uploads: int
    suspected_patients: int
    limit: int
    offset: int
    items: list[StaffPatientSummary]


class StaffUploadRecord(BaseModel):
    upload_id: int
    created_at: datetime
    screening_result: str
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    content_type: str
    has_annotation: bool


class StaffPatientUploadsResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[StaffUploadRecord]


class StaffPatientUploadCalendarItem(BaseModel):
    date: str
    upload_count: int
    has_suspected_risk: bool


class StaffPatientUploadCalendarResponse(BaseModel):
    items: list[StaffPatientUploadCalendarItem]


class StaffPatientDetailResponse(BaseModel):
    patient_id: int
    case_number: str
    full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    birth_date: str
    age: int | None
    line_display_name: str | None
    line_user_id: str | None
    is_active: bool
    total_uploads: int
    suspected_uploads: int
    rejected_uploads: int


class StaffUploadQueueItem(BaseModel):
    upload_id: int
    patient_id: int
    case_number: str
    full_name: str | None
    line_user_id: str | None
    created_at: datetime
    screening_result: str
    probability: float | None
    threshold: float | None
    model_version: str | None
    has_annotation: bool
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool


class StaffUploadQueueResponse(BaseModel):
    items: list[StaffUploadQueueItem]


class StaffHistoryOverviewDayItem(BaseModel):
    local_date: str
    upload_count: int
    uploaded_users: int
    suspected_infected_users: int
    infection_rate: float
    risky_patient_count: int
    has_infection_risk: bool


class StaffHistoryOverviewDaysResponse(BaseModel):
    items: list[StaffHistoryOverviewDayItem]


class StaffHistoryOverviewKpi(BaseModel):
    uploaded_users: int
    uploads: int
    suspected_infected_users: int
    infection_rate: float


class StaffHistoryOverviewUploadItem(BaseModel):
    upload_id: int
    patient_id: int
    case_number: str
    patient_full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    line_user_id: str | None
    line_display_name: str | None
    real_name: str | None
    picture_url: str | None
    age: int | None
    created_at: datetime
    screening_result: str
    probability: float | None
    threshold: float | None
    model_version: str | None
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    annotation_label: str | None
    annotation_comment: str | None
    risk_rank: int


class StaffHistoryOverviewUserGroupItem(BaseModel):
    patient_id: int
    case_number: str
    patient_full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    age: int | None
    line_user_id: str | None
    line_display_name: str | None
    real_name: str | None
    picture_url: str | None
    upload_count: int
    highest_risk_rank: int
    highest_risk_count: int
    latest_upload_at: datetime | None
    uploads: list[StaffHistoryOverviewUploadItem]


class StaffHistoryOverviewResponse(BaseModel):
    local_date: str
    sort_by: Literal["timeline", "risk"]
    group_by_user: bool
    group_sort_by: Literal["uploads", "age", "infection_risk"]
    kpi: StaffHistoryOverviewKpi
    items: list[StaffHistoryOverviewUploadItem]
    groups: list[StaffHistoryOverviewUserGroupItem]


class StaffHistoryOverviewCalendarItem(BaseModel):
    local_date: str
    risky_patient_count: int
    has_infection_risk: bool


class StaffHistoryOverviewCalendarResponse(BaseModel):
    year: int
    month: int
    items: list[StaffHistoryOverviewCalendarItem]


class StaffAnnotationUpsertRequest(BaseModel):
    label: Literal["normal", "suspected", "confirmed_infection", "rejected"]
    comment: str | None = Field(default=None, max_length=500)


class StaffAnnotationItem(BaseModel):
    id: int
    upload_id: int
    patient_id: int
    label: str
    comment: str | None
    reviewer_line_user_id: str
    created_at: datetime


class StaffAnnotationListResponse(BaseModel):
    items: list[StaffAnnotationItem]


class StaffPendingCandidatePatient(BaseModel):
    patient_id: int
    case_number: str
    full_name: str | None


class StaffPendingBindingItem(BaseModel):
    id: int
    line_user_id: str
    case_number: str
    birth_date: str
    status: str
    created_at: datetime
    candidates: list[StaffPendingCandidatePatient]


class StaffPendingBindingListResponse(BaseModel):
    items: list[StaffPendingBindingItem]


class StaffPendingBindingBulkRejectResponse(BaseModel):
    rejected_count: int


class StaffPendingBindingLinkRequest(BaseModel):
    patient_id: int = Field(ge=1)


class StaffPendingBindingCreatePatientRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)


class StaffPatientStatusUpdateRequest(BaseModel):
    is_active: bool


class StaffPatientBulkDeleteRequest(BaseModel):
    patient_ids: list[int] = Field(min_length=1)


class StaffPatientBulkDeleteImpact(BaseModel):
    patients: int
    uploads: int
    ai_results: int
    annotations: int
    notifications: int
    assignments: int


class StaffPatientBulkDeletePreviewResponse(BaseModel):
    requested_count: int
    deletable_count: int
    skipped_active_count: int
    skipped_forbidden_count: int
    skipped_missing_count: int
    impact: StaffPatientBulkDeleteImpact


class StaffPatientBulkDeleteResultResponse(BaseModel):
    requested_count: int
    deleted_count: int
    skipped_active_count: int
    skipped_forbidden_count: int
    skipped_missing_count: int
    impact: StaffPatientBulkDeleteImpact


class StaffPatientCreateRequest(BaseModel):
    case_number: str = Field(min_length=1, max_length=64)
    birth_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    full_name: str = Field(min_length=1, max_length=255)
    gender: Literal["male", "female", "other", "unknown"] = "unknown"


class StaffPatientCreateResponse(BaseModel):
    patient_id: int
    case_number: str
    birth_date: str
    full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    is_active: bool


class StaffAssignmentItem(BaseModel):
    patient_id: int
    case_number: str
    patient_full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    picture_url: str | None
    staff_identity_id: int | None
    staff_line_user_id: str | None
    staff_display_name: str | None


class StaffAssignmentListResponse(BaseModel):
    items: list[StaffAssignmentItem]
    total: int
    limit: int
    offset: int


class StaffAssignmentByStaffPatientItem(BaseModel):
    patient_id: int
    case_number: str
    patient_full_name: str | None
    gender: Literal["male", "female", "other", "unknown"]
    picture_url: str | None


class StaffAssignmentByStaffItem(BaseModel):
    staff_identity_id: int
    assigned_count: int
    assigned_patients: list[StaffAssignmentByStaffPatientItem]


class StaffAssignmentByStaffListResponse(BaseModel):
    items: list[StaffAssignmentByStaffItem]


class StaffAssignmentUpsertRequest(BaseModel):
    patient_id: int = Field(ge=1)
    staff_identity_id: int = Field(ge=1)


class StaffAssignmentUpsertResult(BaseModel):
    patient_id: int
    staff_identity_id: int
    status: Literal["updated", "unchanged"]


class StaffAssignmentUnassignResult(BaseModel):
    patient_id: int
    status: Literal["updated", "unchanged"]


class StaffAssignmentBulkRequest(BaseModel):
    assignments: list[StaffAssignmentUpsertRequest] = Field(min_length=1)


class StaffAssignmentBulkItemResult(BaseModel):
    patient_id: int | None = None
    staff_identity_id: int | None = None
    status: Literal["updated", "unchanged", "invalid"]
    detail: str | None = None


class StaffAssignmentBulkResponse(BaseModel):
    results: list[StaffAssignmentBulkItemResult]


class StaffNotificationItem(BaseModel):
    id: int
    patient_id: int
    patient_case_number: str
    patient_full_name: str | None
    upload_id: int
    ai_result_id: int | None
    screening_result: str | None
    probability: float | None
    summary: str | None
    status: str
    created_at: datetime


class StaffNotificationListResponse(BaseModel):
    items: list[StaffNotificationItem]
    total: int
    unread_count: int
    limit: int
    offset: int


class StaffGenderDistributionItem(BaseModel):
    gender: Literal["male", "female", "other", "unknown"]
    count: int


class StaffGenderDistributionResponse(BaseModel):
    total_patients: int
    items: list[StaffGenderDistributionItem]


class StaffTodaySuspectedSummaryResponse(BaseModel):
    date: str
    total_uploads: int
    suspected_uploads: int
    normal_uploads: int
    suspected_ratio: float


class StaffAgeHistogramBucket(BaseModel):
    range_start: int
    range_end: int
    label: str
    count: int


class StaffAgeHistogramResponse(BaseModel):
    bucket_size: int
    total_patients: int
    items: list[StaffAgeHistogramBucket]


class StaffActiveUsersSeriesPoint(BaseModel):
    date: str
    active_users: int


class StaffActiveUsersSeriesResponse(BaseModel):
    active_window_days: int
    lookback_days: int
    interval: Literal["day", "week"]
    items: list[StaffActiveUsersSeriesPoint]


class StaffDailySuspectedSeriesPoint(BaseModel):
    date: str
    total_uploads: int
    suspected_uploads: int
    suspected_ratio: float


class StaffDailySuspectedSeriesResponse(BaseModel):
    lookback_days: int
    items: list[StaffDailySuspectedSeriesPoint]
