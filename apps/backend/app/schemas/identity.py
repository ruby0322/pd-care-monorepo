from __future__ import annotations

from pydantic import BaseModel, Field


class BindIdentityRequest(BaseModel):
    line_user_id: str = Field(min_length=1, max_length=128)
    display_name: str | None = Field(default=None, max_length=255)
    picture_url: str | None = Field(default=None, max_length=1024)
    case_number: str = Field(min_length=1, max_length=64)
    birth_date: str = Field(min_length=1, max_length=16)


class IdentityBindResponse(BaseModel):
    status: str = Field(examples=["matched", "pending"])
    patient_id: int | None
    can_upload: bool


class IdentityStatusResponse(BaseModel):
    status: str = Field(examples=["matched", "pending", "unbound"])
    patient_id: int | None
    can_upload: bool
