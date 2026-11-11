from __future__ import annotations

import asyncio
import json

from app.services.copilot.tools import (
    COPILOT_TOOLS,
    DESCRIBE_QUERIES_TOOL,
    describe_available_queries,
    dispatch_tool_call,
    openai_tool_definitions,
    resolve_tool,
)


def test_the_reference_is_offered_as_a_tool() -> None:
    names = {tool["name"] for tool in openai_tool_definitions("staff", deidentified=True)}
    assert DESCRIBE_QUERIES_TOOL.name in names


def test_it_describes_every_other_query_with_its_constraints() -> None:
    reference = describe_available_queries(role="staff", deidentified=True)

    described = {query["name"] for query in reference["queries"]}
    expected = {tool.name for tool in COPILOT_TOOLS if tool.name != DESCRIBE_QUERIES_TOOL.name}
    assert described == expected
    # It does not describe itself; that would be a reference the model has to read twice.
    assert DESCRIBE_QUERIES_TOOL.name not in described

    patients = next(query for query in reference["queries"] if query["name"] == "list_patients")
    # The constraints that were being guessed at: enums, ranges, and the free-text filter.
    assert patients["parameters"]["infection_status"]["enum"] == ["all", "suspected", "normal"]
    assert patients["parameters"]["limit"]["maximum"] == 100
    assert "query" in patients["parameters"]


def test_it_states_the_rules_a_rejected_call_needs() -> None:
    usage = " ".join(describe_available_queries(role="staff", deidentified=True)["usage"])
    assert "選填" in usage
    assert "空字串" in usage


def test_patient_ids_are_described_the_way_the_caller_must_pass_them() -> None:
    """The agent spends handles; a report's own JS spends integers. Same tool, two surfaces."""
    agent_view = describe_available_queries(role="staff", deidentified=True)
    detail = next(q for q in agent_view["queries"] if q["name"] == "get_patient_detail")
    assert detail["parameters"]["patient_id"]["pattern"] == "^P#[0-9]+$"

    report_view = describe_available_queries(role="staff", deidentified=False)
    detail = next(q for q in report_view["queries"] if q["name"] == "get_patient_detail")
    assert detail["parameters"]["patient_id"]["type"] == "integer"


def test_it_answers_without_touching_the_network() -> None:
    """No app, no authorization, no HTTP: a dispatch that tried either would raise here."""
    result = asyncio.run(
        dispatch_tool_call(
            app=None,
            tool=resolve_tool(DESCRIBE_QUERIES_TOOL.name, role="staff"),
            arguments={},
            authorization="",
            max_bytes=64_000,
            deidentify_for_session_id=1,
            role="staff",
        )
    )

    assert result.ok is True
    assert result.status_code == 200
    payload = json.loads(result.content)
    assert payload["queries"]
