from __future__ import annotations
# pyright: reportMissingImports=false

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import LiffIdentity, Patient
from app.main import create_app
from app.services.auth.token_service import AuthTokenService


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-auth-staff-admin-api",
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


def _seed_identity(
    client: TestClient,
    *,
    line_user_id: str,
    role: str,
    patient_id: int | None = None,
) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name=line_user_id,
            picture_url=None,
            patient_id=patient_id,
            role=role,
        )
        session.add(identity)
        session.commit()
        session.refresh(identity)
        return identity.id


def _seed_patient(client: TestClient, *, line_user_id: str) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(
            case_number=f"CASE-{line_user_id}",
            birth_date="1980-01-02",
            full_name=f"Patient {line_user_id}",
            is_active=True,
        )
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name=line_user_id,
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        session.commit()


def _login_and_get_token(client: TestClient, line_user_id: str) -> str:
    response = client.post("/v1/auth/login", json={"line_id_token": f"stub:{line_user_id}"})
    assert response.status_code == 200
    return response.json()["access_token"]


def _issue_token_for_identity(
    client: TestClient,
    *,
    identity_id: int,
    line_user_id: str,
    role: str,
    patient_id: int | None = None,
) -> str:
    settings = client.app.state.settings
    token_service = AuthTokenService(secret=settings.auth_token_secret)
    return token_service.issue_token(
        identity_id=identity_id,
        line_user_id=line_user_id,
        role=role,
        patient_id=patient_id,
        ttl_seconds=settings.auth_token_ttl_seconds,
    )


def test_staff_me_requires_authentication(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "auth-required.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        response = client.get("/v1/staff/me")
        assert response.status_code == 401


def test_patient_token_is_denied_for_staff_endpoint(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-denied.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        identity_id = _seed_identity(client, line_user_id="U_PATIENT", role="patient")
        token = _issue_token_for_identity(client, identity_id=identity_id, line_user_id="U_PATIENT", role="patient")

        response = client.get("/v1/staff/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403


def test_staff_token_can_access_staff_endpoint(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-allowed.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_STAFF", role="staff")
        token = _login_and_get_token(client, "U_STAFF")

        response = client.get("/v1/staff/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["role"] == "staff"


def test_staff_token_is_denied_for_admin_probe(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-admin-denied.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_STAFF_ONLY", role="staff")
        token = _login_and_get_token(client, "U_STAFF_ONLY")

        response = client.get("/v1/staff/admin/probe", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403


def test_admin_token_can_access_admin_probe(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-allowed.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN", role="admin")
        token = _login_and_get_token(client, "U_ADMIN")

        response = client.get("/v1/staff/admin/probe", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["role"] == "admin"


def test_admin_token_can_access_patient_endpoint(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-patient-access.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_2", role="admin")
        _seed_patient(client, line_user_id="U_PATIENT_MATCHED")
        token = _login_and_get_token(client, "U_ADMIN_2")

        response = client.get(
            "/v1/patient/upload-history",
            params={"line_user_id": "U_PATIENT_MATCHED"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "matched"


def test_login_rejects_invalid_stub_token(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "invalid-stub.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_X", role="admin")
        response = client.post("/v1/auth/login", json={"line_id_token": "invalid-token"})
        assert response.status_code == 400 or response.status_code == 422 or response.status_code == 403
