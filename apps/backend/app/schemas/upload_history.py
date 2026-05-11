from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UploadHistoryDayResponse(BaseModel):
    date: str = Field(examples=["2026-05-09"])
    upload_count: int = Field(ge=0)
    has_suspected_risk: bool


class UploadHistorySummary28dResponse(BaseModel):
    all_upload_count_28d: int = Field(ge=0)
    suspected_upload_count_28d: int = Field(ge=0)
    continuous_upload_streak_days: int = Field(ge=0, le=28)


class UploadHistoryResponse(BaseModel):
    status: str = Field(examples=["matched", "pending", "unbound"])
    patient_id: int | None
    can_upload: bool
    days: list[UploadHistoryDayResponse]
    summary_28d: UploadHistorySummary28dResponse


class PatientDayUploadItemResponse(BaseModel):
    upload_id: int
    created_at: datetime
    screening_result: Literal["normal", "suspected", "rejected", "technical_error"]
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    annotation_label: str | None
    annotation_comment: str | None


class PatientDayUploadListResponse(BaseModel):
    date: str = Field(examples=["2026-05-11"])
    items: list[PatientDayUploadItemResponse]


class PatientUploadDetailResponse(BaseModel):
    upload_id: int
    created_at: datetime
    date: str = Field(examples=["2026-05-11"])
    screening_result: Literal["normal", "suspected", "rejected", "technical_error"]
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    annotation_label: str | None
    annotation_comment: str | None
    image_url: str
    image_expires_in: int = Field(ge=1)
    prev_upload_id: int | None
    next_upload_id: int | None
