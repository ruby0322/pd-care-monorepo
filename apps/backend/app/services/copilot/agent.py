"""PD Copilot agent loop: OpenAI Responses API + the read-only tool allowlist."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.core.logging import get_logger
from app.services.copilot.prompt import build_system_prompt
from app.services.copilot.tools import (
    CopilotToolError,
    ToolCallResult,
    build_handle_resolver,
    dispatch_tool_call,
    openai_tool_definitions,
    resolve_tool,
)

LOGGER = get_logger(__name__)


class CopilotUnavailableError(Exception):
    """Copilot is disabled or not configured."""


@dataclass
class AgentEvent:
    type: str
    data: dict[str, Any]


@dataclass
class TurnRecord:
    text: str = ""
    tool_trace: list[dict[str, Any]] = field(default_factory=list)
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


def build_openai_client(*, api_key: str | None, timeout_seconds: float) -> Any:
    if not api_key:
        raise CopilotUnavailableError("OPENAI_API_KEY is not configured")
    try:
        from openai import AsyncOpenAI
    except ModuleNotFoundError as exc:  # pragma: no cover - dependency is declared in requirements
        raise CopilotUnavailableError("openai package is not installed") from exc
    return AsyncOpenAI(api_key=api_key, timeout=timeout_seconds)


def history_to_input(messages: Sequence[tuple[str, str]]) -> list[dict[str, Any]]:
    """Map stored (role, content) rows onto Responses API input items."""
    items: list[dict[str, Any]] = []
    for role, content in messages:
        if not content:
            continue
        items.append({"role": "assistant" if role == "assistant" else "user", "content": content})
    return items


def _usage_pair(usage: Any) -> tuple[int | None, int | None]:
    if usage is None:
        return None, None
    return getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None)


def _function_calls(response: Any) -> list[Any]:
    output = getattr(response, "output", None) or []
    return [item for item in output if getattr(item, "type", None) == "function_call"]


# Output-only fields the Responses API rejects when an output item is echoed back as input
# ("Unknown parameter: 'input[1].status'"). Reasoning and function_call items both carry them.
_OUTPUT_ONLY_KEYS = frozenset({"status"})


def _strip_output_only(value: Any) -> Any:
    """Drop output-only keys and nulls so an output item is valid as input."""
    if isinstance(value, dict):
        return {
            key: _strip_output_only(inner)
            for key, inner in value.items()
            if key not in _OUTPUT_ONLY_KEYS and inner is not None
        }
    if isinstance(value, list):
        return [_strip_output_only(item) for item in value]
    return value


def echoable_output_item(item: Any) -> dict[str, Any]:
    """Serialize one response output item for replay in the next turn's input."""
    dumped = item.model_dump() if hasattr(item, "model_dump") else item
    return _strip_output_only(dumped)


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise CopilotToolError(f"Tool arguments were not valid JSON: {raw!r}") from exc
    if not isinstance(parsed, dict):
        raise CopilotToolError("Tool arguments must be a JSON object")
    return parsed


