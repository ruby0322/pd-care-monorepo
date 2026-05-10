from __future__ import annotations

from pydantic import BaseModel, Field


class UploadHistoryDayResponse(BaseModel):
    date: str = Field(examples=["2026-05-09"])
    upload_count: int = Field(ge=0)
    has_suspected_risk: bool


class UploadHistoryResponse(BaseModel):
    status: str = Field(examples=["matched", "pending", "unbound"])
    patient_id: int | None
    can_upload: bool
    days: list[UploadHistoryDayResponse]
