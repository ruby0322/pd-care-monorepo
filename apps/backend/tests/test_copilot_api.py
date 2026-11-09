from __future__ import annotations
# pyright: reportMissingImports=false

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, Annotation, LiffIdentity, Patient, StaffPatientAssignment, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService
from app.api.routes import copilot as copilot_routes
from app.services.copilot.deidentify import deidentify_payload
from app.services.copilot.sessions import copilot_proxy_rate_limiter
from app.services.copilot.agent import echoable_output_item
from app.services.copilot.tools import COPILOT_TOOLS, CopilotToolError, dispatch_tool_call, resolve_tool
from app.services.taipei_dates import to_taipei_date
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path, **overrides) -> Settings:
    base = dict(
        app_name="test-copilot-api",
        app_env="test",
        model_url="https://example.com/model.pt",
        model_path=Path("/tmp/model.pt"),
        model_cache_dir=Path("/tmp"),
        model_timeout_seconds=5.0,
        device="cpu",
        model_backbone="mobilenet_v3_large",
        model_arch="baseline",
        transfer_dropout=0.4,
        threshold=0.5,
        image_size=384,
        infection_class_index=4,
        class_names=("class_0", "class_1", "class_2", "class_3", "class_4"),
        max_upload_mb=10,
        log_level="INFO",
        accepted_content_types=("image/jpeg", "image/png"),
        cors_allowed_origins=("http://localhost:3000",),
        cors_allowed_origin_regex=r"^https?://(?:\d{1,3}\.){3}\d{1,3}:3000$",
        workers=1,
        eval_hflip_tta=False,
        database_url=migrated_sqlite_database_url(db_path),
        s3_endpoint_url="http://localhost:8333",
        s3_region="us-east-1",
        s3_access_key="seaweed-access",
        s3_secret_key="seaweed-secret",
        s3_bucket_name="pd-care-private",
        image_access_token_secret="test-secret",
        image_access_token_ttl_seconds=300,
        auth_token_secret="test-auth-secret",
        auth_token_ttl_seconds=3600,
        line_verify_mode="stub",
        copilot_enabled=True,
        openai_api_key="test-openai-key",
        copilot_models=("test-model", "test-model-mini"),
        copilot_default_model="test-model",
    )
    base.update(overrides)
    return Settings(**base)


def build_client(tmp_path: Path, name: str, **overrides) -> TestClient:
    settings = make_settings(tmp_path / f"{name}.db", **overrides)
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    return TestClient(app)


def seed_identity(client: TestClient, *, line_user_id: str, role: str, name: str | None = None) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name=name or line_user_id,
            real_name=name,
            picture_url=None,
            patient_id=None,
            role=role,
        )
        session.add(identity)
        session.commit()
        session.refresh(identity)
        return identity.id


def seed_patient(client: TestClient, *, case_number: str, suspected: bool = True) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number=case_number, birth_date="1980-01-02", full_name=f"病患 {case_number}")
        session.add(patient)
        session.flush()
        upload = Upload(
            patient_id=patient.id,
            object_key=f"uploads/{case_number}.jpg",
            content_type="image/jpeg",
            created_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        session.add(upload)
        session.flush()
        session.add(
            AIResult(
                upload_id=upload.id,
                predicted_class="class_4" if suspected else "class_0",
                probability=0.91 if suspected else 0.1,
                threshold=0.5,
                screening_result="suspected" if suspected else "normal",
                model_version="test-v1",
            )
        )
        session.commit()
        return patient.id


def assign(client: TestClient, *, staff_identity_id: int, patient_id: int) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(StaffPatientAssignment(staff_identity_id=staff_identity_id, patient_id=patient_id))
        session.commit()


def headers_for(client: TestClient, identity_id: int, *, role: str, line_user_id: str) -> dict[str, str]:
    token_service = AuthTokenService(secret=client.app.state.settings.auth_token_secret)
    token = token_service.issue_token(
        identity_id=identity_id,
        line_user_id=line_user_id,
        role=role,
        patient_id=None,
        ttl_seconds=client.app.state.settings.auth_token_ttl_seconds,
    )
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------------------
# Fake OpenAI client
# --------------------------------------------------------------------------------------


class _FakeEvent:
    def __init__(self, type_: str, **kwargs) -> None:
        self.type = type_
        for key, value in kwargs.items():
            setattr(self, key, value)


class _FakeFunctionCall:
    type = "function_call"

    def __init__(self, name: str, arguments: dict, call_id: str = "call_1") -> None:
        self.name = name
        self.arguments = json.dumps(arguments)
        self.call_id = call_id

    def model_dump(self) -> dict:
        # Mirrors the real SDK: output items carry output-only fields such as `status`,
        # which the Responses API rejects if they are echoed back as input.
        return {
            "type": "function_call",
            "name": self.name,
            "arguments": self.arguments,
            "call_id": self.call_id,
            "id": f"fc_{self.call_id}",
            "status": "completed",
        }


class _FakeStream:
    def __init__(self, events: list[_FakeEvent]) -> None:
        self._events = events

    def __aiter__(self):
        async def gen():
            for event in self._events:
                yield event

        return gen()


class _FakeResponses:
    def __init__(self, turns: list[list[_FakeEvent]]) -> None:
        self._turns = turns
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        index = min(len(self.calls) - 1, len(self._turns) - 1)
        return _FakeStream(self._turns[index])


class FakeOpenAI:
    def __init__(self, turns: list[list[_FakeEvent]]) -> None:
        self.responses = _FakeResponses(turns)


def completed(text: str = "", calls: list[_FakeFunctionCall] | None = None) -> _FakeEvent:
    response = SimpleNamespace(
        output=list(calls or []),
        usage=SimpleNamespace(input_tokens=11, output_tokens=7),
    )
    return _FakeEvent("response.completed", response=response)


def text_turn(text: str) -> list[_FakeEvent]:
    return [_FakeEvent("response.output_text.delta", delta=text), completed(text)]


def install_fake_openai(monkeypatch: pytest.MonkeyPatch, turns: list[list[_FakeEvent]]) -> FakeOpenAI:
    fake = FakeOpenAI(turns)
    # The route imports build_openai_client into its own namespace, so that is the binding
    # a test has to replace; patching the agent module alone would leave the real client in place.
    monkeypatch.setattr(copilot_routes, "build_openai_client", lambda **_kwargs: fake)
    return fake


def read_sse(response) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    current_event: str | None = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line[len("event: ") :]
        elif line.startswith("data: ") and current_event is not None:
            events.append((current_event, json.loads(line[len("data: ") :])))
            current_event = None
    return events


# --------------------------------------------------------------------------------------
# Models endpoint
# --------------------------------------------------------------------------------------


def test_models_endpoint_reports_env_driven_list(tmp_path: Path) -> None:
    with build_client(tmp_path, "models") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        response = client.get("/v1/copilot/models", headers=headers_for(client, staff_id, role="staff", line_user_id="U_STAFF"))
        assert response.status_code == 200
        assert response.json() == {"enabled": True, "models": ["test-model", "test-model-mini"], "default_model": "test-model"}


def test_models_endpoint_reports_disabled_without_api_key(tmp_path: Path) -> None:
    with build_client(tmp_path, "models-disabled", openai_api_key=None) as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        response = client.get("/v1/copilot/models", headers=headers_for(client, staff_id, role="staff", line_user_id="U_STAFF"))
        assert response.status_code == 200
        assert response.json() == {"enabled": False, "models": [], "default_model": None}


def test_patient_token_cannot_reach_copilot(tmp_path: Path) -> None:
    with build_client(tmp_path, "patient-denied") as client:
        patient_identity_id = seed_identity(client, line_user_id="U_PATIENT", role="patient")
        response = client.get(
            "/v1/copilot/models",
            headers=headers_for(client, patient_identity_id, role="patient", line_user_id="U_PATIENT"),
        )
        assert response.status_code == 403


# --------------------------------------------------------------------------------------
# Visibility matrix
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("visibility", "other_staff_status", "other_admin_status"),
    [
        ("private", 404, 404),
        ("staff", 200, 200),
    ],
)
def test_session_visibility_controls_reads(
    tmp_path: Path, visibility: str, other_staff_status: int, other_admin_status: int
) -> None:
    with build_client(tmp_path, f"visibility-{visibility}") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        other_staff_id = seed_identity(client, line_user_id="U_OTHER", role="staff")
        admin_id = seed_identity(client, line_user_id="U_ADMIN", role="admin")

        owner_headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")
        created = client.post("/v1/copilot/sessions", json={"visibility": visibility}, headers=owner_headers)
        assert created.status_code == 201
        session_id = created.json()["session_id"]
        assert created.json()["can_write"] is True

        assert client.get(f"/v1/copilot/sessions/{session_id}", headers=owner_headers).status_code == 200
        assert (
            client.get(
                f"/v1/copilot/sessions/{session_id}",
                headers=headers_for(client, other_staff_id, role="staff", line_user_id="U_OTHER"),
            ).status_code
            == other_staff_status
        )
        assert (
            client.get(
                f"/v1/copilot/sessions/{session_id}",
                headers=headers_for(client, admin_id, role="admin", line_user_id="U_ADMIN"),
            ).status_code
            == other_admin_status
        )


