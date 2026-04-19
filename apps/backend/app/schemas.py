from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(examples=["ok"])


class ReadyResponse(BaseModel):
    status: str = Field(examples=["ready"])
    model_loaded: bool
    device: str


class ClassProbability(BaseModel):
    class_index: int
    class_name: str
    probability: float


class ScreeningResult(BaseModel):
    infection_class_index: int
    infection_class_name: str
    infection_probability: float
    threshold: float
    is_infection_positive: bool


class PredictionResponse(BaseModel):
    predicted_class_index: int
    predicted_class_name: str
    predicted_probability: float
    class_probabilities: list[ClassProbability]
    screening: ScreeningResult

