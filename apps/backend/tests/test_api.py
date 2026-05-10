from __future__ import annotations
# pyright: reportMissingImports=false

import io
from pathlib import Path

import torch
import torchvision.transforms as transforms
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app
from app.model_loader import LoadedModel


class DummyModel(torch.nn.Module):
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch_size = x.shape[0]
        logits = torch.tensor([[0.1, 0.2, 0.3, 0.4, 3.0]], dtype=torch.float32)
        return logits.repeat(batch_size, 1)


def make_settings() -> Settings:
    return Settings(
        app_name="test-api",
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
        cors_allowed_origins=("http://localhost:3000", "http://127.0.0.1:3000"),
        cors_allowed_origin_regex=(
            r"^https?://localhost(?::\d+)?$"
            r"|^https?://127\.0\.0\.1(?::\d+)?$"
            r"|^https?://(?:\d{1,3}\.){3}\d{1,3}:3000$"
        ),
        workers=1,
        eval_hflip_tta=False,
        database_url="sqlite+pysqlite:///:memory:",
        s3_endpoint_url="http://localhost:8333",
        s3_region="us-east-1",
        s3_access_key="seaweed-access",
        s3_secret_key="seaweed-secret",
        s3_bucket_name="pd-care-private",
        image_access_token_secret="test-secret",
        image_access_token_ttl_seconds=300,
    )


def make_loaded_model(settings: Settings) -> LoadedModel:
    transform = transforms.Compose(
        [
            transforms.Resize(settings.image_size),
            transforms.CenterCrop(settings.image_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    return LoadedModel(model=DummyModel(), device=torch.device("cpu"), transform=transform)


def make_image_bytes() -> bytes:
    image = Image.new("RGB", (512, 512), color=(120, 80, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def test_reference_style_backend_modules_exist() -> None:
    from app.api.routes.health import router as health_router
    from app.api.routes.predict import router as predict_router
    from app.core.config import Settings as CoreSettings
    from app.schemas.health import HealthResponse
    from app.schemas.prediction import PredictionResponse
    from app.services.model_loader import LoadedModel as ServiceLoadedModel

    assert health_router is not None
    assert predict_router is not None
    assert CoreSettings is Settings
    assert HealthResponse.model_fields["status"] is not None
    assert PredictionResponse.model_fields["predicted_class_name"] is not None
    assert ServiceLoadedModel is LoadedModel


def test_openapi_and_swagger_ui_available() -> None:
    settings = make_settings()
    app = create_app(settings=settings, loaded_model=make_loaded_model(settings))
    client = TestClient(app)

    openapi = client.get("/openapi.json")
    assert openapi.status_code == 200
    spec = openapi.json()
    assert spec["info"]["title"] == settings.app_name
    assert "/v1/predict" in spec["paths"]

    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200


def test_health_and_ready_endpoints() -> None:
    settings = make_settings()
    app = create_app(settings=settings, loaded_model=make_loaded_model(settings))
    client = TestClient(app)

    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json() == {
        "status": "ready",
        "model_loaded": True,
        "device": "cpu",
    }


def test_predict_endpoint_returns_screening_payload() -> None:
    settings = make_settings()
    app = create_app(settings=settings, loaded_model=make_loaded_model(settings))
    client = TestClient(app)

    response = client.post(
        "/v1/predict",
        files={"file": ("test.jpg", make_image_bytes(), "image/jpeg")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["predicted_class_index"] == 4
    assert payload["predicted_class_name"] == "class_4"
    assert payload["screening"]["infection_class_index"] == 4
    assert payload["screening"]["is_infection_positive"] is True
    assert len(payload["class_probabilities"]) == 5


def test_predict_rejects_unsupported_media_type() -> None:
    settings = make_settings()
    app = create_app(settings=settings, loaded_model=make_loaded_model(settings))
    client = TestClient(app)

    response = client.post(
        "/v1/predict",
        files={"file": ("test.txt", b"not-an-image", "text/plain")},
    )

    assert response.status_code == 415


def test_cors_preflight_allows_localhost_nonstandard_port() -> None:
    settings = make_settings()
    app = create_app(settings=settings, loaded_model=make_loaded_model(settings))
    client = TestClient(app)

    response = client.options(
        "/v1/predict",
        headers={
            "Origin": "http://localhost:49808",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:49808"


def test_cors_preflight_allows_mobile_lan_origin() -> None:
    settings = make_settings()
    app = create_app(settings=settings, loaded_model=make_loaded_model(settings))
    client = TestClient(app)

    response = client.options(
        "/v1/predict",
        headers={
            "Origin": "http://192.168.1.100:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://192.168.1.100:3000"