def test_admin_visibility_is_hidden_from_staff(tmp_path: Path) -> None:
    with build_client(tmp_path, "visibility-admin") as client:
        owner_id = seed_identity(client, line_user_id="U_ADMIN_OWNER", role="admin")
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        other_admin_id = seed_identity(client, line_user_id="U_ADMIN2", role="admin")

        created = client.post(
            "/v1/copilot/sessions",
            json={"visibility": "admin"},
            headers=headers_for(client, owner_id, role="admin", line_user_id="U_ADMIN_OWNER"),
        )
        assert created.status_code == 201
        session_id = created.json()["session_id"]

        assert (
            client.get(
                f"/v1/copilot/sessions/{session_id}",
                headers=headers_for(client, staff_id, role="staff", line_user_id="U_STAFF"),
            ).status_code
            == 404
        )
        assert (
            client.get(
                f"/v1/copilot/sessions/{session_id}",
                headers=headers_for(client, other_admin_id, role="admin", line_user_id="U_ADMIN2"),
            ).status_code
            == 200
        )


def test_staff_cannot_create_admin_visible_session(tmp_path: Path) -> None:
    with build_client(tmp_path, "visibility-admin-denied") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        response = client.post(
            "/v1/copilot/sessions",
            json={"visibility": "admin"},
            headers=headers_for(client, staff_id, role="staff", line_user_id="U_STAFF"),
        )
        assert response.status_code == 403


def test_non_owner_cannot_write_or_mutate_shared_session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    install_fake_openai(monkeypatch, [text_turn("hi")])
    with build_client(tmp_path, "shared-readonly") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        other_id = seed_identity(client, line_user_id="U_OTHER", role="staff")
        owner_headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")
        other_headers = headers_for(client, other_id, role="staff", line_user_id="U_OTHER")

        session_id = client.post(
            "/v1/copilot/sessions", json={"visibility": "staff"}, headers=owner_headers
        ).json()["session_id"]

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=other_headers)
        assert detail.status_code == 200
        assert detail.json()["session"]["can_write"] is False
        assert detail.json()["session"]["is_owner"] is False

        assert client.post(
            f"/v1/copilot/sessions/{session_id}/messages", json={"content": "讓我寫"}, headers=other_headers
        ).status_code == 403
        assert client.patch(
            f"/v1/copilot/sessions/{session_id}", json={"title": "改名"}, headers=other_headers
        ).status_code == 403
        assert client.delete(f"/v1/copilot/sessions/{session_id}", headers=other_headers).status_code == 403
        assert client.delete(f"/v1/copilot/sessions/{session_id}", headers=owner_headers).status_code == 204


