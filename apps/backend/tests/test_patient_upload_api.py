from __future__ import annotations
# pyright: reportMissingImports=false

import io
from pathlib import Path
from types import SimpleNamespace

import pytest
import torch
import torchvision.transforms as transforms
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Notification, Patient, PendingBinding, Upload
from app.main import create_app
from app.model_loader import LoadedModel
from app.services.auth.token_service import AuthTokenService


class _NormalModel(torch.nn.Module):
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.shape[0]
        logits = torch.tensor([[3.5, 0.2, 0.1, 0.1, 0.1]], dtype=torch.float32)
        return logits.repeat(batch_size, 1)


class _SuspectedModel(torch.nn.Module):
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.shape[0]
        logits = torch.tensor([[0.1, 0.1, 0.1, 0.1, 3.5]], dtype=torch.float32)
        return logits.repeat(batch_size, 1)


class _FakeStorageService:
    def __init__(self, *, fail_on_store: bool = False) -> None:
        self.fail_on_store = fail_on_store
        self.stored: list[tuple[str, bytes, str]] = []

    def generate_object_key(self, patient_id: int, upload_id: int, file_extension: str = "jpg") -> str:
        return f"patients/{patient_id}/uploads/{upload_id}.{file_extension}"

    def store_image(self, object_key: str, content: bytes, content_type: str) -> None:
        if self.fail_on_store:
            raise RuntimeError("storage write failed")
        self.stored.append((object_key, content, content_type))


def _make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-patient-upload-api",
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
    )


