from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps.auth import (
    bearer_scheme,
    get_current_principal,
    get_session,
    load_identity,
    require_staff_or_admin,
)
from app.core.logging import get_logger
from app.schemas.copilot import (
    CopilotMessageCreateRequest,
    CopilotMessageItem,
    CopilotModelsResponse,
    CopilotProxyRequest,
    CopilotProxyResponse,
    CopilotSessionCreateRequest,
    CopilotSessionDetailResponse,
    CopilotSessionListResponse,
    CopilotSessionSummary,
    CopilotSessionUpdateRequest,
)
from app.services.copilot.agent import CopilotUnavailableError, build_openai_client, run_agent_turn
from app.services.copilot.sessions import (
    append_message,
    assert_visibility_allowed,
    copilot_proxy_rate_limiter,
    create_session,
    derive_title,
    get_owned_session,
    get_readable_session,
    history_pairs,
    list_messages,
    list_visible_sessions,
    message_count,
    owner_name,
    parse_tool_trace,
    touch_session,
)
from app.services.copilot.tools import CopilotToolError, dispatch_tool_call, resolve_tool

LOGGER = get_logger(__name__)

router = APIRouter(tags=["Copilot"])


def _require_enabled(request: Request) -> None:
    if not request.app.state.settings.copilot_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PD Copilot is disabled")


def _resolve_model(request: Request, requested: str | None) -> str:
    settings = request.app.state.settings
    if requested is None:
        return settings.copilot_default_model
    if requested not in settings.copilot_models:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported model")
    return requested


def _authorization_header(request: Request) -> str:
    header = request.headers.get("authorization")
    if not header:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return header