def test_session_list_includes_own_and_shared_only(tmp_path: Path) -> None:
    with build_client(tmp_path, "session-list") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff", name="王小明")
        other_id = seed_identity(client, line_user_id="U_OTHER", role="staff")
        owner_headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")
        other_headers = headers_for(client, other_id, role="staff", line_user_id="U_OTHER")

        client.post("/v1/copilot/sessions", json={"visibility": "private", "title": "私人"}, headers=owner_headers)
        client.post("/v1/copilot/sessions", json={"visibility": "staff", "title": "共享"}, headers=owner_headers)
        client.post("/v1/copilot/sessions", json={"visibility": "private", "title": "別人私人"}, headers=other_headers)

        titles = {item["title"] for item in client.get("/v1/copilot/sessions", headers=other_headers).json()["items"]}
        assert titles == {"共享", "別人私人"}

        shared = next(
            item
            for item in client.get("/v1/copilot/sessions", headers=other_headers).json()["items"]
            if item["title"] == "共享"
        )
        assert shared["owner_name"] == "王小明"
        assert shared["can_write"] is False


def test_unsupported_model_is_rejected(tmp_path: Path) -> None:
    with build_client(tmp_path, "model-rejected") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        response = client.post(
            "/v1/copilot/sessions",
            json={"model": "definitely-not-allowed"},
            headers=headers_for(client, staff_id, role="staff", line_user_id="U_STAFF"),
        )
        assert response.status_code == 422


def test_copilot_is_unavailable_when_disabled(tmp_path: Path) -> None:
    with build_client(tmp_path, "disabled", copilot_enabled=False) as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        assert client.post("/v1/copilot/sessions", json={}, headers=headers).status_code == 503
        assert client.post(
            "/v1/copilot/proxy", json={"tool": "get_today_attention", "params": {}}, headers=headers
        ).status_code == 503


# --------------------------------------------------------------------------------------
# Cohort analytics: staff-accessible, de-identified
# --------------------------------------------------------------------------------------


def test_staff_can_read_cohort_analytics_without_patient_identity(tmp_path: Path) -> None:
    with build_client(tmp_path, "cohort") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        # Deliberately unassigned: cohort aggregates still count this patient.
        seed_patient(client, case_number="P900001", suspected=True)
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")

        summary = client.get("/v1/staff/analytics/suspected-summary", params={"months": 3}, headers=headers)
        assert summary.status_code == 200
        assert summary.json()["suspected_uploads"] == 1

        series = client.get("/v1/staff/analytics/suspected-series", params={"lookback_days": 30}, headers=headers)
        assert series.status_code == 200
        # Pin the point shape: these endpoints re-serialize shared service tuples, so a
        # field added upstream must be surfaced here rather than silently defaulting.
        point = next(item for item in series.json()["items"] if item["total_uploads"] > 0)
        assert point["suspected_uploads"] == 1
        assert point["labeled_uploads"] == 0
        assert set(point) == {
            "date",
            "total_uploads",
            "labeled_uploads",
            "suspected_uploads",
            "symptom_elevated_uploads",
            "suspected_ratio",
        }
        body = series.text
        for leaked in ("case_number", "P900001", "full_name", "patient_id", "line_user_id"):
            assert leaked not in body

        for path in (
            "/v1/staff/analytics/age-histogram",
            "/v1/staff/analytics/gender-distribution",
            "/v1/staff/analytics/active-users",
        ):
            assert client.get(path, headers=headers).status_code == 200


def test_admin_only_analytics_remain_closed_to_staff(tmp_path: Path) -> None:
    with build_client(tmp_path, "cohort-admin-only") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        assert client.get("/v1/staff/admin/analytics/daily-suspected-series", headers=headers).status_code == 403
        assert client.get("/v1/staff/admin/analytics/gender-distribution", headers=headers).status_code == 403


# --------------------------------------------------------------------------------------
# Proxy allowlist
# --------------------------------------------------------------------------------------


def test_proxy_runs_allowlisted_tool_as_caller(tmp_path: Path) -> None:
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, "proxy-ok") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        response = client.post(
            "/v1/copilot/proxy",
            json={"tool": "get_cohort_suspected_series", "params": {"lookback_days": 14}},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
        assert response.json()["data"]["lookback_days"] == 14


def test_proxy_rejects_unknown_tool_and_bad_path_param(tmp_path: Path) -> None:
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, "proxy-reject") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")

        unknown = client.post(
            "/v1/copilot/proxy", json={"tool": "delete_everything", "params": {}}, headers=headers
        )
        assert unknown.status_code == 400

        traversal = client.post(
            "/v1/copilot/proxy",
            json={"tool": "list_patient_uploads", "params": {"patient_id": "../../v1/staff/admin/users"}},
            headers=headers,
        )
        assert traversal.status_code == 400

        missing = client.post(
            "/v1/copilot/proxy", json={"tool": "list_patient_uploads", "params": {}}, headers=headers
        )
        assert missing.status_code == 400


def test_proxy_preserves_assignment_scoping(tmp_path: Path) -> None:
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, "proxy-scope") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        unassigned_patient_id = seed_patient(client, case_number="P900002")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")

        response = client.post(
            "/v1/copilot/proxy",
            json={"tool": "list_patient_uploads", "params": {"patient_id": unassigned_patient_id}},
            headers=headers,
        )
        # The proxy call itself succeeds; the underlying endpoint refuses, and that refusal
        # is handed back as data so the model can explain the boundary.
        assert response.status_code == 200
        assert response.json()["ok"] is False
        assert response.json()["status"] == 403

        assign(client, staff_identity_id=staff_id, patient_id=unassigned_patient_id)
        allowed = client.post(
            "/v1/copilot/proxy",
            json={"tool": "list_patient_uploads", "params": {"patient_id": unassigned_patient_id}},
            headers=headers,
        )
        assert allowed.json()["ok"] is True
        assert allowed.json()["data"]["total"] == 1


def test_proxy_rate_limit_returns_429(tmp_path: Path) -> None:
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, "proxy-rate", copilot_proxy_rate_limit_per_minute=2) as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        payload = {"tool": "get_cohort_gender_distribution", "params": {}}
        assert client.post("/v1/copilot/proxy", json=payload, headers=headers).status_code == 200
        assert client.post("/v1/copilot/proxy", json=payload, headers=headers).status_code == 200
        assert client.post("/v1/copilot/proxy", json=payload, headers=headers).status_code == 429
    copilot_proxy_rate_limiter.reset()