def _make_loaded_model(model: torch.nn.Module, settings: Settings) -> LoadedModel:
    transform = transforms.Compose(
        [
            transforms.Resize(settings.image_size),
            transforms.CenterCrop(settings.image_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    return LoadedModel(model=model, device=torch.device("cpu"), transform=transform)


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
                display_name="Pending A",
                picture_url=None,
                patient_id=None,
            )
        )
        session.add(
            PendingBinding(
                line_user_id=line_user_id,
                case_number="P000000",
                birth_date="1970-01-01",
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


def test_patient_upload_persists_upload_and_ai_result(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "upload-success.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_NormalModel(), settings))
    with TestClient(app) as client:
        patient_id = _seed_bound_identity(client, line_user_id="U_LINE_BOUND")
        fake_storage = _FakeStorageService()
        client.app.state.storage_service = fake_storage
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_BOUND")

        response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_BOUND"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["patient_id"] == patient_id
        assert payload["screening_result"] == "normal"
        assert payload["upload_id"] > 0
        assert payload["ai_result_id"] > 0
        assert payload["notification_id"] is None
        assert payload["prediction"]["screening"]["is_infection_positive"] is False

        assert len(fake_storage.stored) == 1
        assert fake_storage.stored[0][0] == f"patients/{patient_id}/uploads/{payload['upload_id']}.jpg"

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            uploads = session.query(Upload).all()
            ai_results = session.query(AIResult).all()
            notifications = session.query(Notification).all()
            assert len(uploads) == 1
            assert uploads[0].object_key == f"patients/{patient_id}/uploads/{payload['upload_id']}.jpg"
            assert len(ai_results) == 1
            assert ai_results[0].upload_id == uploads[0].id
            assert len(notifications) == 0


def test_patient_upload_creates_notification_for_suspected_risk(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "upload-suspected.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_SuspectedModel(), settings))
    with TestClient(app) as client:
        patient_id = _seed_bound_identity(client, line_user_id="U_LINE_BOUND_2")
        client.app.state.storage_service = _FakeStorageService()
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_BOUND_2")

        response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_BOUND_2"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["patient_id"] == patient_id
        assert payload["screening_result"] == "suspected"
        assert payload["notification_id"] is not None
        assert payload["prediction"]["screening"]["is_infection_positive"] is True

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            notifications = session.query(Notification).all()
            assert len(notifications) == 1
            assert notifications[0].patient_id == patient_id
            assert notifications[0].upload_id == payload["upload_id"]
            assert notifications[0].ai_result_id == payload["ai_result_id"]


def test_patient_upload_rejects_unsupported_media_type(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "upload-media-type.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_BOUND_3")
        client.app.state.storage_service = _FakeStorageService()
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_BOUND_3")

        response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_BOUND_3"},
            files={"file": ("capture.txt", b"not-image", "text/plain")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 415


def test_patient_upload_rejects_pending_identity(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "upload-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_pending_identity(client, line_user_id="U_LINE_PENDING")
        client.app.state.storage_service = _FakeStorageService()
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PENDING")

        response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_PENDING"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403


def test_patient_upload_storage_failure_does_not_persist_partial_records(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "upload-storage-fail.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_NormalModel(), settings))
    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_BOUND_4")
        client.app.state.storage_service = _FakeStorageService(fail_on_store=True)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_BOUND_4")

        with pytest.raises(RuntimeError, match="storage write failed"):
            client.post(
                "/v1/patient/uploads",
                data={"line_user_id": "U_LINE_BOUND_4"},
                files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
                headers={"Authorization": f"Bearer {token}"},
            )
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.query(Upload).count() == 0
            assert session.query(AIResult).count() == 0
            assert session.query(Notification).count() == 0


def test_get_patient_result_by_upload_id_returns_persisted_record(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "get-result-upload-id.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_NormalModel(), settings))
    with TestClient(app) as client:
        patient_id = _seed_bound_identity(client, line_user_id="U_LINE_RESULT_UPLOAD")
        client.app.state.storage_service = _FakeStorageService()
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_RESULT_UPLOAD")

        upload_response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_RESULT_UPLOAD"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert upload_response.status_code == 200
        upload_payload = upload_response.json()

        response = client.get(
            "/v1/patient/uploads/result",
            params={
                "line_user_id": "U_LINE_RESULT_UPLOAD",
                "upload_id": upload_payload["upload_id"],
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["patient_id"] == patient_id
        assert payload["upload_id"] == upload_payload["upload_id"]
        assert payload["ai_result_id"] == upload_payload["ai_result_id"]
        assert payload["screening_result"] == "normal"
        assert payload["probability"] is not None


def test_get_patient_result_by_ai_result_id_returns_persisted_record(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "get-result-ai-result-id.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_SuspectedModel(), settings))
    with TestClient(app) as client:
        patient_id = _seed_bound_identity(client, line_user_id="U_LINE_RESULT_AI")
        client.app.state.storage_service = _FakeStorageService()
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_RESULT_AI")

        upload_response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_RESULT_AI"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert upload_response.status_code == 200
        upload_payload = upload_response.json()

        response = client.get(
            "/v1/patient/uploads/result",
            params={
                "line_user_id": "U_LINE_RESULT_AI",
                "ai_result_id": upload_payload["ai_result_id"],
            },
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["patient_id"] == patient_id
        assert payload["upload_id"] == upload_payload["upload_id"]
        assert payload["ai_result_id"] == upload_payload["ai_result_id"]
        assert payload["screening_result"] == "suspected"
        assert payload["probability"] is not None


def test_get_patient_result_rejects_other_patient_access(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "get-result-forbidden.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_NormalModel(), settings))
    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_RESULT_OWNER")
        _seed_bound_identity(
            client,
            line_user_id="U_LINE_RESULT_OTHER",
            case_number="P654321",
            birth_date="1988-03-04",
            full_name="Patient B",
        )
        client.app.state.storage_service = _FakeStorageService()
        owner_token = _issue_token_for_line_user(client, line_user_id="U_LINE_RESULT_OWNER")

        upload_response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_RESULT_OWNER"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert upload_response.status_code == 200
        upload_payload = upload_response.json()

        response = client.get(
            "/v1/patient/uploads/result",
            params={
                "line_user_id": "U_LINE_RESULT_OTHER",
                "upload_id": upload_payload["upload_id"],
            },
            headers={"Authorization": f"Bearer {owner_token}"},
        )

        assert response.status_code == 403


def test_patient_upload_requires_authentication(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "upload-auth-required.db")
    app = create_app(settings=settings, loaded_model=_make_loaded_model(_NormalModel(), settings))
    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_AUTH_REQUIRED")
        client.app.state.storage_service = _FakeStorageService()

        response = client.post(
            "/v1/patient/uploads",
            data={"line_user_id": "U_LINE_AUTH_REQUIRED"},
            files={"file": ("capture.jpg", _make_image_bytes(), "image/jpeg")},
        )

        assert response.status_code == 401


def test_patient_upload_history_requires_authentication(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "history-auth-required.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_bound_identity(client, line_user_id="U_LINE_HISTORY_AUTH_REQUIRED")
        response = client.get("/v1/patient/upload-history", params={"line_user_id": "U_LINE_HISTORY_AUTH_REQUIRED"})
        assert response.status_code == 401
