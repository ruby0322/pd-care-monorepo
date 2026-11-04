from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

CopilotVisibility = Literal["private", "staff", "admin"]


class CopilotModelsResponse(BaseModel):
    enabled: bool
    models: list[str]
    default_model: str | None


class CopilotSessionSummary(BaseModel):
    session_id: int
    title: str
    model: str
    visibility: CopilotVisibility
    owner_identity_id: int
    owner_name: str | None
    is_owner: bool
    can_write: bool
    message_count: int
    created_at: datetime
    updated_at: datetime


class CopilotSessionListResponse(BaseModel):
    items: list[CopilotSessionSummary]


class CopilotMessageItem(BaseModel):
    message_id: int
    role: Literal["user", "assistant"]
    content: str
    model: str | None
    tool_trace: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime


class CopilotSessionDetailResponse(BaseModel):
    session: CopilotSessionSummary
    messages: list[CopilotMessageItem]


class CopilotSessionCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    model: str | None = None
    visibility: CopilotVisibility = "private"


class CopilotSessionUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    model: str | None = None
    visibility: CopilotVisibility | None = None


class CopilotMessageCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class CopilotProxyRequest(BaseModel):
    tool: str = Field(min_length=1, max_length=128)
    params: dict[str, Any] = Field(default_factory=dict)


class CopilotProxyResponse(BaseModel):
    tool: str
    ok: bool
    status: int | None
    data: Any