def test_echoed_output_items_drop_output_only_fields() -> None:
    """Regression: echoing `status` back caused 400 Unknown parameter: 'input[1].status'."""
    echoed = echoable_output_item(_FakeFunctionCall("get_today_attention", {}))
    assert "status" not in echoed
    assert echoed["call_id"] == "call_1"
    assert echoed["name"] == "get_today_attention"

    nested = echoable_output_item(
        {"type": "reasoning", "status": "completed", "summary": [{"text": "x", "status": "done"}], "nulled": None}
    )
    assert "status" not in nested
    assert "status" not in nested["summary"][0]
    assert "nulled" not in nested


def test_tool_turn_sends_no_output_only_fields_to_the_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The second request must not carry `status` anywhere in its input payload."""
    fake = install_fake_openai(
        monkeypatch,
        [
            [completed(calls=[_FakeFunctionCall("get_cohort_gender_distribution", {})])],
            text_turn("完成。"),
        ],
    )
    with build_client(tmp_path, "agent-echo-clean") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages", json={"content": "性別分佈"}, headers=headers
        )
        assert response.status_code == 200

    assert len(fake.responses.calls) == 2
    follow_up_input = fake.responses.calls[1]["input"]
    assert json.dumps(follow_up_input, default=str).find('"status"') == -1, follow_up_input
    # The function_call item and its output must still be present and paired.
    kinds = [item.get("type") for item in follow_up_input if isinstance(item, dict)]
    assert "function_call" in kinds
    assert "function_call_output" in kinds


def test_unknown_tool_is_rejected() -> None:
    with pytest.raises(CopilotToolError):
        resolve_tool("not_a_tool", role="admin")


def test_every_allowlisted_tool_points_at_a_registered_get_route(tmp_path: Path) -> None:
    """A typo in a path template would otherwise only surface as a runtime 404.

    Asserted against the OpenAPI schema rather than by walking ``app.routes``: newer
    Starlette does not flatten included routers into ``app.routes``, so iterating it sees
    only a handful of top-level routes and would miss every mounted path.
    """
    with build_client(tmp_path, "tool-paths") as client:
        paths = client.app.openapi()["paths"]

    # Sanity-check the introspection itself, so a future framework change breaks this test
    # loudly instead of silently making the assertion below vacuous.
    assert len(paths) > 50

    unresolved = [tool.name for tool in COPILOT_TOOLS if "get" not in (paths.get(tool.path_template) or {})]
    assert unresolved == []


def test_identified_tool_schemas_declare_path_params_as_required_integers() -> None:
    """The proxy path never de-identified anything, so real integer ids are correct there."""
    for tool in COPILOT_TOOLS:
        schema = tool.json_schema(deidentified=False)
        assert schema["additionalProperties"] is False, tool.name
        for name in tool.path_params:
            assert schema["properties"][name]["type"] == "integer", tool.name
            assert name in schema["required"], tool.name


def test_deidentified_tool_schemas_declare_patient_id_as_a_handle_string() -> None:
    """On the agent path the model has only ever seen `P#1`, so the schema must ask for that.

    The failure this pins is not a broken call: a structured-output model told to produce a
    required *integer* will invent one, and an invented id that happens to name another
    patient assigned to this nurse returns a coherent per-patient narrative under the wrong
    name — a wrong-patient clinical display produced by the safety mechanism itself.
    """
    handle_params = 0
    for tool in COPILOT_TOOLS:
        schema = tool.json_schema(deidentified=True)
        assert schema["additionalProperties"] is False, tool.name
        for name in tool.path_params:
            assert name in schema["required"], tool.name
            prop = schema["properties"][name]
            assert prop["type"] == "string", tool.name
            assert prop["pattern"] == "^P#[0-9]+$", tool.name
            assert "P#1" in prop["description"], tool.name
            handle_params += 1
    # Guards against the assertions above passing vacuously if `path_params` ever empties.
    assert handle_params > 0


def test_tool_declares_every_query_param_the_route_requires(tmp_path: Path) -> None:
    """A tool whose route has a required query parameter it never declares will 422 on
    every call, because ``build_query`` only sends arguments the model actually supplied.

    ``test_every_allowlisted_tool_points_at_a_registered_get_route`` only proves the path
    template resolves to a registered GET route — exactly why ``get_workbench_dashboard``
    (missing ``local_date``/``week_start``) passed that test while 422ing at runtime. This
    test instead cross-checks each tool's declared query schema against the route's actual
    required query parameters, taken from the OpenAPI schema FastAPI derives from the real
    route signature.
    """
    with build_client(tmp_path, "tool-query-params") as client:
        paths = client.app.openapi()["paths"]

    for tool in COPILOT_TOOLS:
        route_params = paths[tool.path_template]["get"].get("parameters", [])
        required_query_names = {
            param["name"] for param in route_params if param.get("in") == "query" and param.get("required")
        }
        declared_query_names = set(tool.query_params)
        missing = required_query_names - declared_query_names
        assert not missing, f"{tool.name} doesn't declare query params {missing} that its route requires"
        not_marked_required = required_query_names - set(tool.required)
        assert not not_marked_required, (
            f"{tool.name} declares {not_marked_required} but doesn't mark them required, "
            "so a model call omitting them would still be accepted by the schema and then 422 at the route"
        )


# --------------------------------------------------------------------------------------
# Agent loop
# --------------------------------------------------------------------------------------


def test_agent_turn_dispatches_tool_and_persists_transcript(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    copilot_proxy_rate_limiter.reset()
    fake = install_fake_openai(
        monkeypatch,
        [
            [completed(calls=[_FakeFunctionCall("get_cohort_suspected_summary", {"months": 3})])],
            text_turn("近三個月共有 1 筆疑似感染上傳。"),
        ],
    )
    with build_client(tmp_path, "agent-turn") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        seed_patient(client, case_number="P900003", suspected=True)
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]

        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "請分析近三個月所有病患的感染趨勢"},
            headers=headers,
        )
        assert response.status_code == 200
        events = read_sse(response)
        kinds = [kind for kind, _ in events]
        assert "tool_call" in kinds
        assert "tool_result" in kinds
        assert kinds[-1] == "done"

        tool_result = next(data for kind, data in events if kind == "tool_result")
        assert tool_result["tool"] == "get_cohort_suspected_summary"
        assert tool_result["ok"] is True

        saved = next(data for kind, data in events if kind == "message_saved")
        assert "近三個月" in saved["content"]
        assert saved["tool_trace"][0]["tool"] == "get_cohort_suspected_summary"

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=headers).json()
        assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
        assert detail["messages"][1]["tool_trace"][0]["ok"] is True
        # Title is derived from the first user message.
        assert detail["session"]["title"].startswith("請分析近三個月")

        # The model was handed only the allowlisted tools.
        offered = {tool["name"] for tool in fake.responses.calls[0]["tools"]}
        assert "get_cohort_suspected_summary" in offered
        assert all(not name.startswith("delete") for name in offered)


def test_system_prompt_leaks_no_user_name_to_the_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The signed-in nurse's own `real_name` must not ride along on every turn.

    It is on `FORBIDDEN_FIELDS`, so no tool result could ever carry it — but the system
    prompt used to interpolate it as `目前使用者：{who}`, which no tool-result filter can
    reach. The role alone is all the prompt needs.
    """
    fake = install_fake_openai(monkeypatch, [text_turn("好。")])
    with build_client(tmp_path, "prompt-no-name") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff", name="林美玲")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages", json={"content": "你好"}, headers=headers
        )
        assert response.status_code == 200, response.text

    assert len(fake.responses.calls) == 1
    whole_request = json.dumps(fake.responses.calls[0], ensure_ascii=False, default=str)
    assert "林美玲" not in whole_request
    # The role still reaches the model, so the prompt is not merely blank where the name was.
    assert "護理師" in fake.responses.calls[0]["instructions"]


