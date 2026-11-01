from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


RoleType = Literal["patient", "staff", "admin"]
AccessRequestStatus = Literal["pending", "approved", "rejected"]


class HealthcarePermissionRequestCreateRequest(BaseModel):
    line_id_token: str = Field(min_length=1, max_length=4096)


class HealthcarePermissionRequestStatusRequest(BaseModel):
    line_id_token: str = Field(min_length=1, max_length=4096)


class HealthcarePermissionRequestCreateResponse(BaseModel):
    request_id: int
    status: AccessRequestStatus


class HealthcarePermissionRequestStatusResponse(BaseModel):
    status: AccessRequestStatus | Literal["none"]
    reject_reason: str | None
    decision_role: RoleType | None


class AdminHealthcarePermissionRequestItem(BaseModel):
    id: int
    requester_identity_id: int
    line_user_id: str
    display_name: str | None
    requester_role: RoleType
    status: AccessRequestStatus
    reject_reason: str | None
    decision_role: RoleType | None
    created_at: datetime
    decided_at: datetime | None


class AdminHealthcarePermissionRequestListResponse(BaseModel):
    items: list[AdminHealthcarePermissionRequestItem]


class AdminApproveHealthcarePermissionRequest(BaseModel):
    role: Literal["staff", "admin"]
    reason: str | None = Field(default=None, max_length=500)


class AdminRejectHealthcarePermissionRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class AdminIdentityWorkloadStats(BaseModel):
    assigned_patient_count: int
    assigned_upload_count: int
    labeled_assigned_upload_count: int
    labeled_assigned_ratio: float
    reviewed_upload_count: int
    last_reviewed_at: datetime | None


class AdminIdentityItem(BaseModel):
    id: int
    line_user_id: str
    display_name: str | None
    real_name: str | None
    picture_url: str | None
    role: RoleType
    is_active: bool
    patient_id: int | None
    created_at: datetime
    workload: AdminIdentityWorkloadStats | None = None


class AdminIdentityListResponse(BaseModel):
    items: list[AdminIdentityItem]
    total: int
    limit: int
    offset: int


class AdminUpdateIdentityRoleRequest(BaseModel):
    role: RoleType
    reason: str | None = Field(default=None, max_length=500)


class AdminUpdateIdentityStatusRequest(BaseModel):
    is_active: bool
    reason: str | None = Field(default=None, max_length=500)


class AdminUpdateIdentityRealNameRequest(BaseModel):
    real_name: str = Field(min_length=1, max_length=255)
    reason: str | None = Field(default=None, max_length=500)


class AdminIdentityBulkDeleteRequest(BaseModel):
    identity_ids: list[int] = Field(min_length=1)


class AdminIdentityBulkDeletePreviewResponse(BaseModel):
    requested_count: int
    deletable_count: int
    skipped_active_count: int
    skipped_missing_count: int


class AdminIdentityBulkDeleteResultResponse(BaseModel):
    requested_count: int
    deleted_count: int
    skipped_active_count: int
    skipped_missing_count: int


class AdminStaffOverviewItem(BaseModel):
    identity_id: int
    line_user_id: str
    display_name: str | None
    real_name: str | None
    picture_url: str | None
    role: Literal["staff", "admin"]
    is_active: bool
    assigned_patient_count: int
    assigned_upload_count: int
    labeled_assigned_upload_count: int
    labeled_assigned_ratio: float
    reviewed_upload_count: int
    review_count_7d: int
    review_count_30d: int
    last_review_at: datetime | None
    created_at: datetime


class AdminStaffOverviewSummary(BaseModel):
    staff_count: int
    staff_total: int
    truncated: bool
    active_staff_count: int
    pending_access_request_count: int
    zero_assignment_staff_count: int
    unassigned_patient_count: int


class AdminStaffOverviewResponse(BaseModel):
    items: list[AdminStaffOverviewItem]
    summary: AdminStaffOverviewSummary
