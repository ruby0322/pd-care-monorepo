"""Copilot session storage and visibility rules.

Visibility: ``private`` = owner only, ``staff`` = any staff/admin, ``admin`` = admin only.
Writes (sending a message, renaming, deleting) are always owner-only, so a shared session
is a read-only transcript for everybody else.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import CopilotMessage, CopilotSession, LiffIdentity

VISIBILITIES = ("private", "staff", "admin")


class CopilotProxyRateLimiter:
    """Process-local sliding-window limiter keyed by identity id.

    Each backend replica keeps its own window, so the aggregate ceiling across pods is
    higher than the configured per-minute value.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[int, deque[float]] = {}

    def allow(self, identity_id: int, *, limit_per_minute: int) -> bool:
        if limit_per_minute <= 0:
            return True
        now = time.monotonic()
        with self._lock:
            window = self._hits.setdefault(identity_id, deque())
            while window and now - window[0] > 60.0:
                window.popleft()
            if len(window) >= limit_per_minute:
                return False
            window.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


copilot_proxy_rate_limiter = CopilotProxyRateLimiter()


def assert_visibility_allowed(visibility: str, *, role: str) -> None:
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown visibility")
    if visibility == "admin" and role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin-visible sessions require the admin role",
        )


def can_read(session_row: CopilotSession, *, identity_id: int, role: str) -> bool:
    if session_row.owner_identity_id == identity_id:
        return True
    if session_row.visibility == "staff":
        return role in {"staff", "admin"}
    if session_row.visibility == "admin":
        return role == "admin"
    return False


def create_session(
    session: Session,
    *,
    owner_identity_id: int,
    title: str,
    model: str,
    visibility: str,
) -> CopilotSession:
    row = CopilotSession(
        owner_identity_id=owner_identity_id,
        title=title,
        model=model,
        visibility=visibility,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_readable_session(
    session: Session,
    *,
    session_id: int,
    identity_id: int,
    role: str,
) -> CopilotSession:
    row = session.get(CopilotSession, session_id)
    if row is None or row.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Copilot session not found")
    if not can_read(row, identity_id=identity_id, role=role):
        # 404 rather than 403: a non-visible session should not be discoverable.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Copilot session not found")
    return row


def get_owned_session(session: Session, *, session_id: int, identity_id: int, role: str) -> CopilotSession:
    row = get_readable_session(session, session_id=session_id, identity_id=identity_id, role=role)
    if row.owner_identity_id != identity_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the session owner can modify this session",
        )
    return row


def list_visible_sessions(
    session: Session,
    *,
    identity_id: int,
    role: str,
) -> list[tuple[CopilotSession, str | None, int]]:
    visible_shared = ["staff"] if role in {"staff", "admin"} else []
    if role == "admin":
        visible_shared.append("admin")

    conditions = [CopilotSession.owner_identity_id == identity_id]
    if visible_shared:
        conditions.append(CopilotSession.visibility.in_(visible_shared))

    message_counts = (
        select(CopilotMessage.session_id, func.count(CopilotMessage.id).label("message_count"))
        .group_by(CopilotMessage.session_id)
        .subquery()
    )
    stmt = (
        select(
            CopilotSession,
            func.coalesce(LiffIdentity.real_name, LiffIdentity.display_name),
            func.coalesce(message_counts.c.message_count, 0),
        )
        .join(LiffIdentity, LiffIdentity.id == CopilotSession.owner_identity_id, isouter=True)
        .join(message_counts, message_counts.c.session_id == CopilotSession.id, isouter=True)
        .where(CopilotSession.archived_at.is_(None))
        .where(or_(*conditions))
        .order_by(CopilotSession.updated_at.desc(), CopilotSession.id.desc())
    )
    return [(row[0], row[1], int(row[2] or 0)) for row in session.execute(stmt).all()]


def owner_name(session: Session, *, identity_id: int) -> str | None:
    identity = session.get(LiffIdentity, identity_id)
    if identity is None:
        return None
    return identity.real_name or identity.display_name


def message_count(session: Session, *, session_id: int) -> int:
    return int(
        session.execute(
            select(func.count(CopilotMessage.id)).where(CopilotMessage.session_id == session_id)
        ).scalar_one()
    )


def list_messages(session: Session, *, session_id: int) -> list[CopilotMessage]:
    return list(
        session.execute(
            select(CopilotMessage).where(CopilotMessage.session_id == session_id).order_by(CopilotMessage.id)
        ).scalars()
    )


def history_pairs(messages: list[CopilotMessage]) -> list[tuple[str, str]]:
    return [(row.role, row.content) for row in messages]


def append_message(
    session: Session,
    *,
    session_id: int,
    role: str,
    content: str,
    model: str | None = None,
    tool_trace: list[dict[str, Any]] | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
) -> CopilotMessage:
    row = CopilotMessage(
        session_id=session_id,
        role=role,
        content=content,
        model=model,
        tool_trace=json.dumps(tool_trace, ensure_ascii=False) if tool_trace else None,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def touch_session(session: Session, *, session_id: int) -> None:
    row = session.get(CopilotSession, session_id)
    if row is None:
        return
    row.updated_at = datetime.now(timezone.utc)
    session.commit()


def parse_tool_trace(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        return []
    return parsed if isinstance(parsed, list) else []


def derive_title(content: str) -> str:
    first_line = content.strip().splitlines()[0] if content.strip() else "新對話"
    return first_line[:60] or "新對話"
