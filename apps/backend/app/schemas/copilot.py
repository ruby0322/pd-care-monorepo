from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

CopilotVisibility = Literal["private", "staff", "admin"]

# A truncated report page that renders wrong is worse than a clear rejection, so a module's
# html is capped and oversized payloads are rejected outright (422) rather than silently cut.
COPILOT_MODULE_HTML_MAX_BYTES = 512 * 1024


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


class CopilotHandleLabel(BaseModel):
    """A de-identified handle's real-world label, resolved for one viewer.

    ``label`` is ``None`` whenever the viewer cannot see the underlying entity (e.g. a
    patient not assigned to this staff member) -- that is a denial, not an error, so
    the frontend renders the bare handle rather than treating the key as missing.
    """

    entity_type: str
    label: str | None = None


class CopilotSessionDetailResponse(BaseModel):
    session: CopilotSessionSummary
    messages: list[CopilotMessageItem]
    handles: dict[str, CopilotHandleLabel] = Field(default_factory=dict)


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


class CopilotModuleSummary(BaseModel):
    module_id: int
    title: str
    description: str | None
    visibility: CopilotVisibility
    owner_identity_id: int
    owner_name: str | None
    is_owner: bool
    can_write: bool
    source_session_id: int | None
    created_at: datetime
    updated_at: datetime


class CopilotModuleDetail(CopilotModuleSummary):
    html: str


class CopilotModuleListResponse(BaseModel):
    items: list[CopilotModuleSummary]


def _reject_oversized_html(value: str | None) -> str | None:
    if value is not None and len(value.encode("utf-8")) > COPILOT_MODULE_HTML_MAX_BYTES:
        raise ValueError("html exceeds the 512 KB limit for a saved module")
    return value


class CopilotModuleCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    html: str = Field(min_length=1)
    visibility: CopilotVisibility = "private"
    source_session_id: int | None = None
    source_message_id: int | None = None

    @field_validator("html")
    @classmethod
    def _validate_html_size(cls, value: str) -> str:
        return _reject_oversized_html(value)  # type: ignore[return-value]


class CopilotModuleUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    html: str | None = Field(default=None, min_length=1)
    visibility: CopilotVisibility | None = None

    @field_validator("html")
    @classmethod
    def _validate_html_size(cls, value: str | None) -> str | None:
        return _reject_oversized_html(value)