async def run_agent_turn(
    *,
    client: Any,
    app: Any,
    model: str,
    role: str,
    history: Sequence[tuple[str, str]],
    user_message: str,
    authorization: str,
    max_tool_iterations: int,
    tool_result_max_bytes: int,
    copilot_session_id: int,
) -> AsyncIterator[AgentEvent]:
    """Stream one assistant turn, running allowlisted tool calls as needed.

    Yields `token`, `tool_call`, `tool_result`, `error` and finally `turn` events. The
    `turn` event carries the TurnRecord the caller persists.

    `copilot_session_id` is threaded straight into every `dispatch_tool_call` as
    `deidentify_for_session_id` — every tool result the model sees on this path is
    de-identified. This is the one path where that must always happen; the live-data
    proxy route calls `dispatch_tool_call` separately and passes `None` instead.
    """
    system_prompt = build_system_prompt(role=role)
    # This path always de-identifies, so the schema must advertise the handle strings the
    # model has actually been shown rather than integer ids it would have to invent.
    tools = openai_tool_definitions(role, deidentified=True)
    conversation: list[dict[str, Any]] = history_to_input(history)
    conversation.append({"role": "user", "content": user_message})

    record = TurnRecord()
    # Accumulated across iterations: the model often narrates before calling a tool, and
    # that narration was already streamed to the user, so the saved message must keep it.
    streamed_text: list[str] = []

    for iteration in range(max_tool_iterations + 1):
        final_response: Any = None
        text_parts: list[str] = []

        stream = await client.responses.create(
            model=model,
            instructions=system_prompt,
            input=conversation,
            tools=tools,
            stream=True,
        )
        async for event in stream:
            event_type = getattr(event, "type", None)
            if event_type == "response.output_text.delta":
                delta = getattr(event, "delta", "") or ""
                if delta:
                    text_parts.append(delta)
                    yield AgentEvent("token", {"text": delta})
            elif event_type == "response.completed":
                final_response = getattr(event, "response", None)
            elif event_type in {"response.failed", "response.incomplete"}:
                final_response = getattr(event, "response", None)
                reason = getattr(getattr(final_response, "error", None), "message", None) or event_type
                yield AgentEvent("error", {"message": str(reason)})

        if final_response is None:
            streamed_text.extend(text_parts)
            record.text = "".join(streamed_text)
            yield AgentEvent("error", {"message": "模型沒有回傳完整回應，請重試。"})
            break

        prompt_tokens, completion_tokens = _usage_pair(getattr(final_response, "usage", None))
        if prompt_tokens is not None:
            record.prompt_tokens = (record.prompt_tokens or 0) + prompt_tokens
        if completion_tokens is not None:
            record.completion_tokens = (record.completion_tokens or 0) + completion_tokens

        streamed_text.extend(text_parts)
        calls = _function_calls(final_response)

        if not calls:
            record.text = "".join(streamed_text)
            break

        if iteration >= max_tool_iterations:
            record.text = (
                "".join(streamed_text) or "查詢步驟已達上限，無法完成這次分析。請把問題拆小一點再試。"
            )
            yield AgentEvent("error", {"message": "已達工具查詢上限。"})
            break

        # Keep the model's own function_call items in the transcript so call_ids line up.
        # They must be stripped of output-only fields first, or the next request 400s.
        for item in getattr(final_response, "output", None) or []:
            conversation.append(echoable_output_item(item))

        for call in calls:
            name = getattr(call, "name", "")
            call_id = getattr(call, "call_id", None) or getattr(call, "id", "")
            started = time.monotonic()

            arguments: dict[str, Any] = {}
            tool = None
            rejection: str | None = None
            try:
                arguments = _parse_arguments(getattr(call, "arguments", None))
                tool = resolve_tool(name, role=role)
                # Validated here, before the call is announced, so a rejected call still
                # emits exactly one tool_call/tool_result pair. The same resolver the
                # dispatch will use is passed in, so a handle the model made up is caught
                # as a plain rejection instead of raising mid-dispatch.
                tool.build_path(
                    arguments,
                    handle_resolver=build_handle_resolver(
                        app, copilot_session_id=copilot_session_id, tool_name=name
                    ),
                )
            except CopilotToolError as exc:
                rejection = str(exc)

            yield AgentEvent("tool_call", {"tool": name, "params": arguments})

            if tool is None or rejection is not None:
                result = ToolCallResult(
                    ok=False,
                    status_code=None,
                    content=json.dumps(
                        {"error": True, "detail": rejection or f"Unknown tool '{name}'"},
                        ensure_ascii=False,
                    ),
                )
            else:
                try:
                    result = await dispatch_tool_call(
                        app=app,
                        tool=tool,
                        arguments=arguments,
                        authorization=authorization,
                        max_bytes=tool_result_max_bytes,
                        deidentify_for_session_id=copilot_session_id,
                    )
                except CopilotToolError as exc:
                    # The pre-validation above normally catches these; this covers the
                    # narrow window where a handle stops resolving between the two (and
                    # keeps a rejected argument from killing the whole stream).
                    result = ToolCallResult(
                        ok=False,
                        status_code=None,
                        content=json.dumps({"error": True, "detail": str(exc)}, ensure_ascii=False),
                    )

            duration_ms = int((time.monotonic() - started) * 1000)
            record.tool_trace.append(
                {
                    "tool": name,
                    "params": arguments,
                    "ok": result.ok,
                    "status": result.status_code,
                    "truncated": result.truncated,
                    "duration_ms": duration_ms,
                }
            )
            yield AgentEvent(
                "tool_result",
                {
                    "tool": name,
                    "ok": result.ok,
                    "status": result.status_code,
                    "truncated": result.truncated,
                    "duration_ms": duration_ms,
                },
            )
            conversation.append(
                {"type": "function_call_output", "call_id": call_id, "output": result.content}
            )

    yield AgentEvent(
        "turn",
        {
            "text": record.text,
            "tool_trace": record.tool_trace,
            "prompt_tokens": record.prompt_tokens,
            "completion_tokens": record.completion_tokens,
        },
    )