def test_agent_turn_keeps_narration_emitted_before_a_tool_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pre-tool narration is streamed to the user, so the saved message must keep it."""
    install_fake_openai(
        monkeypatch,
        [
            [
                _FakeEvent("response.output_text.delta", delta="讓我查一下。"),
                completed(calls=[_FakeFunctionCall("get_cohort_gender_distribution", {})]),
            ],
            text_turn("查詢完成。"),
        ],
    )
    with build_client(tmp_path, "agent-narration") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]

        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages", json={"content": "性別分佈？"}, headers=headers
        )
        events = read_sse(response)
        streamed = "".join(data["text"] for kind, data in events if kind == "token")
        saved = next(data for kind, data in events if kind == "message_saved")

        assert streamed == "讓我查一下。查詢完成。"
        assert saved["content"] == streamed

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=headers).json()
        assert detail["messages"][1]["content"] == streamed


def test_agent_turn_surfaces_permission_denial_to_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A handle that resolves but hits assignment scoping comes back as data, not a crash.

    The handle is minted first (as a listing tool would), then spent against a patient this
    nurse is not assigned to — e.g. an assignment revoked mid-conversation, or a shared
    transcript. The route's own `403` is what must reach the model.
    """
    with build_client(tmp_path, "agent-denied") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        unassigned_patient_id = seed_patient(client, case_number="P900405")
        handle = mint_patient_handle(
            client, copilot_session_id=session_id, patient_id=unassigned_patient_id
        )
        install_fake_openai(
            monkeypatch,
            [
                [completed(calls=[_FakeFunctionCall("list_patient_uploads", {"patient_id": handle})])],
                text_turn("這位病患未分配給你，我無法查看。"),
            ],
        )

        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "給我看這位病患的歷程"},
            headers=headers,
        )
        events = read_sse(response)
        tool_result = next(data for kind, data in events if kind == "tool_result")
        assert tool_result["ok"] is False
        assert tool_result["status"] == 403
        # A denial is a normal outcome, not a stream failure.
        assert not any(kind == "error" for kind, _ in events)


def test_agent_turn_rejects_invalid_tool_arguments(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    install_fake_openai(
        monkeypatch,
        [
            [completed(calls=[_FakeFunctionCall("list_patient_uploads", {"patient_id": "not-an-int"})])],
            text_turn("參數有誤。"),
        ],
    )
    with build_client(tmp_path, "agent-bad-args") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "查一下"},
            headers=headers,
        )
        events = read_sse(response)
        tool_result = next(data for kind, data in events if kind == "tool_result")
        assert tool_result["ok"] is False
        assert tool_result["status"] is None
        # A rejected call must still emit exactly one tool_call/tool_result pair.
        assert sum(1 for kind, _ in events if kind == "tool_call") == 1
        assert sum(1 for kind, _ in events if kind == "tool_result") == 1


def test_agent_turn_stops_at_tool_iteration_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    install_fake_openai(
        monkeypatch,
        [[completed(calls=[_FakeFunctionCall("get_cohort_gender_distribution", {})])]],
    )
    with build_client(tmp_path, "agent-loop-cap", copilot_max_tool_iterations=2) as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages", json={"content": "無限迴圈"}, headers=headers
        )
        events = read_sse(response)
        assert sum(1 for kind, _ in events if kind == "tool_call") == 2
        assert any(kind == "error" for kind, _ in events)
        assert events[-1][0] == "done"


# --------------------------------------------------------------------------------------
# De-identification boundary: no patient identifier reaches the model
# --------------------------------------------------------------------------------------

# Three different kinds of direct patient identifier, seeded onto one patient below:
# a free-text full name, a case number, and the patient's own LINE user id. None of these
# may ever appear in a tool result handed to the model.
PII = ("王小明", "P123456", "U_PATIENT_A")

PATIENT_LEVEL = [t.name for t in COPILOT_TOOLS if not t.name.startswith("get_cohort_")]


