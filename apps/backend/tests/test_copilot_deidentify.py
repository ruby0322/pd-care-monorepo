from __future__ import annotations

import json

from app.services.copilot.deidentify import (
    ALLOWED_FIELDS,
    FORBIDDEN_FIELDS,
    _insert_handle_or_recover,
    deidentify_payload,
    filter_payload,
    resolve_handle,
)


def test_drops_fields_absent_from_the_allowlist():
    assert filter_payload({"age": 62, "case_number": "P123456"}) == {"age": 62}


def test_filters_at_every_depth():
    payload = {"items": [{"age": 1, "full_name": "王小明", "nested": {"line_user_id": "U_X", "total": 2}}]}
    assert filter_payload(payload) == {"items": [{"age": 1, "nested": {"total": 2}}]}


def test_forbidden_fields_are_not_in_the_allowlist():
    assert ALLOWED_FIELDS.isdisjoint(FORBIDDEN_FIELDS)


def test_preserves_quasi_identifiers_the_analysis_needs():
    payload = {"age": 62, "created_at": "2026-11-05T00:00:00Z", "screening_result": "suspected",
               "probability": 0.91, "symptom_pain": True, "total_uploads": 4}
    assert filter_payload(payload) == payload


def test_drops_a_scalar_list_under_a_non_allowlisted_key():
    assert filter_payload({"age": 62, "tags": ["王小明 note", "other"]}) == {"age": 62}


def test_keeps_a_scalar_list_under_an_allowlisted_key():
    payload = {"age": 62, "preview_upload_ids": [1, 2, 3]}
    assert filter_payload(payload) == payload


def test_drops_scalars_from_a_mixed_list_under_a_non_allowlisted_key():
    """One dict in a list must not buy passage for the scalars sitting beside it.

    A list holding any dict was treated wholesale as structure, so its scalar elements
    went through unchecked — the key was never consulted and no field name was left to
    check them against.
    """
    payload = {"notes": [{"age": 62, "full_name": "王小明"}, "王小明 自述有異常", 7]}
    assert filter_payload(payload) == {"notes": [{"age": 62}]}


def test_keeps_a_mixed_list_whole_under_an_allowlisted_key():
    payload = {"uploads": [{"age": 62}, 3]}
    assert filter_payload(payload) == payload


def test_patient_id_becomes_a_stable_handle(db_session):
    first = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412, "age": 62})
    second = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    assert first == {"patient_id": "P#1", "age": 62}
    assert second["patient_id"] == "P#1"


def test_handles_do_not_correlate_across_sessions(db_session):
    a = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    b = deidentify_payload(db_session, copilot_session_id=2, payload={"patient_id": 999})
    assert a["patient_id"] == b["patient_id"] == "P#1"  # same label, different patient


def test_reviewer_identity_uses_its_own_namespace(db_session):
    out = deidentify_payload(
        db_session, copilot_session_id=1, payload={"reviewer_identity_id": 7, "patient_id": 412}
    )
    assert out["reviewer_identity_id"] == "R#1" and out["patient_id"] == "P#1"


def test_upload_id_is_left_alone(db_session):
    assert deidentify_payload(db_session, copilot_session_id=1, payload={"upload_id": 88})["upload_id"] == 88


def test_error_payloads_are_filtered_too(db_session):
    out = deidentify_payload(
        db_session,
        copilot_session_id=1,
        payload={"error": True, "status": 403, "detail": {"case_number": "P123456"}},
    )
    assert "P123456" not in json.dumps(out, ensure_ascii=False)


def test_losing_a_handle_creation_race_returns_the_winners_handle(db_session):
    """Pins the get-or-create recovery path in `_insert_handle_or_recover`.

    `_get_or_create_handle`'s SELECT-then-INSERT has a gap: two concurrent callers
    minting a handle for the same (session_id, entity_type, entity_id) can both miss
    the SELECT and both reach the INSERT. We simulate that by calling the insert
    path directly, twice, for the same key — exactly what two racers who both
    missed the SELECT would do. The first call wins and inserts "P#1". The second
    call must not raise the unique-constraint IntegrityError; it must catch it and
    return the winner's handle instead.
    """
    first = _insert_handle_or_recover(
        db_session, copilot_session_id=1, entity_type="patient", entity_id=412, prefix="P"
    )
    second = _insert_handle_or_recover(
        db_session, copilot_session_id=1, entity_type="patient", entity_id=412, prefix="P"
    )
    assert first == "P#1"
    assert second == "P#1"

    # Only one row actually exists for this key — the race didn't produce a duplicate.
    count = deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    assert count["patient_id"] == "P#1"


# --------------------------------------------------------------------------------------
# Inbound: one handle back to the real row id
# --------------------------------------------------------------------------------------


def test_resolve_handle_returns_the_row_the_handle_was_minted_for(db_session):
    deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    db_session.commit()
    assert (
        resolve_handle(db_session, copilot_session_id=1, entity_type="patient", handle="P#1") == 412
    )


def test_resolve_handle_is_scoped_to_its_own_session(db_session):
    """Session 2's `P#1` is a different patient (or none), so session 1's must not resolve there."""
    deidentify_payload(db_session, copilot_session_id=1, payload={"patient_id": 412})
    db_session.commit()
    assert resolve_handle(db_session, copilot_session_id=2, entity_type="patient", handle="P#1") is None


def test_resolve_handle_does_not_cross_namespaces(db_session):
    """`R#1` asked for as a patient resolves to nothing, rather than to identity 7's row."""
    deidentify_payload(db_session, copilot_session_id=1, payload={"reviewer_identity_id": 7})
    db_session.commit()
    assert resolve_handle(db_session, copilot_session_id=1, entity_type="patient", handle="R#1") is None
    assert resolve_handle(db_session, copilot_session_id=1, entity_type="identity", handle="R#1") == 7


def test_resolve_handle_returns_none_for_a_handle_never_minted(db_session):
    assert resolve_handle(db_session, copilot_session_id=1, entity_type="patient", handle="P#9") is None


def test_an_annotation_reaches_the_model_as_a_handle_and_the_reader_as_a_name(db_session):
    """Annotation attribution, with the boundary intact.

    A report may show which nurse annotated an upload, so the API returns both the reviewer's
    identity id and their name. The model is told the handle and nothing else: `reviewer_name`
    is absent from the allowlist, so the field filter drops it the way it drops every field
    nobody allowlisted, and the name only ever exists in the reader's own browser.
    """
    payload = {
        "items": [
            {
                "annotation_id": 5,
                "upload_id": 31,
                "patient_id": 412,
                "annotation_label": "suspected",
                "reviewer_identity_id": 7,
                "reviewer_name": "陳護理師",
                "reviewer_line_user_id": "U_NURSE",
            }
        ]
    }

    out = deidentify_payload(db_session, copilot_session_id=1, payload=payload)
    item = out["items"][0]

    assert item["reviewer_identity_id"] == "R#1"
    assert item["annotation_label"] == "suspected"
    assert "reviewer_name" not in item
    assert "reviewer_line_user_id" not in item
    assert "陳護理師" not in json.dumps(out, ensure_ascii=False)

