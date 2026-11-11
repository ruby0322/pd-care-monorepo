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
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from app.core.logging import get_logger
from app.services.copilot.deidentify import HANDLE_SPECS, deidentify_payload, resolve_handle

LOGGER = get_logger(__name__)

Role = Literal["staff", "admin"]


class CopilotToolError(Exception):
    """Raised when a tool call is rejected before it reaches the API."""


# Turns one session-scoped handle back into the real row id it stands for:
# `(entity_type, handle) -> entity_id`. Raises `CopilotToolError` when the handle was
# never minted in this conversation. `build_handle_resolver` is the only production
# implementation; `build_path` takes it as an argument so the pure path-building logic
# stays testable without a database.
HandleResolver = Callable[[str, str], int]


def _handle_pattern(prefix: str) -> str:
    """The JSON Schema / validation pattern for one handle namespace, e.g. `^P#[0-9]+$`."""
    return "^{0}#[0-9]+$".format(prefix)


def _require_handle(raw: Any, *, prefix: str, param: str, tool_name: str) -> str:
    """Accept only a well-formed handle string, normalised to the stored casing.

    Deliberately strict, and deliberately *not* tolerant of an integer: on the agent path
    the model has never been shown a real id, so a number here is an invention. Letting it
    through is the wrong-patient failure this whole boundary exists to prevent — an
    invented id that happens to name another assigned patient returns a perfectly coherent
    per-patient narrative under the wrong name.
    """
    if isinstance(raw, str):
        candidate = raw.strip().upper()
        if re.fullmatch(_handle_pattern(prefix), candidate):
            return candidate
    raise CopilotToolError(
        "Parameter '{0}' for tool '{1}' must be a {2}#n handle copied exactly from an "
        "earlier tool result (got {3!r}). This conversation has no real ids: call a listing "
        "tool first and reuse the handle it returned.".format(param, tool_name, prefix, raw)
    )


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

    def build_path(self, arguments: dict[str, Any], *, handle_resolver: HandleResolver | None = None) -> str:
        """Fill the path template from `arguments`, resolving handles when asked to.

        `handle_resolver` is what makes the boundary two-way. Pass one (the agent path,
        where every result the model saw was de-identified) and any path parameter listed
        in `HANDLE_SPECS` must arrive as the handle the model was given — `P#1` — which is
        resolved back to the real row id here. Pass `None` (the `/v1/copilot/proxy` path,
        which never de-identified anything) and those parameters are plain integer ids as
        before. Either way the value interpolated into the URL is an `int`, which is what
        keeps arbitrary strings and path traversal out of the request.
        """
        values: dict[str, int] = {}
        for name in self.path_params:
            if name not in arguments:
                raise CopilotToolError(f"Missing required parameter '{name}' for tool '{self.name}'")
            raw = arguments[name]
            spec = HANDLE_SPECS.get(name) if handle_resolver is not None else None
            if spec is not None and handle_resolver is not None:
                entity_type, prefix = spec
                handle = _require_handle(raw, prefix=prefix, param=name, tool_name=self.name)
                values[name] = handle_resolver(entity_type, handle)
                continue
            try:
                # Coercing to int is what keeps arbitrary strings (and path traversal) out of the URL.
                values[name] = int(raw)
            except (TypeError, ValueError) as exc:
                raise CopilotToolError(
                    f"Parameter '{name}' for tool '{self.name}' must be an integer, got {raw!r}"
                ) from exc
        return self.path_template.format(**values)

    def build_query(self, arguments: dict[str, Any]) -> dict[str, str]:
        """Turn supplied arguments into query parameters, dropping the ones that say nothing.

        A blank string is dropped alongside `None`. It reads as "no filter", but forwarded it is
        a *value*, and a route that constrains the parameter refuses it: `list_patients`
        declares `query` with `min_length=1`, so `query=""` is a 422. A generated report
        whose search box starts empty sends exactly that on its first load, and the model
        cannot see which field was refused, so it guesses — the loop observed in dev was it
        adding *more* parameters each turn, keeping the empty one that caused the 422.
        """
        query: dict[str, str] = {}
        for name, schema in self.query_params.items():
            if name not in arguments or arguments[name] is None:
                continue
            value = arguments[name]
            if isinstance(value, str) and not value.strip():
                continue
            if schema.get("type") == "boolean":
                query[name] = "true" if value in (True, "true", "True", 1) else "false"
            else:
                query[name] = str(value)
        return query

    def json_schema(self, *, deidentified: bool) -> dict[str, Any]:
        """The parameter schema handed to the model.

        `deidentified` must match what the dispatch will do with the call, because the
        schema is the strongest instruction the model gets. Advertising `patient_id` as a
        required *integer* while every result it has seen says `P#1` does not merely break
        the call: a structured-output model will satisfy the schema by inventing a number,
        and an invented id that happens to name another patient assigned to this nurse
        returns a coherent narrative under the wrong name. So on the de-identified path
        these parameters are advertised as handle strings, which the model can actually
        supply from what it was given.
        """
        properties: dict[str, Any] = {}
        for name in self.path_params:
            spec = HANDLE_SPECS.get(name) if deidentified else None
            if spec is None:
                properties[name] = {"type": "integer", "description": f"{name} (integer id)"}
                continue
            _entity_type, prefix = spec
            properties[name] = {
                "type": "string",
                "pattern": _handle_pattern(prefix),
                "description": (
                    f"The {prefix}#n handle for this {name.removesuffix('_id')}, copied exactly as it "
                    f"appeared in an earlier tool result (e.g. \"{prefix}#1\"). Never pass a number and "
                    "never invent a handle: real ids do not exist in this conversation."
                ),
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


DESCRIBE_QUERIES_TOOL = CopilotTool(
    name="describe_available_queries",
    description=(
        "The full reference for every other tool: each one's parameters, their types, "
        "allowed values and ranges, plus the rules for passing them. Call this before "
        "building a report that queries live data, or whenever a call was rejected as "
        "invalid, instead of guessing which parameter to change."
    ),
    # Answered from the registry, never dispatched: see `describe_available_queries`.
    path_template="",
)


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
        description=(
            "Nurse annotation labels recorded for one patient's uploads. Free-text comments "
            "are withheld from this tool and never returned."
        ),
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
        description=(
            "All uploads for one calendar day with KPIs, optionally grouped by patient, each "
            "upload carrying its nurse annotation and who recorded it. Use this for reports "
            "that span patients rather than calling the per-patient annotation tool in a loop."
        ),
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
        query_params={
            "local_date": {"type": "string", "description": "Target day, YYYY-MM-DD (Taipei local date)."},
            "week_start": {"type": "string", "description": "First day of the week to summarize, YYYY-MM-DD."},
        },
        required=("local_date", "week_start"),
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
    # Last, and answered from this registry rather than dispatched over HTTP.
    DESCRIBE_QUERIES_TOOL,
)


