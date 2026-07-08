from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Literal


class StaffLineLoginRequest(BaseModel):
    line_id_token: str = Field(min_length=1, max_length=4096)


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    role: str
    line_user_id: str


AuthRole = Literal["patient", "staff", "admin"]
AuthNextStep = Literal["role_select", "onboarding_patient", "onboarding_admin", "patient_app", "app_selection"]
PatientBindingStatus = Literal["matched", "pending", "unbound"]
HealthcareAccessStatus = Literal["none", "pending", "approved", "rejected"]
AllowedApp = Literal["patient", "admin"]


class AuthBootstrapResponse(BaseModel):
    line_user_id: str
    identity_exists: bool
    role: AuthRole | None
    is_active: bool
    patient_binding_status: PatientBindingStatus
    healthcare_access_status: HealthcareAccessStatus
    next_step: AuthNextStep
    allowed_apps: list[AllowedApp]
