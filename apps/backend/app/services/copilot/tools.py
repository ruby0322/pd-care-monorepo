"""Read-only tool surface for PD Copilot.

Every tool maps to an existing authenticated GET endpoint on this same app. Calls are
dispatched in-process through httpx's ASGI transport carrying the *caller's own* bearer
token, so each one re-runs the real auth dependencies (`require_staff_or_admin`,
`assert_patient_access`, assignment scoping). The model therefore cannot see anything the
signed-in user could not already fetch from the UI, and because only GET and only
allowlisted path templates are reachable, the surface is read-only by construction.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from app.core.logging import get_logger

LOGGER = get_logger(__name__)

Role = Literal["staff", "admin"]


class CopilotToolError(Exception):
    """Raised when a tool call is rejected before it reaches the API."""


@dataclass(frozen=True)
class CopilotTool:
    name: str
    description: str
    path_template: str
    # Names of integer path parameters the caller must supply, e.g. ("patient_id",).
    path_params: tuple[str, ...] = ()
    # JSON Schema `properties` for query parameters, passed straight to the model.
    query_params: dict[str, Any] = field(default_factory=dict)
    required: tuple[str, ...] = ()
    required_role: Role = "staff"

    def build_path(self, arguments: dict[str, Any]) -> str:
        values: dict[str, int] = {}
        for name in self.path_params:
            if name not in arguments:
                raise CopilotToolError(f"Missing required parameter '{name}' for tool '{self.name}'")
            raw = arguments[name]
            try:
                # Coercing to int is what keeps arbitrary strings (and path traversal) out of the URL.
                values[name] = int(raw)
            except (TypeError, ValueError) as exc:
                raise CopilotToolError(
                    f"Parameter '{name}' for tool '{self.name}' must be an integer, got {raw!r}"
                ) from exc
        return self.path_template.format(**values)

    def build_query(self, arguments: dict[str, Any]) -> dict[str, str]:
        query: dict[str, str] = {}
        for name, schema in self.query_params.items():
            if name not in arguments or arguments[name] is None:
                continue
            value = arguments[name]
            if schema.get("type") == "boolean":
                query[name] = "true" if value in (True, "true", "True", 1) else "false"
            else:
                query[name] = str(value)
        return query

    def json_schema(self) -> dict[str, Any]:
        properties: dict[str, Any] = {
            name: {"type": "integer", "description": f"{name} (integer id)"} for name in self.path_params
        }
        properties.update(self.query_params)
        return {
            "type": "object",
            "properties": properties,
            "required": list(self.path_params) + list(self.required),
            "additionalProperties": False,
        }


_PAGINATION = {
    "limit": {"type": "integer", "description": "Max rows to return (1-100).", "minimum": 1, "maximum": 100},
    "offset": {"type": "integer", "description": "Rows to skip for paging.", "minimum": 0},
}

_DATE_RANGE = {
    "created_from": {"type": "string", "description": "Inclusive start date, YYYY-MM-DD."},
    "created_to": {"type": "string", "description": "Inclusive end date, YYYY-MM-DD."},
}


COPILOT_TOOLS: tuple[CopilotTool, ...] = (
    CopilotTool(
        name="list_patients",
        description=(
            "List patients the signed-in user may see, with per-patient upload and suspected counts. "
            "Use this first to resolve a patient name or case number into a patient_id."
        ),
        path_template="/v1/staff/patients",
        query_params={
            "query": {"type": "string", "description": "Free-text search over case number and name."},
            "months": {"type": "integer", "description": "Trailing month window for counts (1-60).", "minimum": 1, "maximum": 60},
            "age_min": {"type": "integer", "minimum": 0},
            "age_max": {"type": "integer", "minimum": 0},
            "infection_status": {"type": "string", "enum": ["all", "suspected", "normal"]},
            "binding_filter": {"type": "string", "enum": ["bound", "all", "unbound_only"]},
            "is_active_filter": {"type": "string", "enum": ["all", "active", "inactive"]},
            "sort_key": {
                "type": "string",
                "enum": ["latest_upload", "case_number", "upload_count", "suspected_count", "age"],
            },
            "sort_dir": {"type": "string", "enum": ["asc", "desc"]},
            **_DATE_RANGE,
            **_PAGINATION,
        },
    ),
    CopilotTool(
        name="get_patient_detail",
        description="Full profile and aggregate upload counts for one patient.",
        path_template="/v1/staff/patients/{patient_id}",
        path_params=("patient_id",),
    ),
    CopilotTool(
        name="list_patient_uploads",
        description=(
            "One patient's upload history with AI screening result, probability, threshold and "
            "whether a nurse has annotated it. This is the per-patient timeline tool."
        ),
        path_template="/v1/staff/patients/{patient_id}/uploads",
        path_params=("patient_id",),
        query_params={**_DATE_RANGE, **_PAGINATION},
    ),
    CopilotTool(
        name="get_patient_upload_calendar",
        description="Per-day upload counts for one patient, useful for adherence and gap analysis.",
        path_template="/v1/staff/patients/{patient_id}/upload-calendar",
        path_params=("patient_id",),
    ),
    CopilotTool(
        name="list_patient_annotations",
        description="Nurse annotations (label and comment) recorded for one patient's uploads.",
        path_template="/v1/staff/patients/{patient_id}/annotations",
        path_params=("patient_id",),
    ),
    CopilotTool(
        name="get_upload_queue",
        description="Uploads awaiting review, newest first.",
        path_template="/v1/staff/uploads/queue",
        query_params={
            "only_unreviewed": {"type": "boolean", "description": "Restrict to uploads with no annotation yet."},
            **_PAGINATION,
        },
    ),
    CopilotTool(
        name="get_today_attention",
        description=(
            "Today's patients needing attention, tiered into suspected / elevated / other, "
            "with the riskiest upload highlighted for each."
        ),
        path_template="/v1/staff/uploads/today-attention",
    ),
    CopilotTool(
        name="get_history_overview",
        description="All uploads for one calendar day with KPIs, optionally grouped by patient.",
        path_template="/v1/staff/uploads/history-overview",
        query_params={
            "local_date": {"type": "string", "description": "Target day, YYYY-MM-DD (Taipei local date)."},
            "sort_by": {"type": "string", "enum": ["timeline", "risk"]},
            "group_by_user": {"type": "boolean"},
            "group_sort_by": {"type": "string", "enum": ["uploads", "age", "infection_risk"]},
        },
        required=("local_date",),
    ),
    CopilotTool(
        name="get_history_overview_days",
        description="Days that have uploads, so you can pick a date before calling get_history_overview.",
        path_template="/v1/staff/uploads/history-overview/days",
        query_params={
            "before": {"type": "string", "description": "Return days strictly before this YYYY-MM-DD."},
            "limit": _PAGINATION["limit"],
        },
    ),
    CopilotTool(
        name="get_workbench_dashboard",
        description="The nurse workbench summary: today's counts plus the trailing week.",
        path_template="/v1/staff/dashboard/workbench",
    ),
    # --- De-identified cohort aggregates (counts/trends only, no patient identity) ---
    CopilotTool(
        name="get_cohort_suspected_series",
        description=(
            "Cohort-wide daily series of total / suspected / symptom-elevated uploads over a lookback "
            "window. Use this for infection trend questions across all patients."
        ),
        path_template="/v1/staff/analytics/suspected-series",
        query_params={
            "lookback_days": {"type": "integer", "description": "Days to look back (7-365).", "minimum": 7, "maximum": 365}
        },
    ),
    CopilotTool(
        name="get_cohort_suspected_summary",
        description=(
            "Cohort-wide suspected-infection totals. Omit months for today only; set months for a "
            "trailing month window (e.g. months=3 for the last three months)."
        ),
        path_template="/v1/staff/analytics/suspected-summary",
        query_params={
            "months": {"type": "integer", "description": "Trailing month window (1-60). Omit for today.", "minimum": 1, "maximum": 60}
        },
    ),
    CopilotTool(
        name="get_cohort_age_histogram",
        description="Cohort age distribution in buckets (counts only).",
        path_template="/v1/staff/analytics/age-histogram",
        query_params={
            "bucket_size": {"type": "integer", "minimum": 1, "maximum": 30},
            "include_inactive": {"type": "boolean"},
        },
    ),
    CopilotTool(
        name="get_cohort_gender_distribution",
        description="Cohort gender distribution (counts only).",
        path_template="/v1/staff/analytics/gender-distribution",
    ),
    CopilotTool(
        name="get_cohort_active_users",
        description="Cohort active-user and registered-user series, for engagement and adherence trends.",
        path_template="/v1/staff/analytics/active-users",
        query_params={
            "active_window_days": {"type": "integer", "minimum": 1, "maximum": 120},
            "lookback_days": {"type": "integer", "minimum": 7, "maximum": 365},
            "interval": {"type": "string", "enum": ["day", "week"]},
        },
    ),
)


TOOLS_BY_NAME: dict[str, CopilotTool] = {tool.name: tool for tool in COPILOT_TOOLS}


def tools_for_role(role: str) -> tuple[CopilotTool, ...]:
    if role == "admin":
        return COPILOT_TOOLS
    return tuple(tool for tool in COPILOT_TOOLS if tool.required_role != "admin")


def resolve_tool(name: str, *, role: str) -> CopilotTool:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        raise CopilotToolError(f"Unknown tool '{name}'")
    if tool.required_role == "admin" and role != "admin":
        raise CopilotToolError(f"Tool '{name}' requires the admin role")
    return tool


def openai_tool_definitions(role: str) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.json_schema(),
        }
        for tool in tools_for_role(role)
    ]


def _truncate_payload(payload: Any, *, max_bytes: int) -> tuple[str, bool]:
    text = json.dumps(payload, ensure_ascii=False, default=str)
    if len(text.encode("utf-8")) <= max_bytes:
        return text, False
    # Shrink the longest list in the payload rather than cutting mid-JSON, so the model
    # still receives valid structure plus an explicit signal to narrow its query.
    if isinstance(payload, dict):
        list_keys = [key for key, value in payload.items() if isinstance(value, list) and value]
        trimmed = dict(payload)
        while list_keys:
            key = max(list_keys, key=lambda k: len(trimmed[k]) if isinstance(trimmed[k], list) else 0)
            items = trimmed[key]
            if len(items) <= 1:
                list_keys.remove(key)
                continue
            trimmed[key] = items[: max(1, len(items) // 2)]
            trimmed["_truncated"] = True
            trimmed["_truncated_note"] = (
                "Result was too large and arrays were shortened. Narrow the date range, "
                "lower limit, or request an aggregate instead."
            )
            text = json.dumps(trimmed, ensure_ascii=False, default=str)
            if len(text.encode("utf-8")) <= max_bytes:
                return text, True
        return text, True
    return text[:max_bytes], True


@dataclass
class ToolCallResult:
    ok: bool
    status_code: int | None
    content: str
    truncated: bool = False


async def dispatch_tool_call(
    *,
    app: Any,
    tool: CopilotTool,
    arguments: dict[str, Any],
    authorization: str,
    max_bytes: int,
    timeout_seconds: float = 30.0,
) -> ToolCallResult:
    """Run one allowlisted GET against this app, as the signed-in user."""
    path = tool.build_path(arguments)
    params = tool.build_query(arguments)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://copilot.internal",
        timeout=timeout_seconds,
    ) as client:
        response = await client.get(path, params=params, headers={"Authorization": authorization})

    if response.status_code >= 400:
        detail: Any
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:500]
        LOGGER.info("Copilot tool '%s' rejected with %s", tool.name, response.status_code)
        # Surfaced to the model (not raised) so it can explain the permission boundary in its answer.
        content = json.dumps(
            {"error": True, "status": response.status_code, "detail": detail},
            ensure_ascii=False,
            default=str,
        )
        return ToolCallResult(ok=False, status_code=response.status_code, content=content)

    try:
        payload = response.json()
    except ValueError:
        return ToolCallResult(ok=False, status_code=response.status_code, content='{"error":true,"detail":"non-JSON response"}')

    text, truncated = _truncate_payload(payload, max_bytes=max_bytes)
    return ToolCallResult(ok=True, status_code=response.status_code, content=text, truncated=truncated)
