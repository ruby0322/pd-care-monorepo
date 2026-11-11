"""Copilot session storage and visibility rules.

Visibility: ``private`` = owner only, ``staff`` = any staff/admin, ``admin`` = admin only.
Writes (sending a message, renaming, deleting) are always owner-only, so a shared session
is a read-only transcript for everybody else.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import CopilotIdentityHandle, CopilotMessage, CopilotModule, CopilotSession, LiffIdentity, Patient
from app.schemas.copilot import CopilotHandleLabel
from app.services.auth import AuthPrincipal

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


# Deliberately stricter than the frontend's `usesLiveBridge` (`artifact-bridge.ts`), which
# also accepts a bare `window.pdcare` reference. That looseness is fine there -- it only
# decides whether to switch live data on by default -- but here it would be the whole hole:
# `<!-- window.pdcare -->` in an otherwise static table satisfies a bare-reference match
# and nothing is ever fetched. The save path requires an actual call.
_LIVE_BRIDGE_CALL = re.compile(r"\bpdcare\s*\.\s*query\s*\(")


def uses_live_bridge(html: str) -> bool:
    """True when this markup actually calls the artifact's live-data bridge.

    Ported from the frontend (where it decides whether to switch live data on by default)
    because the save path is the only place that can stop a *shared* module from being a
    shared *dataset*. A module is supposed to store code: every figure it shows is fetched
    when it runs, through ``/v1/copilot/proxy`` under the viewer's own token, which is why
    opening a colleague's module surfaces only the patients assigned to *that* viewer.
    HTML with its numbers inlined as literals does none of that -- it shows the author's
    cohort to everyone who opens it, and the proxy is never called, so none of the
    assignment scoping enforced on every other read path applies.

    A call, not a mention: matching a bare ``window.pdcare`` reference would let
    ``<!-- window.pdcare -->`` pasted into a static table through, which is exactly the
    case this check exists to stop.

    Necessary, not sufficient: HTML can call the bridge *and* still embed a snapshot of
    the author's rows alongside. This rules out the wholly static report; it does not
    prove that a module carries no data.
    """
    return _LIVE_BRIDGE_CALL.search(html) is not None


def assert_shared_module_fetches_live(html: str, *, visibility: str) -> None:
    """A module visible to anyone but its owner has to fetch its own data at run time.

    ``private`` is exempt: whatever such a module displays is the owner's own data either
    way, and nobody else can open it. Applied on create *and* on update, since promoting
    an existing static module to ``staff`` publishes exactly the same rows.
    """
    if visibility == "private" or uses_live_bridge(html):
        return
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=(
            "要分享的模組必須在每次開啟時自行查詢資料，才會顯示開啟者自己的病人。"
            "這份報表的數字是儲存當下寫死的內容，請改存為「僅自己」，"
            "或請 Copilot 改寫成開啟時即時查詢的版本。"
        ),
    )


def _can_read_shared(*, owner_identity_id: int, visibility: str, identity_id: int, role: str) -> bool:
    """The shared visibility rule behind every ``can_read*``/``get_readable_*`` helper.

    Factored out of :func:`can_read` so :class:`CopilotModule` rows -- which carry the
    same ``owner_identity_id``/``visibility`` shape as :class:`CopilotSession` rows -- can
    reuse the exact same rule rather than a second copy of it.
    """
    if owner_identity_id == identity_id:
        return True
    if visibility == "staff":
        return role in {"staff", "admin"}
    if visibility == "admin":
        return role == "admin"
    return False


def can_read(session_row: CopilotSession, *, identity_id: int, role: str) -> bool:
    return _can_read_shared(
        owner_identity_id=session_row.owner_identity_id,
        visibility=session_row.visibility,
        identity_id=identity_id,
        role=role,
    )


def can_read_module(module_row: CopilotModule, *, identity_id: int, role: str) -> bool:
    return _can_read_shared(
        owner_identity_id=module_row.owner_identity_id,
        visibility=module_row.visibility,
        identity_id=identity_id,
        role=role,
    )


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


def create_module(
    session: Session,
    *,
    owner_identity_id: int,
    title: str,
    description: str | None,
    html: str,
    visibility: str,
    source_session_id: int | None,
    source_message_id: int | None,
) -> CopilotModule:
    row = CopilotModule(
        owner_identity_id=owner_identity_id,
        title=title,
        description=description,
        html=html,
        visibility=visibility,
        source_session_id=source_session_id,
        source_message_id=source_message_id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_readable_module(
    session: Session,
    *,
    module_id: int,
    identity_id: int,
    role: str,
) -> CopilotModule:
    row = session.get(CopilotModule, module_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Copilot module not found")
    if not can_read_module(row, identity_id=identity_id, role=role):
        # 404 rather than 403: a non-visible module should not be discoverable.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Copilot module not found")
    return row


def get_owned_module(session: Session, *, module_id: int, identity_id: int, role: str) -> CopilotModule:
    row = get_readable_module(session, module_id=module_id, identity_id=identity_id, role=role)
    if row.owner_identity_id != identity_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the module owner can modify this module",
        )
    return row


def list_visible_modules(
    session: Session,
    *,
    identity_id: int,
    role: str,
) -> list[tuple[CopilotModule, str | None]]:
    visible_shared = ["staff"] if role in {"staff", "admin"} else []
    if role == "admin":
        visible_shared.append("admin")

    conditions = [CopilotModule.owner_identity_id == identity_id]
    if visible_shared:
        conditions.append(CopilotModule.visibility.in_(visible_shared))

    stmt = (
        select(CopilotModule, func.coalesce(LiffIdentity.real_name, LiffIdentity.display_name))
        .join(LiffIdentity, LiffIdentity.id == CopilotModule.owner_identity_id, isouter=True)
        .where(or_(*conditions))
        .order_by(CopilotModule.updated_at.desc(), CopilotModule.id.desc())
    )
    return [(row[0], row[1]) for row in session.execute(stmt).all()]


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


def rename_session(session: Session, *, session_id: int, title: str) -> CopilotSession | None:
    """Set a session's title, or do nothing if it has been deleted meanwhile.

    None rather than an exception: the only caller is the model-generated name that lands
    after a turn, and a thread deleted while its answer was streaming is a normal race, not
    a fault worth surfacing.
    """
    row = session.get(CopilotSession, session_id)
    if row is None:
        return None
    row.title = title
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


# --------------------------------------------------------------------------------------
# Handle -> label resolution: the per-viewer re-identification boundary.
#
# A `CopilotIdentityHandle` row is the opaque (handle, entity_type, entity_id) mapping
# `deidentify_payload` minted for the model. The nurse viewing a transcript still needs
# to read real names, so these helpers turn each handle back into a label *for this one
# viewer* -- a patient handle is only labelled when the viewer can see that patient
# (admin, or an assigned staff member); a denied label is `None`, never an HTTPException,
# because a handle that exists in the transcript must always appear in the response, just
# without a name attached.
# --------------------------------------------------------------------------------------


def list_handles(session: Session, *, copilot_session_id: int) -> list[CopilotIdentityHandle]:
    return list(
        session.execute(
            select(CopilotIdentityHandle).where(CopilotIdentityHandle.session_id == copilot_session_id)
        ).scalars()
    )


def _patient_label(patient: Patient | None) -> str | None:
    if patient is None:
        return None
    if patient.full_name:
        return "{0} ({1})".format(patient.full_name, patient.case_number)
    return patient.case_number


def _identity_label(identity: LiffIdentity | None) -> str | None:
    if identity is None:
        return None
    return identity.real_name or identity.display_name


def _accessible_patient_ids(session: Session, *, principal: AuthPrincipal) -> set[int] | None:
    """`get_accessible_patient_ids`, imported at call time rather than at module scope.

    `app.api.routes.staff_parts.shared` lives under the `app.api` package, and
    `app/api/__init__.py` unconditionally imports `app.api.router`, which unconditionally
    imports `app.api.routes.copilot` -- which imports *this* module (`sessions.py`) for
    `append_message`, `resolve_handles`, etc. A module-level import of `shared` here is
    therefore a genuine cycle, not a hypothetical one: it only "works" when something
    else (e.g. `app.main`) has already fully imported `app.api` before anything first
    touches `app.services.copilot.sessions`. Reproduced directly --
    `python3 -c "from app.services.copilot.sessions import resolve_handles"` in a bare
    process raises `ImportError: cannot import name 'append_message' from partially
    initialized module 'app.services.copilot.sessions'` -- because that import order
    re-enters this module (via the chain above) before any of its own names, including
    the ones `copilot.py` asks for, are defined yet. Deferring the import to call time
    sidesteps it: by the time any route handler actually runs, the whole app has long
    since finished importing.
    """
    from app.api.routes.staff_parts.shared import get_accessible_patient_ids

    return get_accessible_patient_ids(session, role=principal.role, identity_id=principal.identity_id)


def label_for_handle(
    session: Session,
    *,
    principal: AuthPrincipal,
    entity_type: str,
    entity_id: int,
) -> str | None:
    """Resolve one handle's label for `principal`, or `None` if they may not see it.

    `entity_type == "patient"` is gated on patient-assignment scoping (via
    `get_accessible_patient_ids`, which every caller of this module's routes already
    passed to reach here). `entity_type == "identity"` (a reviewer handle) carries a
    staff name, not patient data, so it is never gated per-patient -- only the
    staff-or-admin role on the route, which the caller already enforced.

    Single-row resolver for the SSE path, where at most a handful of handles are newly
    minted per tool call. `resolve_handles` below resolves a whole session's worth of
    handles at once and batches its permission check and row lookups instead of calling
    this in a loop -- calling this per row there would re-derive the same
    accessible-patient set and re-fetch the same rows once per handle.
    """
    if entity_type == "patient":
        accessible = _accessible_patient_ids(session, principal=principal)
        if accessible is not None and entity_id not in accessible:
            return None
        return _patient_label(session.get(Patient, entity_id))
    return _identity_label(session.get(LiffIdentity, entity_id))


def resolve_handles(
    session: Session,
    *,
    copilot_session_id: int,
    principal: AuthPrincipal,
) -> dict[str, CopilotHandleLabel]:
    """Resolve every handle minted so far in this copilot session, for one viewer.

    Computes the viewer's accessible-patient set once (rather than re-deriving the
    identical set once per patient handle) and batches the patient and identity row
    lookups into one query each (rather than one `session.get` per handle). This runs
    on every session open, so it is worth not leaving the obvious per-row N+1 in place
    even though handle counts are small today.
    """
    rows = list_handles(session, copilot_session_id=copilot_session_id)
    if not rows:
        return {}

    patient_ids = {row.entity_id for row in rows if row.entity_type == "patient"}
    identity_ids = {row.entity_id for row in rows if row.entity_type != "patient"}

    # `None` means admin (every patient accessible); only computed when there is at
    # least one patient handle to check it against.
    accessible = _accessible_patient_ids(session, principal=principal) if patient_ids else None
    visible_patient_ids = patient_ids if accessible is None else (patient_ids & accessible)

    patients_by_id: dict[int, Patient] = {}
    if visible_patient_ids:
        patients_by_id = {
            patient.id: patient
            for patient in session.execute(
                select(Patient).where(Patient.id.in_(visible_patient_ids))
            ).scalars()
        }

    identities_by_id: dict[int, LiffIdentity] = {}
    if identity_ids:
        identities_by_id = {
            identity.id: identity
            for identity in session.execute(
                select(LiffIdentity).where(LiffIdentity.id.in_(identity_ids))
            ).scalars()
        }

    handles: dict[str, CopilotHandleLabel] = {}
    for row in rows:
        if row.entity_type == "patient":
            # Denied or dangling (patient deleted after the handle was minted) both
            # land here as a simple dict miss -- no exception either way.
            label = _patient_label(patients_by_id.get(row.entity_id))
        else:
            label = _identity_label(identities_by_id.get(row.entity_id))
        handles[row.handle] = CopilotHandleLabel(entity_type=row.entity_type, label=label)
    return handles
