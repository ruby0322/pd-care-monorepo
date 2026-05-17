from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(examples=["ok"])


class ReadyResponse(BaseModel):
    status: str = Field(examples=["ready"])
    model_loaded: bool
    device: str
    prescreen_enabled: bool
    prescreen_model_loaded: bool
