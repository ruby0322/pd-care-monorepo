from __future__ import annotations
# pyright: reportMissingImports=false

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Patient, StaffPatientAssignment, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService
from app.api.routes import copilot as copilot_routes
from app.services.copilot.sessions import copilot_proxy_rate_limiter
from app.services.copilot.tools import COPILOT_TOOLS, CopilotToolError, resolve_tool
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
        return {"type": "function_call", "name": self.name, "arguments": self.arguments, "call_id": self.call_id}


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


def test_tool_schemas_declare_path_params_as_required_integers() -> None:
    for tool in COPILOT_TOOLS:
        schema = tool.json_schema()
        assert schema["additionalProperties"] is False, tool.name
        for name in tool.path_params:
            assert schema["properties"][name]["type"] == "integer", tool.name
            assert name in schema["required"], tool.name


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
    install_fake_openai(
        monkeypatch,
        [
            [completed(calls=[_FakeFunctionCall("list_patient_uploads", {"patient_id": 999999})])],
            text_turn("這位病患未分配給你，我無法查看。"),
        ],
    )
    with build_client(tmp_path, "agent-denied") as client:
        staff_id = seed_identity(client, line_user_id="U_STAFF", role="staff")
        headers = headers_for(client, staff_id, role="staff", line_user_id="U_STAFF")
        session_id = client.post("/v1/copilot/sessions", json={}, headers=headers).json()["session_id"]

        response = client.post(
            f"/v1/copilot/sessions/{session_id}/messages",
            json={"content": "給我看病患 999999 的歷程"},
            headers=headers,
        )
        events = read_sse(response)
        tool_result = next(data for kind, data in events if kind == "tool_result")
        assert tool_result["ok"] is False
        assert tool_result["status"] == 404
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
