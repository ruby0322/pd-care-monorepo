from __future__ import annotations
# pyright: reportMissingImports=false

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import PendingBinding, Patient
from app.main import create_app


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-identity-api",
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
        database_url=f"sqlite+pysqlite:///{db_path}",
        s3_endpoint_url="http://localhost:8333",
        s3_region="us-east-1",
        s3_access_key="seaweed-access",
        s3_secret_key="seaweed-secret",
        s3_bucket_name="pd-care-private",
        image_access_token_secret="test-secret",
        image_access_token_ttl_seconds=300,
        line_verify_mode="stub",
    )


def seed_patient(client: TestClient, case_number: str, birth_date: str) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number=case_number, birth_date=birth_date, full_name="王小明", is_active=True)
        session.add(patient)
        session.commit()
        session.refresh(patient)
        return patient.id


def test_bind_identity_matches_existing_patient(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "matched.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = seed_patient(client, case_number="P123456", birth_date="1980-01-02")
        response = client.post(
            "/v1/identity/bind",
            json={
                "line_id_token": "stub:U_LINE_001",
                "case_number": "P123456",
                "birth_date": "1980-01-02",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["patient_id"] == patient_id
        assert payload["can_upload"] is True


def test_bind_identity_creates_pending_request_when_no_match(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        response = client.post(
            "/v1/identity/bind",
            json={
                "line_id_token": "stub:U_LINE_002",
                "case_number": "P999999",
                "birth_date": "1970-05-08",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "pending"
        assert payload["patient_id"] is None
        assert payload["can_upload"] is False

        status_response = client.post(
            "/v1/identity/bind/status",
            json={"line_id_token": "stub:U_LINE_002"},
        )
        assert status_response.status_code == 200
        status_payload = status_response.json()
        assert status_payload["status"] == "pending"
        assert status_payload["can_upload"] is False


def test_already_bound_user_stays_matched_on_later_bind_attempt(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "already-bound.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = seed_patient(client, case_number="P123456", birth_date="1980-01-02")
        first = client.post(
            "/v1/identity/bind",
            json={
                "line_id_token": "stub:U_LINE_003",
                "case_number": "P123456",
                "birth_date": "1980-01-02",
            },
        )
        assert first.status_code == 200
        assert first.json()["status"] == "matched"
        assert first.json()["patient_id"] == patient_id

        second = client.post(
            "/v1/identity/bind",
            json={
                "line_id_token": "stub:U_LINE_003",
                "case_number": "P-NON-EXIST",
                "birth_date": "1999-09-09",
            },
        )
        assert second.status_code == 200
        assert second.json()["status"] == "matched"
        assert second.json()["patient_id"] == patient_id
        assert second.json()["can_upload"] is True

        status_response = client.post(
            "/v1/identity/bind/status",
            json={"line_id_token": "stub:U_LINE_003"},
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "matched"
        assert status_response.json()["patient_id"] == patient_id


def test_pending_binding_is_resolved_after_successful_match(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "pending-resolved.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        pending = client.post(
            "/v1/identity/bind",
            json={
                "line_id_token": "stub:U_LINE_004",
                "case_number": "P-NOT-YET",
                "birth_date": "1977-07-07",
            },
        )
        assert pending.status_code == 200
        assert pending.json()["status"] == "pending"

        patient_id = seed_patient(client, case_number="P777777", birth_date="1977-07-07")
        matched = client.post(
            "/v1/identity/bind",
            json={
                "line_id_token": "stub:U_LINE_004",
                "case_number": "P777777",
                "birth_date": "1977-07-07",
            },
        )
        assert matched.status_code == 200
        assert matched.json()["status"] == "matched"
        assert matched.json()["patient_id"] == patient_id

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            pending_rows = session.query(PendingBinding).filter(PendingBinding.line_user_id == "U_LINE_004").all()
            assert pending_rows
            assert all(row.status == "approved" for row in pending_rows)

        status_response = client.post(
            "/v1/identity/bind/status",
            json={"line_id_token": "stub:U_LINE_004"},
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "matched"


def test_bind_status_rejects_invalid_line_token(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "invalid-token.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        response = client.post("/v1/identity/bind/status", json={"line_id_token": "not-a-stub-token"})
        assert response.status_code == 400
