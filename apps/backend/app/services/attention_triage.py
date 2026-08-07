"""Shared attention triage helpers for calendar unhandled counts and today-attention.

Representative selection for risk patients: earliest upload in suspected tier, else elevated.
Unhandled = risk patient whose representative has no annotation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Mapping, NamedTuple, Sequence

from app.db.models import AIResult, Patient
from app.services.symptoms import CalendarRiskTier
from app.services.taipei_dates import normalize_datetime

AttentionTier = Literal["suspected", "elevated", "other"]
HistoryOverviewScope = Literal["all", "workbench"]


def workbench_upload_where_clauses() -> tuple[Any, ...]:
    """SQLAlchemy filters for workbench-eligible uploads (active patient, non-rejected)."""
    return (
        AIResult.screening_result != "rejected",
        Patient.is_active.is_(True),
    )


def calendar_tier_to_attention_tier(tier: CalendarRiskTier) -> AttentionTier:
    if tier == "none":
        return "other"
    return tier


class TriageUploadRef(NamedTuple):
    upload_id: int
    created_at: datetime
    tier: AttentionTier
    has_annotation: bool


def select_risk_representative(refs: Sequence[TriageUploadRef]) -> TriageUploadRef | None:
    """Return earliest upload in suspected tier, else elevated; None if neither."""
    if not refs:
        return None
    has_suspected = any(ref.tier == "suspected" for ref in refs)
    has_elevated = any(ref.tier == "elevated" for ref in refs)
    if not has_suspected and not has_elevated:
        return None
    target_tier: AttentionTier = "suspected" if has_suspected else "elevated"
    candidates = [ref for ref in refs if ref.tier == target_tier]
    return min(candidates, key=lambda ref: (normalize_datetime(ref.created_at), ref.upload_id))


def count_unhandled_patients(groups: Mapping[int, Sequence[TriageUploadRef]]) -> int:
    """Count patients with a risk representative that has no annotation."""
    unhandled = 0
    for refs in groups.values():
        representative = select_risk_representative(refs)
        if representative is not None and not representative.has_annotation:
            unhandled += 1
    return unhandled