def _seed_leak_fixture(client: TestClient) -> tuple[int, int, str, dict[str, str]]:
    """Seed a staff identity plus a patient carrying every needle in `PII`, assigned to that staff.

    Returns (staff_identity_id, patient_id, local_date, auth_headers). `local_date` is the
    Taipei calendar date the seeded upload falls on, for tools that require it.
    """
    staff_id = seed_identity(client, line_user_id="U_STAFF_LEAK", role="staff", name="護理師")
    now = datetime.now(timezone.utc)
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="P123456", birth_date="1980-01-02", full_name="王小明")
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id="U_PATIENT_A",
                display_name="王小明",
                real_name="王小明",
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        upload = Upload(
            patient_id=patient.id,
            object_key="uploads/P123456.jpg",
            content_type="image/jpeg",
            created_at=now,
        )
        session.add(upload)
        session.flush()
        session.add(
            AIResult(
                upload_id=upload.id,
                predicted_class="class_4",
                probability=0.91,
                threshold=0.5,
                screening_result="suspected",
                model_version="test-v1",
            )
        )
        session.add(
            Annotation(
                patient_id=patient.id,
                upload_id=upload.id,
                reviewer_identity_id=staff_id,
                label="suspected",
                # Free text can smuggle a name past the field allowlist if the allowlist
                # ever let `comment` through; this pins that it never does.
                comment="王小明 自述有異常",
            )
        )
        session.commit()
        patient_id = patient.id
    assign(client, staff_identity_id=staff_id, patient_id=patient_id)
    local_date = to_taipei_date(now).isoformat()
    headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF_LEAK")
    return staff_id, patient_id, local_date, headers


PATIENT_PATH_TOOLS = {
    "get_patient_detail",
    "list_patient_uploads",
    "get_patient_upload_calendar",
    "list_patient_annotations",
}


def _extra_arguments(tool_name: str, *, patient_ref: int | str, local_date: str) -> dict[str, Any]:
    """Every argument a tool needs to actually reach its route with the leak fixture's data.

    `patient_ref` is the real id on the identified path and the `P#n` handle on the
    de-identified one, because that is the only form the boundary accepts inbound.
    `get_workbench_dashboard` needs *both* `local_date` and `week_start`: its route
    requires them, and omitting them 422'd the call, which made the leak sweep pass
    without any patient payload ever being filtered.
    """
    if tool_name in PATIENT_PATH_TOOLS:
        return {"patient_id": patient_ref}
    if tool_name == "get_history_overview":
        return {"local_date": local_date}
    if tool_name == "get_workbench_dashboard":
        return {"local_date": local_date, "week_start": local_date}
    return {}


def mint_patient_handle(client: TestClient, *, copilot_session_id: int, patient_id: int) -> str:
    """Issue the outbound handle for `patient_id`, the way a real tool result would.

    Inbound resolution only accepts handles this conversation has already issued, so a test
    that wants to *spend* one has to issue it first — the same order the agent loop goes in
    (a listing tool mints `P#1`, then a per-patient tool spends it).
    """
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        minted = deidentify_payload(
            session, copilot_session_id=copilot_session_id, payload={"patient_id": patient_id}
        )
        session.commit()
    return minted["patient_id"]


def dispatch_for_test(tmp_path: Path, tool_name: str, *, deidentify_for_session_id: int | None):
    """Seed the PII fixture, then run exactly one `dispatch_tool_call` for `tool_name`.

    Mirrors how `run_agent_turn` calls `dispatch_tool_call` for the agent path, but without
    the OpenAI round-trip, so every allowlisted tool can be swept cheaply.
    """
    import asyncio

    async def _run():
        with build_client(tmp_path, f"leak-{tool_name}") as client:
            _staff_id, patient_id, local_date, headers = _seed_leak_fixture(client)
            tool = resolve_tool(tool_name, role="staff")
            patient_ref: int | str = patient_id
            if deidentify_for_session_id is not None and tool_name in PATIENT_PATH_TOOLS:
                patient_ref = mint_patient_handle(
                    client, copilot_session_id=deidentify_for_session_id, patient_id=patient_id
                )
            arguments = _extra_arguments(tool_name, patient_ref=patient_ref, local_date=local_date)
            return await dispatch_tool_call(
                app=client.app,
                tool=tool,
                arguments=arguments,
                authorization=headers["Authorization"],
                max_bytes=10_000_000,
                deidentify_for_session_id=deidentify_for_session_id,
            )

    return asyncio.run(_run())


