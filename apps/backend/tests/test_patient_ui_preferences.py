from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import LiffIdentity, Patient
from app.main import create_app
from app.services.auth.token_service import AuthTokenService
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-patient-ui-preferences",
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
    )


def _seed_matched_identity(client: TestClient, line_user_id: str = "U_LINE_UI") -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="P222222", birth_date="1982-02-02", full_name="Patient B", is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Patient B",
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        session.commit()


def _issue_token(client: TestClient, line_user_id: str) -> str:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == line_user_id).one()
    token_service = AuthTokenService(secret=client.app.state.settings.auth_token_secret)
    return token_service.issue_token(
        identity_id=identity.id,
        line_user_id=identity.line_user_id,
        role=identity.role,
        patient_id=identity.patient_id,
        ttl_seconds=client.app.state.settings.auth_token_ttl_seconds,
    )


def test_profile_includes_onboarding_guide_flag_and_patch_is_idempotent(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "ui-preferences.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_matched_identity(client)
        token = _issue_token(client, "U_LINE_UI")
        headers = {"Authorization": f"Bearer {token}"}

        profile = client.get("/v1/patient/profile", headers=headers)
        assert profile.status_code == 200
        assert profile.json()["onboarding_guide_dismissed"] is False

        first = client.patch(
            "/v1/patient/ui-preferences",
            headers=headers,
            json={"onboarding_guide_dismissed": True},
        )
        assert first.status_code == 200
        assert first.json()["onboarding_guide_dismissed"] is True

        second = client.patch(
            "/v1/patient/ui-preferences",
            headers=headers,
            json={"onboarding_guide_dismissed": True},
        )
        assert second.status_code == 200
        assert second.json()["onboarding_guide_dismissed"] is True

        again = client.get("/v1/patient/profile", headers=headers)
        assert again.json()["onboarding_guide_dismissed"] is True