def _to_summary(row, *, owner_display: str | None, messages: int, identity_id: int) -> CopilotSessionSummary:
    is_owner = row.owner_identity_id == identity_id
    return CopilotSessionSummary(
        session_id=row.id,
        title=row.title,
        model=row.model,
        visibility=row.visibility,  # type: ignore[arg-type]
        owner_identity_id=row.owner_identity_id,
        owner_name=owner_display,
        is_owner=is_owner,
        can_write=is_owner,
        message_count=messages,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/v1/copilot/models", response_model=CopilotModelsResponse)
async def get_copilot_models(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> CopilotModelsResponse:
    require_staff_or_admin(get_current_principal(request, credentials))
    settings = request.app.state.settings
    enabled = bool(settings.copilot_enabled and settings.openai_api_key)
    if not enabled:
        return CopilotModelsResponse(enabled=False, models=[], default_model=None)
    return CopilotModelsResponse(
        enabled=True,
        models=list(settings.copilot_models),
        default_model=settings.copilot_default_model,
    )


@router.get("/v1/copilot/sessions", response_model=CopilotSessionListResponse)
async def list_copilot_sessions(
    request: Request,
    credentials=Depends(bearer_scheme),
) -> CopilotSessionListResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        rows = list_visible_sessions(session, identity_id=principal.identity_id, role=principal.role)
        return CopilotSessionListResponse(
            items=[
                _to_summary(row, owner_display=display, messages=count, identity_id=principal.identity_id)
                for row, display, count in rows
            ]
        )
    finally:
        session.close()


@router.post("/v1/copilot/sessions", response_model=CopilotSessionSummary, status_code=status.HTTP_201_CREATED)
async def create_copilot_session(
    request: Request,
    payload: CopilotSessionCreateRequest,
    credentials=Depends(bearer_scheme),
) -> CopilotSessionSummary:
    _require_enabled(request)
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    assert_visibility_allowed(payload.visibility, role=principal.role)
    model = _resolve_model(request, payload.model)
    session = get_session(request)
    try:
        row = create_session(
            session,
            owner_identity_id=principal.identity_id,
            title=(payload.title or "新對話").strip() or "新對話",
            model=model,
            visibility=payload.visibility,
        )
        return _to_summary(
            row,
            owner_display=owner_name(session, identity_id=principal.identity_id),
            messages=0,
            identity_id=principal.identity_id,
        )
    finally:
        session.close()


@router.get("/v1/copilot/sessions/{session_id}", response_model=CopilotSessionDetailResponse)
async def get_copilot_session(
    request: Request,
    session_id: int,
    credentials=Depends(bearer_scheme),
) -> CopilotSessionDetailResponse:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        row = get_readable_session(
            session,
            session_id=session_id,
            identity_id=principal.identity_id,
            role=principal.role,
        )
        messages = list_messages(session, session_id=row.id)
        return CopilotSessionDetailResponse(
            session=_to_summary(
                row,
                owner_display=owner_name(session, identity_id=row.owner_identity_id),
                messages=len(messages),
                identity_id=principal.identity_id,
            ),
            messages=[
                CopilotMessageItem(
                    message_id=message.id,
                    role=message.role,  # type: ignore[arg-type]
                    content=message.content,
                    model=message.model,
                    tool_trace=parse_tool_trace(message.tool_trace),
                    created_at=message.created_at,
                )
                for message in messages
            ],
        )
    finally:
        session.close()


@router.patch("/v1/copilot/sessions/{session_id}", response_model=CopilotSessionSummary)
async def update_copilot_session(
    request: Request,
    session_id: int,
    payload: CopilotSessionUpdateRequest,
    credentials=Depends(bearer_scheme),
) -> CopilotSessionSummary:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        row = get_owned_session(
            session,
            session_id=session_id,
            identity_id=principal.identity_id,
            role=principal.role,
        )
        if payload.title is not None:
            row.title = payload.title.strip() or row.title
        if payload.model is not None:
            row.model = _resolve_model(request, payload.model)
        if payload.visibility is not None:
            assert_visibility_allowed(payload.visibility, role=principal.role)
            row.visibility = payload.visibility
        session.commit()
        session.refresh(row)
        return _to_summary(
            row,
            owner_display=owner_name(session, identity_id=row.owner_identity_id),
            messages=message_count(session, session_id=row.id),
            identity_id=principal.identity_id,
        )
    finally:
        session.close()


@router.delete("/v1/copilot/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_copilot_session(
    request: Request,
    session_id: int,
    credentials=Depends(bearer_scheme),
) -> None:
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    session = get_session(request)
    try:
        row = get_owned_session(
            session,
            session_id=session_id,
            identity_id=principal.identity_id,
            role=principal.role,
        )
        session.delete(row)
        session.commit()
    finally:
        session.close()


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n".encode("utf-8")


@router.post("/v1/copilot/sessions/{session_id}/messages")
async def post_copilot_message(
    request: Request,
    session_id: int,
    payload: CopilotMessageCreateRequest,
    credentials=Depends(bearer_scheme),
) -> StreamingResponse:
    _require_enabled(request)
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    authorization = _authorization_header(request)
    settings = request.app.state.settings

    session = get_session(request)
    try:
        row = get_owned_session(
            session,
            session_id=session_id,
            identity_id=principal.identity_id,
            role=principal.role,
        )
        model = row.model
        history = history_pairs(list_messages(session, session_id=row.id))
        identity = load_identity(session, principal)
        display_name = identity.real_name or identity.display_name
        user_message = append_message(session, session_id=row.id, role="user", content=payload.content)
        if len(history) == 0 and (row.title == "新對話" or not row.title.strip()):
            row.title = derive_title(payload.content)
            session.commit()
        user_message_id = user_message.id
    finally:
        session.close()

    try:
        client = build_openai_client(
            api_key=settings.openai_api_key,
            timeout_seconds=settings.copilot_request_timeout_seconds,
        )
    except CopilotUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    app = request.app

    async def event_stream() -> AsyncIterator[bytes]:
        yield _sse("user_message", {"message_id": user_message_id})
        turn: dict | None = None
        try:
            async for event in run_agent_turn(
                client=client,
                app=app,
                model=model,
                role=principal.role,
                display_name=display_name,
                history=history,
                user_message=payload.content,
                authorization=authorization,
                max_tool_iterations=settings.copilot_max_tool_iterations,
                tool_result_max_bytes=settings.copilot_tool_result_max_bytes,
            ):
                if event.type == "turn":
                    turn = event.data
                    continue
                yield _sse(event.type, event.data)
        except Exception as exc:  # noqa: BLE001 - the stream has already started; report and close cleanly
            LOGGER.exception("Copilot turn failed for session %s", session_id)
            yield _sse("error", {"message": f"分析過程發生錯誤：{exc}"})

        if turn is not None:
            persist_session = app.state.db_session_factory()
            try:
                saved = append_message(
                    persist_session,
                    session_id=session_id,
                    role="assistant",
                    content=turn.get("text") or "",
                    model=model,
                    tool_trace=turn.get("tool_trace") or [],
                    prompt_tokens=turn.get("prompt_tokens"),
                    completion_tokens=turn.get("completion_tokens"),
                )
                touch_session(persist_session, session_id=session_id)
                yield _sse(
                    "message_saved",
                    {
                        "message_id": saved.id,
                        "content": saved.content,
                        "tool_trace": turn.get("tool_trace") or [],
                    },
                )
            finally:
                persist_session.close()

        yield _sse("done", {})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/v1/copilot/proxy", response_model=CopilotProxyResponse)
async def post_copilot_proxy(
    request: Request,
    payload: CopilotProxyRequest,
    credentials=Depends(bearer_scheme),
) -> CopilotProxyResponse:
    """Live-data bridge for generated HTML artifacts.

    Same allowlist, same caller token: an artifact can only reach data the signed-in user
    could already fetch, and only through read-only GET endpoints.
    """
    _require_enabled(request)
    principal = require_staff_or_admin(get_current_principal(request, credentials))
    settings = request.app.state.settings

    if not copilot_proxy_rate_limiter.allow(
        principal.identity_id,
        limit_per_minute=settings.copilot_proxy_rate_limit_per_minute,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many live-data refreshes; slow down and retry shortly",
        )

    try:
        tool = resolve_tool(payload.tool, role=principal.role)
        result = await dispatch_tool_call(
            app=request.app,
            tool=tool,
            arguments=payload.params,
            authorization=_authorization_header(request),
            max_bytes=settings.copilot_tool_result_max_bytes,
        )
    except CopilotToolError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        data = json.loads(result.content)
    except ValueError:
        data = None
    return CopilotProxyResponse(tool=payload.tool, ok=result.ok, status=result.status_code, data=data)