TOOLS_BY_NAME: dict[str, CopilotTool] = {tool.name: tool for tool in COPILOT_TOOLS}


def describe_available_queries(*, role: str, deidentified: bool) -> dict[str, Any]:
    """The tool catalogue, as data the model can read mid-conversation.

    The schemas are already advertised in the tool definitions, but a model writing a report
    is composing calls it will not make itself -- the report's own JS will, through
    `window.pdcare.query` -- and nothing in the function-calling contract describes that
    surface. Left to guess, it guessed: a rejected `list_patients` turned into a turn that
    added *more* parameters each round rather than fixing the one that was refused.

    `deidentified` decides how patient parameters are described, the same way it does for the
    function definitions: handles on the agent's own path, integers on the report's.
    """
    return {
        "usage": [
            "每個查詢的參數全部都是選填，沒傳就用後端預設值。只傳你要篩選的欄位。",
            "不要傳空字串（例如搜尋框還沒輸入時的 query: \"\"）——空字串是一個值而不是「不篩選」，"
            "某些欄位會因此被驗證拒絕。",
            "enum 欄位只接受列出的值；integer 欄位請遵守 minimum / maximum。",
            (
                "在 HTML 報表裡用 window.pdcare.query(tool, params) 呼叫這些查詢時，patient_id 要帶"
                "bridge 回傳的整數 id，不是 P#n 代稱。"
                if deidentified
                else "patient_id 等路徑參數請帶整數 id。"
            ),
            "查詢被拒絕時，錯誤訊息會指出被拒絕的欄位；照那個欄位修正，不要改成多傳其他參數。",
        ],
        "queries": [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.json_schema(deidentified=deidentified)["properties"],
                "required": list(tool.required),
            }
            for tool in tools_for_role(role)
            if tool.name != DESCRIBE_QUERIES_TOOL.name
        ],
    }


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