def post_proxy(tmp_path: Path, tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Seed the PII fixture, then hit `/v1/copilot/proxy` with a real staff token."""
    copilot_proxy_rate_limiter.reset()
    with build_client(tmp_path, f"proxy-leak-{tool_name}") as client:
        _staff_id, _patient_id, _local_date, headers = _seed_leak_fixture(client)
        response = client.post(
            "/v1/copilot/proxy",
            json={"tool": tool_name, "params": params},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        return response.json()


def run_one_turn(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tool_name: str,
    arguments_factory=None,
) -> FakeOpenAI:
    """Seed the PII fixture, then run one real agent turn that calls `tool_name`.

    The session's handle for the seeded patient is minted up front (as a listing tool would
    have done on an earlier turn) and handed to `arguments_factory`, because a handle is the
    only form the inbound boundary accepts for `patient_id`.

    Returns the `FakeOpenAI` stub so the caller can inspect exactly what was sent back to
    the (fake) model on the follow-up request — the thing this whole boundary exists to keep
    identifier-free.
    """
    if arguments_factory is None:
        arguments_factory = lambda _handle: {}  # noqa: E731

    with build_client(tmp_path, f"agent-leak-{tool_name}") as client:
        _staff_id, patient_id, _local_date, headers = _seed_leak_fixture(client)
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        handle = mint_patient_handle(client, copilot_session_id=session_id, patient_id=patient_id)
        arguments = arguments_factory(handle)
        fake = install_fake_openai(
            monkeypatch,
            [
                [completed(calls=[_FakeFunctionCall(tool_name, arguments)])],
                text_turn("完成。"),
            ],
        )
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "請分析這位病患"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
    return fake


@pytest.mark.parametrize("tool_name", PATIENT_LEVEL)
def test_no_patient_level_tool_leaks_identifiers_to_the_model(tmp_path: Path, tool_name: str) -> None:
    result = dispatch_for_test(tmp_path, tool_name, deidentify_for_session_id=1)
    # `ok` is asserted, not waived: the fixture supplies every argument each of these tools
    # needs, so a rejected call here means the sweep filtered nothing and the needle
    # assertions below would pass vacuously. That is exactly how `get_workbench_dashboard`
    # hid behind a 422 for the whole of this branch. The deliberate error path has its own
    # test (`test_rejected_tool_call_leaks_no_detail_but_keeps_error_and_status`).
    assert result.ok is True, f"{tool_name} never returned data: {result.content}"
    for needle in PII:
        assert needle not in result.content, f"{tool_name} leaked {needle}"


def test_rejected_tool_call_leaks_no_detail_but_keeps_error_and_status(tmp_path: Path) -> None:
    """A de-identified rejection must still say it's an error, without leaking its detail text.

    `error` + `status` is enough for the model to know it hit a permission boundary (the
    system prompt tells it what a 403/404 means); `detail` carries unbounded
    `str(exc)`/response-body text that could echo an identifier straight back, so it must
    never survive the filter.
    """
    import asyncio

    async def _run() -> Any:
        with build_client(tmp_path, "leak-rejected") as client:
            _staff_id, _patient_id, _local_date, headers = _seed_leak_fixture(client)
            tool = resolve_tool("get_patient_detail", role="staff")
            # A handle for a patient this nurse was never assigned to: the handle resolves
            # (it was minted in this conversation), and the route is what rejects the call.
            # An *unresolvable* handle would be rejected before dispatch and so would never
            # exercise the de-identified error payload this test is about.
            unassigned_patient_id = seed_patient(client, case_number="P900404")
            handle = mint_patient_handle(
                client, copilot_session_id=1, patient_id=unassigned_patient_id
            )
            return await dispatch_tool_call(
                app=client.app,
                tool=tool,
                arguments={"patient_id": handle},
                authorization=headers["Authorization"],
                max_bytes=10_000_000,
                deidentify_for_session_id=1,
            )

    result = asyncio.run(_run())
    assert result.ok is False, result.content
    body = json.loads(result.content)
    assert body.get("error") is True
    assert body.get("status") == result.status_code
    assert "detail" not in body, body


def test_proxy_still_returns_identified_data(tmp_path: Path) -> None:
    """The proxy route must NOT de-identify: generated reports render to the signed-in nurse."""
    body = post_proxy(tmp_path, "list_patients", {})
    assert "P123456" in json.dumps(body, ensure_ascii=False)


def test_agent_turn_sends_no_identifiers_to_the_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake = run_one_turn(
        tmp_path,
        monkeypatch,
        "list_patient_uploads",
        arguments_factory=lambda handle: {"patient_id": handle},
    )
    assert len(fake.responses.calls) == 2
    sent = json.dumps(fake.responses.calls[1]["input"], ensure_ascii=False, default=str)
    for needle in PII:
        assert needle not in sent, f"leaked {needle}"


# --------------------------------------------------------------------------------------
# Inbound direction: the model can spend the handles it was given, and only those
# --------------------------------------------------------------------------------------


def test_agent_turn_resolves_a_handle_from_an_earlier_tool_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The round trip: `list_patients` mints `P#1`, then the model spends `P#1`.

    This is the loop the branch shipped without. Outbound de-identification alone leaves the
    model holding a token it cannot use, and a schema demanding an integer then pushes it to
    invent one.
    """
    with build_client(tmp_path, "agent-handle-roundtrip") as client:
        _staff_id, _patient_id, _local_date, headers = _seed_leak_fixture(client)
        install_fake_openai(
            monkeypatch,
            [
                [completed(calls=[_FakeFunctionCall("list_patients", {}, call_id="call_list")])],
                # The model has seen nothing but "P#1" at this point, and passes it straight back.
                [
                    completed(
                        calls=[
                            _FakeFunctionCall(
                                "list_patient_uploads", {"patient_id": "P#1"}, call_id="call_uploads"
                            )
                        ]
                    )
                ],
                text_turn("這位病患近期有一筆疑似感染。"),
            ],
        )
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "請分析這位病患的上傳歷程"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        events = read_sse(response)

    results = [data for kind, data in events if kind == "tool_result"]
    assert [item["tool"] for item in results] == ["list_patients", "list_patient_uploads"]
    # The second call is the assertion that matters: ok means the handle resolved to the
    # real row id and the route returned that patient's uploads.
    assert all(item["ok"] is True for item in results), results
    assert all(item["status"] == 200 for item in results), results

    trace = next(data for kind, data in events if kind == "message_saved")["tool_trace"]
    # The persisted trace keeps the handle, not the real id it resolved to.
    assert trace[1]["params"] == {"patient_id": "P#1"}


def test_agent_turn_rejects_an_unknown_handle_instead_of_guessing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A handle this conversation never minted is a rejection, never a nearby patient."""
    fake = run_one_turn(
        tmp_path,
        monkeypatch,
        "list_patient_uploads",
        arguments_factory=lambda _handle: {"patient_id": "P#97"},
    )
    assert len(fake.responses.calls) == 2
    sent = json.dumps(fake.responses.calls[1]["input"], ensure_ascii=False, default=str)
    assert "P#97" in sent
    assert "not known in this conversation" in sent
    # Nothing was fetched, so no patient data (identified or not) came back.
    assert "screening_result" not in sent
    for needle in PII:
        assert needle not in sent, f"leaked {needle}"


def test_agent_turn_rejects_an_integer_where_a_handle_is_required(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An invented integer must not be coerced, even when it names a real assigned patient.

    The fixture's patient is the only one seeded, so its real id is a number a model under
    schema pressure would plausibly produce. Accepting it is the wrong-patient display this
    fix exists to prevent, so the dispatch rejects every non-handle on this path.
    """
    with build_client(tmp_path, "agent-handle-integer") as client:
        _staff_id, patient_id, _local_date, headers = _seed_leak_fixture(client)
        install_fake_openai(
            monkeypatch,
            [
                [completed(calls=[_FakeFunctionCall("list_patient_uploads", {"patient_id": patient_id})])],
                text_turn("參數有誤。"),
            ],
        )
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": f"查病患 {patient_id}"},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        events = read_sse(response)

    tool_result = next(data for kind, data in events if kind == "tool_result")
    assert tool_result["ok"] is False
    # Rejected before dispatch: no HTTP status at all, so the route was never reached.
    assert tool_result["status"] is None


