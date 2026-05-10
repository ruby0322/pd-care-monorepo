from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Patient, PendingBinding, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-staff-dashboard-api",
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
        auth_token_secret="test-auth-secret",
        auth_token_ttl_seconds=3600,
        line_verify_mode="stub",
    )


def _seed_staff(client: TestClient, *, line_user_id: str = "U_STAFF", role: str = "staff") -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Staff",
                picture_url=None,
                patient_id=None,
                role=role,
            )
        )
        session.commit()


def _seed_patient_with_uploads(client: TestClient) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="P123456", birth_date="1980-01-02", full_name="Patient A", is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id="U_PATIENT_A",
                display_name="Patient A",
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )

        upload1 = Upload(
            patient_id=patient.id,
            object_key="patients/1/uploads/1.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 10, 0, 0, tzinfo=timezone.utc),
        )
        upload2 = Upload(
            patient_id=patient.id,
            object_key="patients/1/uploads/2.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 9, 0, 0, tzinfo=timezone.utc),
        )
        session.add_all([upload1, upload2])
        session.flush()
        session.add_all(
            [
                AIResult(upload_id=upload1.id, screening_result="suspected", probability=0.9, threshold=0.5),
                AIResult(upload_id=upload2.id, screening_result="normal", probability=0.1, threshold=0.5),
            ]
        )
        session.commit()
        return patient.id


def _seed_pending_binding(client: TestClient) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        pending = PendingBinding(
            line_user_id="U_PENDING_1",
            case_number="P123456",
            birth_date="1980-01-02",
            status="pending",
        )
        session.add(pending)
        session.commit()
        session.refresh(pending)
        return pending.id


def _login_staff_token(client: TestClient, line_user_id: str = "U_STAFF") -> str:
    response = client.post("/v1/auth/login", json={"line_id_token": f"stub:{line_user_id}"})
    assert response.status_code == 200
    return response.json()["access_token"]


def _issue_patient_token(client: TestClient) -> str:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient_identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == "U_PATIENT_A").one()
    token_service = AuthTokenService(secret=client.app.state.settings.auth_token_secret)
    return token_service.issue_token(
        identity_id=patient_identity.id,
        line_user_id=patient_identity.line_user_id,
        role="patient",
        patient_id=patient_identity.patient_id,
        ttl_seconds=client.app.state.settings.auth_token_ttl_seconds,
    )


def test_staff_patient_list_and_queue_are_accessible(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-list.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        _seed_patient_with_uploads(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        list_response = client.get("/v1/staff/patients", headers=headers)
        assert list_response.status_code == 200
        assert list_response.json()["total_patients"] == 1
        assert list_response.json()["items"][0]["suspected_count"] == 1

        queue_response = client.get("/v1/staff/uploads/queue", headers=headers)
        assert queue_response.status_code == 200
        assert len(queue_response.json()["items"]) >= 1


def test_patient_token_is_denied_for_staff_dashboard_endpoints(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-denied.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        _seed_patient_with_uploads(client)
        token = _issue_patient_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/patients", headers=headers)
        assert response.status_code == 403


def test_staff_can_upsert_annotation(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-annotation.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        detail = client.get(f"/v1/staff/patients/{patient_id}", headers=headers)
        upload_id = detail.json()["uploads"][0]["upload_id"]

        create_response = client.post(
            f"/v1/staff/uploads/{upload_id}/annotation",
            headers=headers,
            json={"label": "suspected", "comment": "Needs closer review"},
        )
        assert create_response.status_code == 200

        list_response = client.get(f"/v1/staff/patients/{patient_id}/annotations", headers=headers)
        assert list_response.status_code == 200
        assert list_response.json()["items"][0]["upload_id"] == upload_id


def test_staff_can_link_and_reject_pending_bindings(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        pending_id = _seed_pending_binding(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        pending_list = client.get("/v1/staff/pending-bindings", headers=headers)
        assert pending_list.status_code == 200
        assert pending_list.json()["items"][0]["id"] == pending_id

        link_response = client.post(
            f"/v1/staff/pending-bindings/{pending_id}/link",
            headers=headers,
            json={"patient_id": patient_id},
        )
        assert link_response.status_code == 200
        assert link_response.json()["status"] == "approved"

        pending_id_2 = _seed_pending_binding(client)
        reject_response = client.post(f"/v1/staff/pending-bindings/{pending_id_2}/reject", headers=headers)
        assert reject_response.status_code == 200
        assert reject_response.json()["status"] == "rejected"