def openai_tool_definitions(role: str, *, deidentified: bool) -> list[dict[str, Any]]:
    """Tool definitions for one role. `deidentified` has no default on purpose: it must
    mirror the dispatch's `deidentify_for_session_id`, and a wrong guess here is what
    pushes the model to invent a patient id (see `CopilotTool.json_schema`)."""
    return [
        {
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.json_schema(deidentified=deidentified),
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


def _deidentify_for_session(app: Any, *, copilot_session_id: int, payload: Any) -> Any:
    """Open a short-lived DB session to run `payload` through the de-identification boundary.

    A fresh session is opened per tool call (rather than reusing one across the turn)
    because `dispatch_tool_call` has no session of its own to borrow — it only ever
    receives the ASGI `app`. The handle-insert commits here so the next tool call's own
    fresh session can see it and reuse the same handle for the same underlying id.
    """
    session_factory = app.state.db_session_factory
    session = session_factory()
    try:
        result = deidentify_payload(session, copilot_session_id=copilot_session_id, payload=payload)
        session.commit()
        return result
    finally:
        session.close()


def build_handle_resolver(app: Any, *, copilot_session_id: int, tool_name: str) -> HandleResolver:
    """The inbound counterpart of `_deidentify_for_session`.

    Opens its own short-lived DB session per lookup for the same reason that helper does:
    the dispatch only ever receives the ASGI `app`, never a session. An unknown handle —
    one never minted in this conversation, or one from another session or another
    namespace — raises `CopilotToolError`, and there is deliberately no fallback that
    treats the argument as a real id instead.
    """

    def resolve(entity_type: str, handle: str) -> int:
        session = app.state.db_session_factory()
        try:
            entity_id = resolve_handle(
                session,
                copilot_session_id=copilot_session_id,
                entity_type=entity_type,
                handle=handle,
            )
        finally:
            session.close()
        if entity_id is None:
            raise CopilotToolError(
                "Handle '{0}' is not known in this conversation, so tool '{1}' was not called. "
                "Only use handles that appeared in an earlier tool result of this same "
                "conversation.".format(handle, tool_name)
            )
        return entity_id

    return resolve


async def dispatch_tool_call(
    *,
    app: Any,
    tool: CopilotTool,
    arguments: dict[str, Any],
    authorization: str,
    max_bytes: int,
    deidentify_for_session_id: int | None,
    role: str,
    timeout_seconds: float = 30.0,
) -> ToolCallResult:
    """Run one allowlisted GET against this app, as the signed-in user.

    `deidentify_for_session_id` is the single choke point between a tool result and the
    model: pass the real copilot session id to strip and re-label identifiers before the
    model ever sees this payload, or `None` to return the payload identified as-is. There
    is no default — every caller must choose explicitly (see `deidentify.py`'s module
    docstring for why a silent default would defeat the whole boundary).

    It governs the *inbound* direction too, because the two have to agree: a caller whose
    results were de-identified must spend handles (`patient_id="P#1"`), resolved here
    against that same session; a caller that saw identified data passes real ids.
    """
    if tool.name == DESCRIBE_QUERIES_TOOL.name:
        # Documentation, not data: answered from the registry, so it never leaves the process
        # and carries nothing to de-identify.
        reference = describe_available_queries(
            role=role,
            deidentified=deidentify_for_session_id is not None,
        )
        return ToolCallResult(
            ok=True,
            status_code=200,
            content=json.dumps(reference, ensure_ascii=False),
        )

    handle_resolver = (
        build_handle_resolver(app, copilot_session_id=deidentify_for_session_id, tool_name=tool.name)
        if deidentify_for_session_id is not None
        else None
    )
    path = tool.build_path(arguments, handle_resolver=handle_resolver)
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
        if deidentify_for_session_id is not None:
            # `detail` is left out of the dict entirely here, rather than filtered out by
            # `deidentify_payload` after the fact: `detail` is often itself a dict (e.g.
            # `{"detail": "..."}` echoed back from the downstream endpoint's own error
            # body), and `filter_payload` always keeps a dict-valued key regardless of its
            # name — it would survive as an emptied `{}`, not disappear. `error` + `status`
            # is enough for the model to know it hit a boundary (the system prompt explains
            # what a 403/404 means); `detail` carries unbounded text that could echo an
            # identifier straight back, so it never reaches de-identified payloads at all.
            error_payload: Any = _deidentify_for_session(
                app,
                copilot_session_id=deidentify_for_session_id,
                payload={"error": True, "status": response.status_code},
            )
        else:
            error_payload = {"error": True, "status": response.status_code, "detail": detail}
        # Surfaced to the model (not raised) so it can explain the permission boundary in its answer.
        content = json.dumps(error_payload, ensure_ascii=False, default=str)
        return ToolCallResult(ok=False, status_code=response.status_code, content=content)

    try:
        payload = response.json()
    except ValueError:
        return ToolCallResult(ok=False, status_code=response.status_code, content='{"error":true,"detail":"non-JSON response"}')

    if deidentify_for_session_id is not None:
        payload = _deidentify_for_session(app, copilot_session_id=deidentify_for_session_id, payload=payload)

    text, truncated = _truncate_payload(payload, max_bytes=max_bytes)
    return ToolCallResult(ok=True, status_code=response.status_code, content=text, truncated=truncated)
