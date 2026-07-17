from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.prediction import PredictionResponse


class PatientUploadResponse(BaseModel):
    upload_id: int
    ai_result_id: int
    patient_id: int
    screening_result: str
    model_version: str | None
    threshold: float | None
    notification_id: int | None
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    symptom_cloudy_dialysate: bool
    has_high_risk_symptoms: bool
    symptom_aware_priority: Literal["normal", "suspected"]
    prediction: PredictionResponse | None


class PatientUploadResultResponse(BaseModel):
    upload_id: int
    ai_result_id: int
    patient_id: int
    screening_result: Literal["normal", "suspected", "rejected", "technical_error"]
    probability: float | None
    threshold: float | None
    model_version: str | None
    error_reason: str | None
    symptom_pain: bool
    symptom_discharge: bool
    symptom_pus: bool
    symptom_cloudy_dialysate: bool
    has_high_risk_symptoms: bool
    symptom_aware_priority: Literal["normal", "suspected"]
    created_at: datetime