# --------------------------------------------------------------------------------------
# Per-viewer re-identification: handle -> label resolution
# --------------------------------------------------------------------------------------


def test_owner_sees_labels_for_assigned_patients(tmp_path: Path) -> None:
    with build_client(tmp_path, "handle-labels-owner") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        patient_id = seed_patient(client, case_number="P123456")
        assign(client, staff_identity_id=staff_id, patient_id=patient_id)
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")

        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]

        session_factory = client.app.state.db_session_factory
        with session_factory() as db_session:
            deidentify_payload(db_session, copilot_session_id=session_id, payload={"patient_id": patient_id})
            db_session.commit()

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["handles"] == {
            "P#1": {"entity_type": "patient", "label": "病患 P123456 (P123456)"}
        }


def test_unassigned_viewer_gets_no_label(tmp_path: Path) -> None:
    with build_client(tmp_path, "handle-labels-denied") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff")
        viewer_id = seed_identity(client, line_user_id="U_VIEWER", role="staff")
        patient_id = seed_patient(client, case_number="P900010")
        assign(client, staff_identity_id=owner_id, patient_id=patient_id)
        owner_headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")
        viewer_headers = headers_for(client, viewer_id, role="staff", line_user_id="U_VIEWER")

        session_id = client.post(
            "/v1/copilot/sessions", json={"visibility": "staff"}, headers=owner_headers
        ).json()["session_id"]

        session_factory = client.app.state.db_session_factory
        with session_factory() as db_session:
            deidentify_payload(db_session, copilot_session_id=session_id, payload={"patient_id": patient_id})
            db_session.commit()

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=viewer_headers)
        assert detail.status_code == 200
        # Denied: the handle still appears, but with no label -- never an error, never omitted.
        assert detail.json()["handles"] == {"P#1": {"entity_type": "patient", "label": None}}


def test_admin_sees_patient_label_without_assignment(tmp_path: Path) -> None:
    with build_client(tmp_path, "handle-label-admin") as client:
        admin_id = seed_identity(client, line_user_id="U_ADMIN", role="admin")
        patient_id = seed_patient(client, case_number="P800001")
        headers = headers_for(client, admin_id, role="admin", line_user_id="U_ADMIN")

        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        session_factory = client.app.state.db_session_factory
        with session_factory() as db_session:
            deidentify_payload(db_session, copilot_session_id=session_id, payload={"patient_id": patient_id})
            db_session.commit()

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=headers)
        assert detail.json()["handles"] == {
            "P#1": {"entity_type": "patient", "label": "病患 P800001 (P800001)"}
        }


def test_handle_label_falls_back_to_case_number_without_full_name(tmp_path: Path) -> None:
    with build_client(tmp_path, "handle-label-fallback") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")

        session_factory = client.app.state.db_session_factory
        with session_factory() as db_session:
            patient = Patient(case_number="P700001", birth_date="1980-01-02", full_name=None)
            db_session.add(patient)
            db_session.commit()
            patient_id = patient.id
        assign(client, staff_identity_id=staff_id, patient_id=patient_id)

        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        with session_factory() as db_session:
            deidentify_payload(db_session, copilot_session_id=session_id, payload={"patient_id": patient_id})
            db_session.commit()

        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=headers)
        assert detail.json()["handles"] == {"P#1": {"entity_type": "patient", "label": "P700001"}}


def test_reviewer_handle_label_uses_identity_real_name(tmp_path: Path) -> None:
    with build_client(tmp_path, "handle-label-reviewer") as client:
        owner_id = seed_identity(client, line_user_id="U_OWNER", role="staff", name="王護理師")
        viewer_id = seed_identity(client, line_user_id="U_VIEWER", role="staff")
        owner_headers = headers_for(client, owner_id, role="staff", line_user_id="U_OWNER")
        viewer_headers = headers_for(client, viewer_id, role="staff", line_user_id="U_VIEWER")

        session_id = client.post(
            "/v1/copilot/sessions", json={"visibility": "staff"}, headers=owner_headers
        ).json()["session_id"]

        session_factory = client.app.state.db_session_factory
        with session_factory() as db_session:
            deidentify_payload(db_session, copilot_session_id=session_id, payload={"reviewer_identity_id": owner_id})
            db_session.commit()

        # Reviewer labels are staff names, not patient data: no per-patient assignment
        # gates them, only the (already-enforced) staff-or-admin role on this route.
        detail = client.get(f"/v1/copilot/sessions/{session_id}", headers=viewer_headers)
        assert detail.json()["handles"] == {"R#1": {"entity_type": "identity", "label": "王護理師"}}


def test_sse_emits_handle_label_event_on_first_mint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with build_client(tmp_path, "handle-label-sse") as client:
        # `list_patients` (unlike `list_patient_uploads`) echoes `patient_id` on each row,
        # since the row itself identifies which patient it is -- that is what gives
        # `deidentify_payload` something to mint a handle from on this call.
        _staff_id, _patient_id, _local_date, headers = _seed_leak_fixture(client)
        install_fake_openai(
            monkeypatch,
            [
                [completed(calls=[_FakeFunctionCall("list_patients", {})])],
                text_turn("完成。"),
            ],
        )
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]
        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "請分析這位病患"},
            headers=headers,
        )
        assert response.status_code == 200
        events = read_sse(response)
        handle_events = [data for kind, data in events if kind == "handle"]
        # `_seed_leak_fixture` seeds the patient's full_name as "王小明" and case_number
        # as "P123456", and the staff viewer is assigned to this patient.
        assert handle_events == [{"handle": "P#1", "entity_type": "patient", "label": "王小明 (P123456)"}]
