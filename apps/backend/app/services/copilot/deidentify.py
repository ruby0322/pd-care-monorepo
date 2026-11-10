"""De-identification boundary for payloads bound for the LLM.

Two layers sit at the single choke point between a tool result and the model (see
`dispatch_tool_call` in `tools.py`):

- `filter_payload` is pure and side-effect free: a recursive field-name allowlist,
  no database, no network, no knowledge of where a payload came from.
- `deidentify_payload` sits on top of it and talks to the database: it turns the
  real ids `filter_payload` retains (`patient_id`, `reviewer_identity_id`, ...) into
  session-scoped handles (`P#1`, `R#1`) so the model can reason about "this patient"
  across a conversation without ever learning which row that is.

The field policy is deny-by-default: a field survives `filter_payload` only if its
exact name is in `ALLOWED_FIELDS`. A field added upstream (a new schema attribute, a
new wrapper key) is withheld until someone adds it here deliberately — the failure
mode is a visible gap in the model's data, not a silent leak.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import CopilotIdentityHandle

# These are the direct patient/staff identifiers the policy must never expose. They
# must never be added to ALLOWED_FIELDS; test_forbidden_fields_are_not_in_the_allowlist
# pins this.
FORBIDDEN_FIELDS: frozenset[str] = frozenset(
    {
        "case_number",
        "full_name",
        "patient_full_name",
        "line_user_id",
        "line_display_name",
        "real_name",
        "birth_date",
        "picture_url",
    }
)

# Row ids. Not identifiers by themselves — `patient_id` and the `*_identity_id` fields
# below are turned into opaque, session-scoped handles by `deidentify_payload`; this
# allowlist only decides what survives the field filter, not what gets re-labelled.
# Includes fields that hold a plain list of ids (`preview_upload_ids` etc.) — now that
# a scalar list is data belonging to its key, those keys need to be listed here too.
_ALLOWED_IDS: frozenset[str] = frozenset(
    {
        "id",
        "patient_id",
        "upload_id",
        "upload_ids",
        "preview_upload_ids",
        "staff_identity_id",
        "identity_id",
        "reviewer_identity_id",
        "owner_identity_id",
        "ai_result_id",
        "annotation_id",
        "representative_upload_id",
        "prev_upload_id",
        "next_upload_id",
    }
)

# The quasi-identifiers and aggregates the analysis needs: age, dates/timestamps,
# symptom flags, counts, screening_result, probability, threshold, model_version,
# tier, label, gender, is_active — expanded to the exact names the response schemas
# in app/schemas/staff_dashboard.py and app/schemas/upload_history.py use.
_ALLOWED_DATA_FIELDS: frozenset[str] = frozenset(
    {
        # Demographics / quasi-identifiers
        "age",
        "gender",
        # Boolean state flags
        "is_active",
        "can_upload",
        "has_annotation",
        "has_more_older",
        "is_read",
        "annotation_reviewed_by_me",
        # Dates and timestamps
        "created_at",
        "latest_upload_at",
        "sort_upload_at",
        "annotation_reviewed_at",
        "week_start",
        "month",
        "year",
        "available_dates",
        # Screening / risk descriptors (bounded enums and technical metadata, not
        # free text — see the deidentify brief's self-review notes on `comment`)
        "screening_result",
        "model_version",
        "error_reason",
        "content_type",
        "tier",
        "label",
        "annotation_label",
        "status",
        "summary",
        "symptom_aware_priority",
        "sort_by",
        "group_by_user",
        "group_sort_by",
        # Symptom and risk flags
        "symptom_pain",
        "symptom_discharge",
        "symptom_pus",
        "symptom_cloudy_dialysate",
        "has_high_risk_symptoms",
        "has_suspected_risk",
        "has_symptom_elevated_risk",
        "has_infection_risk",
        # Scores / ratios
        "probability",
        "threshold",
        "infection_rate",
        "suspected_ratio",
        "risk_rank",
        "highest_risk_rank",
        # Counts and aggregates
        "upload_count",
        "suspected_count",
        "total_patients",
        "total_uploads",
        "suspected_patients",
        "symptom_elevated_patients",
        "suspected_uploads",
        "symptom_elevated_uploads",
        "rejected_uploads",
        "day_upload_count",
        "labeled_upload_count",
        "uploaded_users",
        "risky_patient_count",
        "unhandled_patient_count",
        "registered_users",
        "active_users",
        "elevated_patients",
        "other_patients",
        "suspected_infected_users",
        "symptom_elevated_users",
        "symptom_elevated_patient_count",
        "uploads",
        "annotation_reviewer_count",
        "highest_risk_count",
        "suspected_users",
        "normal_uploads",
        "count",
        "continuous_upload_streak_days",
        "updated_count",
        "unread_count",
        "active_window_days",
        "reviewed_uploads",
        "reviewer_count",
        "reviewed_uploads_total",
        "reviewer_count_total",
        "assigned_count",
        "rejected_count",
        "requested_count",
        "deletable_count",
        "skipped_active_count",
        "skipped_forbidden_count",
        "skipped_missing_count",
        "deleted_count",
        "patients",
        "ai_results",
        "annotations",
        "assignments",
        "notifications",
        "daily_counts",
        # Age-histogram bucket boundaries
        "range_start",
        "range_end",
    }
)

# Structural wrapper keys the tool responses and the truncation layer use — pagination,
# day/period labels, and the truncation markers `_truncate_payload` (tools.py) adds.
#
# `error` is here too: on a rejected call, `dispatch_tool_call` builds a small
# `{"error": True, "status": ...}` wrapper for de-identified payloads, and that wrapper
# must survive this filter as-is or the model loses the ability to tell a failure from
# data (see `dispatch_tool_call`'s docstring). `error` is a fixed `True` literal with no
# model-chosen content, so allowlisting it leaks nothing.
#
# `detail` is deliberately NOT here, and deliberately not just "not allowlisted" either:
# `dispatch_tool_call` leaves it out of the dict entirely before this filter ever runs,
# rather than relying on this filter to drop it. `detail` is often itself a dict (the
# downstream endpoint's own error body, e.g. `{"detail": "..."}`), and `filter_payload`
# always keeps a dict-valued key regardless of its name — an unallowlisted `detail` would
# survive here as an emptied `{}`, not vanish. `detail` carries unbounded text that could
# echo a case number or other identifier straight back, so it must never even reach this
# filter on a de-identified path.
_STRUCTURAL_FIELDS: frozenset[str] = frozenset(
    {
        "items",
        "total",
        "limit",
        "offset",
        "date",
        "local_date",
        "lookback_days",
        "months",
        "bucket_size",
        "interval",
        "_truncated",
        "_truncated_note",
        "error",
    }
)

ALLOWED_FIELDS: frozenset[str] = _ALLOWED_IDS | _ALLOWED_DATA_FIELDS | _STRUCTURAL_FIELDS

assert ALLOWED_FIELDS.isdisjoint(FORBIDDEN_FIELDS)


def _is_container_list(items: list[Any]) -> bool:
    """True when a list is structure (holds dicts/lists) rather than data.

    An empty list can't be inspected either way; it's treated as data-shaped (its
    key must be allowlisted) so an unknown empty list defaults to withheld, not kept.
    """
    return any(isinstance(item, (dict, list)) for item in items)


def filter_payload(value: Any) -> Any:
    """Recursively drop dict keys absent from `ALLOWED_FIELDS`.

    A dict-valued key is always structure: it is kept and recursed into regardless
    of its own name, since the real filtering happens on its children. A list-valued
    key is structure only when it holds dicts (or lists) — a list of scalars (e.g.
    `tags: ["note"]`) is data belonging to that key, so it is dropped unless the key
    itself is allowlisted, the same as any other scalar. A *mixed* list under a
    non-allowlisted key is both at once: its dict/list elements are recursed into, and
    its scalar elements are dropped, because one dict in the list must not buy passage
    for a `["王小明"]` sitting beside it. A bare scalar passed to this function directly
    (e.g. one element of an already-admitted list) passes through unchanged, since there
    is no field name left to check it against.
    """
    if isinstance(value, dict):
        filtered: dict[str, Any] = {}
        for key, item in value.items():
            if isinstance(item, dict):
                filtered[key] = filter_payload(item)
            elif isinstance(item, list):
                if key in ALLOWED_FIELDS:
                    filtered[key] = [filter_payload(element) for element in item]
                elif _is_container_list(item):
                    filtered[key] = [
                        filter_payload(element)
                        for element in item
                        if isinstance(element, (dict, list))
                    ]
            elif key in ALLOWED_FIELDS:
                filtered[key] = item
        return filtered
    if isinstance(value, list):
        return [filter_payload(item) for item in value]
    return value


# Which scalar id fields get re-labelled, the handle namespace ("entity_type") they
# share, and the prefix shown to the model. `patient_id` is the only patient-side key
# today; the three identity fields below all name a staff/reviewer row and share one
# namespace so "R#1" means the same identity no matter which field surfaced it.
# `upload_id` is deliberately absent — it is an opaque surrogate key the tools use to
# correlate uploads across calls, not a person, so it is left as-is.
#
# Public because the boundary runs in both directions: `tools.py` reads this same table to
# decide which *inbound* tool parameters must arrive as handles, so the vocabulary the
# model is handed and the vocabulary it may spend can never drift apart.
HANDLE_SPECS: dict[str, tuple[str, str]] = {
    "patient_id": ("patient", "P"),
    "reviewer_identity_id": ("identity", "R"),
    "staff_identity_id": ("identity", "R"),
    "owner_identity_id": ("identity", "R"),
}


def _find_handle(
    session: Session,
    *,
    copilot_session_id: int,
    entity_type: str,
    entity_id: int,
) -> CopilotIdentityHandle | None:
    return session.execute(
        select(CopilotIdentityHandle).where(
            CopilotIdentityHandle.session_id == copilot_session_id,
            CopilotIdentityHandle.entity_type == entity_type,
            CopilotIdentityHandle.entity_id == entity_id,
        )
    ).scalar_one_or_none()


def _insert_handle_or_recover(
    session: Session,
    *,
    copilot_session_id: int,
    entity_type: str,
    entity_id: int,
    prefix: str,
) -> str:
    """Insert a new handle row, recovering if another racer inserted it first.

    There is an unavoidable gap between `_get_or_create_handle`'s SELECT and this
    INSERT: two concurrent callers minting a handle for the same
    `(copilot_session_id, entity_type, entity_id)` can both miss that SELECT and
    both land here. The `(session_id, entity_type, entity_id)` unique constraint on
    `CopilotIdentityHandle` makes the DB the tie-breaker — exactly one insert wins.
    The insert runs inside a SAVEPOINT (`session.begin_nested`) so a losing racer's
    `IntegrityError` only unwinds this one insert, not the caller's whole
    transaction (which may already hold other, unrelated handle inserts from the
    same payload walk). The loser then re-selects and returns the winner's row
    instead of raising — the standard get-or-create pattern.
    """
    count = session.execute(
        select(func.count())
        .select_from(CopilotIdentityHandle)
        .where(
            CopilotIdentityHandle.session_id == copilot_session_id,
            CopilotIdentityHandle.entity_type == entity_type,
        )
    ).scalar_one()
    handle = "{0}#{1}".format(prefix, count + 1)
    try:
        with session.begin_nested():
            session.add(
                CopilotIdentityHandle(
                    session_id=copilot_session_id,
                    handle=handle,
                    entity_type=entity_type,
                    entity_id=entity_id,
                )
            )
            # autoflush is off on this session factory; flush so the unique
            # constraint is actually checked (and raises) inside this SAVEPOINT,
            # rather than silently later at the caller's commit/flush.
            session.flush()
    except IntegrityError:
        existing = _find_handle(
            session,
            copilot_session_id=copilot_session_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        if existing is not None:
            return existing.handle
        # The unique violation wasn't this (session_id, entity_type, entity_id)
        # triple after all (e.g. a corrupted/foreign row) — don't swallow it.
        raise
    return handle


def resolve_handle(
    session: Session,
    *,
    copilot_session_id: int,
    entity_type: str,
    handle: str,
) -> int | None:
    """Reverse one handle back into the real row id it stands for, or `None`.

    The inbound half of the boundary: `_get_or_create_handle` mints `P#1` on the way out
    to the model, and this resolves the `P#1` the model sends back on its next tool call.
    The lookup is scoped by both `copilot_session_id` and `entity_type`, so a handle from
    another conversation, or one from the wrong namespace (`R#1` where a patient id is
    expected), is simply not found. `None` means "no such handle here", and callers must
    reject the call on it — never fall back to reading the argument as a real id, because
    a guess that happens to name an assigned patient produces a coherent answer about the
    *wrong* person.
    """
    return session.execute(
        select(CopilotIdentityHandle.entity_id).where(
            CopilotIdentityHandle.session_id == copilot_session_id,
            CopilotIdentityHandle.entity_type == entity_type,
            CopilotIdentityHandle.handle == handle,
        )
    ).scalar_one_or_none()


def _get_or_create_handle(
    session: Session,
    *,
    copilot_session_id: int,
    entity_type: str,
    entity_id: int,
    prefix: str,
) -> str:
    """Look up the handle for this (session, entity_type, entity_id), minting one if new.

    Numbering starts at 1 per (copilot_session_id, entity_type) and is assigned in
    insertion order; a row already present for this triple is reused as-is so the
    same real id always maps to the same handle within a session.
    """
    existing = _find_handle(
        session,
        copilot_session_id=copilot_session_id,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    if existing is not None:
        return existing.handle

    return _insert_handle_or_recover(
        session,
        copilot_session_id=copilot_session_id,
        entity_type=entity_type,
        entity_id=entity_id,
        prefix=prefix,
    )


def _substitute_identities(session: Session, copilot_session_id: int, value: Any) -> Any:
    """Walk an already-filtered payload, replacing identity-id values with handles.

    Only scalar int values under a key in `HANDLE_SPECS` are substituted — a bool
    (a subclass of int in Python) never matches one of those keys, so there's no
    risk of a flag being mistaken for an id.
    """
    if isinstance(value, dict):
        substituted: dict[str, Any] = {}
        for key, item in value.items():
            spec = HANDLE_SPECS.get(key)
            if spec is not None and isinstance(item, int) and not isinstance(item, bool):
                entity_type, prefix = spec
                substituted[key] = _get_or_create_handle(
                    session,
                    copilot_session_id=copilot_session_id,
                    entity_type=entity_type,
                    entity_id=item,
                    prefix=prefix,
                )
            else:
                substituted[key] = _substitute_identities(session, copilot_session_id, item)
        return substituted
    if isinstance(value, list):
        return [_substitute_identities(session, copilot_session_id, item) for item in value]
    return value


def deidentify_payload(session: Session, *, copilot_session_id: int, payload: Any) -> Any:
    """Filter a tool-result payload, then replace its identity ids with handles.

    This is the full boundary a tool result crosses before it reaches the model:
    `filter_payload` first drops any field not on the allowlist, then every
    remaining `patient_id` / `reviewer_identity_id` / `staff_identity_id` /
    `owner_identity_id` value is replaced with a stable, session-scoped handle
    (`P#1`, `R#1`, ...). The same real id always yields the same handle within one
    `copilot_session_id`; the same handle label means a different row in a
    different session (handles are not a global identifier).
    """
    filtered = filter_payload(payload)
    return _substitute_identities(session, copilot_session_id, filtered)
