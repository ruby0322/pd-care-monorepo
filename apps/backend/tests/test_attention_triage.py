from datetime import datetime, timezone

from app.services.attention_triage import (
    TriageUploadRef,
    calendar_tier_to_attention_tier,
    count_unhandled_patients,
    select_day_cover_upload,
    select_risk_representative,
)


def _ref(
    upload_id: int,
    *,
    tier: str,
    has_annotation: bool = False,
    minute: int = 0,
) -> TriageUploadRef:
    return TriageUploadRef(
        upload_id=upload_id,
        created_at=datetime(2026, 8, 6, 10, minute, tzinfo=timezone.utc),
        tier=tier,  # type: ignore[arg-type]
        has_annotation=has_annotation,
    )


def test_calendar_tier_to_attention_tier_maps_none_to_other() -> None:
    assert calendar_tier_to_attention_tier("none") == "other"
    assert calendar_tier_to_attention_tier("elevated") == "elevated"
    assert calendar_tier_to_attention_tier("suspected") == "suspected"


def test_workbench_upload_where_clauses_returns_two_filters() -> None:
    from app.services.attention_triage import workbench_upload_where_clauses

    clauses = workbench_upload_where_clauses()
    assert len(clauses) == 2
    joined = " ".join(str(clause) for clause in clauses)
    assert "screening_result" in joined
    assert "is_active" in joined


def test_select_risk_representative_prefers_suspected_over_elevated() -> None:
    refs = [
        _ref(1, tier="elevated", minute=1),
        _ref(2, tier="suspected", minute=5),
        _ref(3, tier="other", minute=0),
    ]
    representative = select_risk_representative(refs)
    assert representative is not None
    assert representative.upload_id == 2
    assert representative.tier == "suspected"


def test_select_risk_representative_picks_earliest_in_target_tier() -> None:
    refs = [
        _ref(10, tier="suspected", minute=20),
        _ref(11, tier="suspected", minute=5),
        _ref(12, tier="elevated", minute=1),
    ]
    representative = select_risk_representative(refs)
    assert representative is not None
    assert representative.upload_id == 11


def test_select_risk_representative_none_for_other_only() -> None:
    assert select_risk_representative([_ref(1, tier="other")]) is None


def test_select_day_cover_upload_prefers_suspected_over_elevated() -> None:
    cover = select_day_cover_upload(
        [
            _ref(1, tier="elevated", minute=1),
            _ref(2, tier="suspected", minute=5),
            _ref(3, tier="other", minute=0),
        ]
    )
    assert cover is not None
    assert cover.upload_id == 2
    assert cover.tier == "suspected"


def test_select_day_cover_upload_picks_earliest_in_target_tier() -> None:
    cover = select_day_cover_upload(
        [
            _ref(10, tier="suspected", minute=20),
            _ref(11, tier="suspected", minute=5),
            _ref(12, tier="elevated", minute=1),
        ]
    )
    assert cover is not None
    assert cover.upload_id == 11


def test_select_day_cover_upload_picks_latest_when_other_only() -> None:
    cover = select_day_cover_upload(
        [
            _ref(1, tier="other", minute=0),
            _ref(3, tier="other", minute=8),
            _ref(2, tier="other", minute=8),
        ]
    )
    assert cover is not None
    assert cover.upload_id == 3


def test_select_day_cover_upload_none_for_empty() -> None:
    assert select_day_cover_upload([]) is None


def test_count_unhandled_patients_ignores_annotated_representative() -> None:
    groups = {
        1: [_ref(1, tier="suspected", has_annotation=True)],
        2: [_ref(2, tier="elevated", has_annotation=False)],
        3: [_ref(3, tier="other")],
    }
    assert count_unhandled_patients(groups) == 1
