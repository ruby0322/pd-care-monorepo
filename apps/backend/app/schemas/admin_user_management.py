from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


RoleType = Literal["patient", "staff", "admin"]
AccessRequestStatus = Literal["pending", "approved", "rejected"]


class HealthcarePermissionRequestCreateRequest(BaseModel):
    line_user_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=255)
    picture_url: str | None = Field(default=None, max_length=1024)


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


class AdminIdentityItem(BaseModel):
    id: int
    line_user_id: str
    display_name: str | None
    role: RoleType
    is_active: bool
    patient_id: int | None
    created_at: datetime


class AdminIdentityListResponse(BaseModel):
    items: list[AdminIdentityItem]


class AdminUpdateIdentityRoleRequest(BaseModel):
    role: RoleType
    reason: str | None = Field(default=None, max_length=500)


class AdminUpdateIdentityStatusRequest(BaseModel):
    is_active: bool
    reason: str | None = Field(default=None, max_length=500)
