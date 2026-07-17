from __future__ import annotations
# pyright: reportMissingImports=false

import io
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Notification, Patient, PendingBinding, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService
from app.services.prescreen import PrescreenInferenceError
from app.services.prescreen_rate_limit import prescreen_rate_limiter
from tests.db_test_utils import migrated_sqlite_database_url


def _make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-patient-prescreen-api",
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


def _make_image_bytes() -> bytes:
    image = Image.new("RGB", (512, 512), color=(120, 80, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def _seed_bound_identity(
    client: TestClient,
    line_user_id: str,
    *,
    case_number: str = "P123456",
    birth_date: str = "1980-01-02",
    full_name: str = "Patient A",
) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number=case_number, birth_date=birth_date, full_name=full_name, is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Patient A",
                picture_url=None,
                patient_id=patient.id,
            )
        )
        session.commit()
        return patient.id


def _seed_pending_identity(client: TestClient, line_user_id: str) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Pending Patient",
                picture_url=None,
                patient_id=None,
            )
        )
        session.add(
            PendingBinding(
                line_user_id=line_user_id,
                case_number="P999999",
                birth_date="1990-01-01",
                status="pending",
            )
        )
        session.commit()


def _issue_token_for_line_user(
    client: TestClient,
    *,
    line_user_id: str,
    role: str = "patient",
) -> str:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == line_user_id).one()
    token_service = AuthTokenService(secret=client.app.state.settings.auth_token_secret)
    return token_service.issue_token(
        identity_id=identity.id,
        line_user_id=identity.line_user_id,
        role=role,
        patient_id=identity.patient_id,
        ttl_seconds=client.app.state.settings.auth_token_ttl_seconds,
    )


@pytest.fixture(autouse=True)
def _reset_prescreen_rate_limiter() -> None:
    prescreen_rate_limiter.reset()


def test_prescreen_returns_present_true_when_model_detects_exit_site(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = replace(
        _make_settings(tmp_path / "prescreen-present.db"),
        prescreen_enabled=True,
    )
    app = create_app(
        settings=settings,
        loaded_model=SimpleNamespace(device="cpu"),
        loaded_prescreen_model=SimpleNamespace(device="cpu", threshold=0.5),
    )
    monkeypatch.setattr(
        "app.api.routes.patient.is_exit_site_present",
        lambda _loaded, _bytes, **kwargs: True,
    )

    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_PRESCREEN_OK")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PRESCREEN_OK")

        response = client.post(
            "/v1/patient/prescreen",
            files={"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {"present": True, "checked": True}

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.query(Upload).count() == 0
            assert session.query(AIResult).count() == 0
            assert session.query(Notification).count() == 0


def test_prescreen_returns_present_false_when_model_rejects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = replace(
        _make_settings(tmp_path / "prescreen-absent.db"),
        prescreen_enabled=True,
    )
    app = create_app(
        settings=settings,
        loaded_model=SimpleNamespace(device="cpu"),
        loaded_prescreen_model=SimpleNamespace(device="cpu", threshold=0.5),
    )
    monkeypatch.setattr(
        "app.api.routes.patient.is_exit_site_present",
        lambda _loaded, _bytes, **kwargs: False,
    )

    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_PRESCREEN_ABSENT")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PRESCREEN_ABSENT")

        response = client.post(
            "/v1/patient/prescreen",
            files={"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {"present": False, "checked": True}


def test_prescreen_fails_open_when_inference_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = replace(
        _make_settings(tmp_path / "prescreen-fail-open.db"),
        prescreen_enabled=True,
    )
    app = create_app(
        settings=settings,
        loaded_model=SimpleNamespace(device="cpu"),
        loaded_prescreen_model=SimpleNamespace(device="cpu", threshold=0.5),
    )

    def _raise(_loaded: object, _bytes: bytes, **kwargs: object) -> bool:
        raise PrescreenInferenceError("simulated")

    monkeypatch.setattr("app.api.routes.patient.is_exit_site_present", _raise)

    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_PRESCREEN_ERR")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PRESCREEN_ERR")

        response = client.post(
            "/v1/patient/prescreen",
            files={"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {"present": True, "checked": False}


def test_prescreen_fails_open_when_prescreen_disabled(tmp_path: Path) -> None:
    settings = replace(
        _make_settings(tmp_path / "prescreen-disabled.db"),
        prescreen_enabled=False,
    )
    app = create_app(
        settings=settings,
        loaded_model=SimpleNamespace(device="cpu"),
        loaded_prescreen_model=None,
    )

    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_PRESCREEN_OFF")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PRESCREEN_OFF")

        response = client.post(
            "/v1/patient/prescreen",
            files={"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {"present": True, "checked": False}


def test_prescreen_rejects_unauthenticated(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "prescreen-unauth.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))

    with TestClient(app) as client:
        response = client.post(
            "/v1/patient/prescreen",
            files={"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")},
        )
        assert response.status_code in (401, 403)


def test_prescreen_rejects_pending_identity(tmp_path: Path) -> None:
    settings = replace(
        _make_settings(tmp_path / "prescreen-pending.db"),
        prescreen_enabled=True,
    )
    app = create_app(
        settings=settings,
        loaded_model=SimpleNamespace(device="cpu"),
        loaded_prescreen_model=SimpleNamespace(device="cpu", threshold=0.5),
    )

    with TestClient(app) as client:
        _seed_pending_identity(client, line_user_id="U_LINE_PRESCREEN_PENDING")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PRESCREEN_PENDING")

        response = client.post(
            "/v1/patient/prescreen",
            files={"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403


def test_prescreen_rate_limits_second_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = replace(
        _make_settings(tmp_path / "prescreen-rate.db"),
        prescreen_enabled=True,
    )
    app = create_app(
        settings=settings,
        loaded_model=SimpleNamespace(device="cpu"),
        loaded_prescreen_model=SimpleNamespace(device="cpu", threshold=0.5),
    )
    monkeypatch.setattr(
        "app.api.routes.patient.is_exit_site_present",
        lambda _loaded, _bytes, **kwargs: True,
    )

    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_PRESCREEN_RATE")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PRESCREEN_RATE")
        headers = {"Authorization": f"Bearer {token}"}
        files = {"file": ("frame.jpg", _make_image_bytes(), "image/jpeg")}

        first = client.post("/v1/patient/prescreen", files=files, headers=headers)
        second = client.post("/v1/patient/prescreen", files=files, headers=headers)

        assert first.status_code == 200
        assert second.status_code == 429
