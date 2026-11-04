from __future__ import annotations
# pyright: reportMissingImports=false

import io
from collections.abc import Sequence
from pathlib import Path
from unittest.mock import patch

import pytest
import torch
from PIL import Image

from app.core.config import Settings
from app.services.model_loader import (
    LoadedModel,
    ModelLoadError,
    build_transform,
    predict_bytes,
    resolve_device,
)


@pytest.mark.parametrize(
    ("device_name", "expected_type"),
    [
        ("cpu", torch.device("cpu")),
        ("CPU", torch.device("cpu")),
        ("", torch.device("cpu")),
        ("  ", torch.device("cpu")),
        ("auto", torch.device("cpu")),
        ("AUTO", torch.device("cpu")),
    ],
)
def test_resolve_device_cpu_aliases(device_name: str, expected_type: torch.device) -> None:
    assert resolve_device(device_name) == expected_type


@pytest.mark.parametrize("device_name", ["cuda", "CUDA", "gpu"])
def test_resolve_device_rejects_gpu(device_name: str) -> None:
    with pytest.raises(ModelLoadError, match="GPU support is disabled"):
        resolve_device(device_name)


def test_resolve_device_auto_logs_deprecation_warning() -> None:
    with patch("app.services.model_loader.LOGGER.warning") as warning:
        device = resolve_device("auto")

    assert device == torch.device("cpu")
    warning.assert_called_once()
    assert "DEVICE=auto is deprecated" in warning.call_args.args[0]


# --- Infection decision rule -------------------------------------------------
#
# Regression guard for the production incident: an image whose softmax had
# argmax == class_4 with P(class_4) = 0.7151 was recorded as screening_result
# "normal" because THRESHOLD was 0.72. The threshold must only ever be able to
# ADD positives, never to veto the model's own top prediction.


class FixedProbabilityModel(torch.nn.Module):
    """Emits logits whose softmax equals `probabilities` exactly."""

    def __init__(self, probabilities: Sequence[float]) -> None:
        super().__init__()
        self._logits = torch.log(torch.tensor([list(probabilities)], dtype=torch.float32))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self._logits.repeat(x.shape[0], 1)


def _screening_settings(threshold: float) -> Settings:
    return Settings(
        app_name="test-model-loader",
        app_env="test",
        model_url="https://example.com/model.pt",
        model_path=Path("/tmp/model.pt"),
        model_cache_dir=Path("/tmp"),
        model_timeout_seconds=5.0,
        device="cpu",
        model_backbone="mobilenet_v3_large",
        model_arch="baseline",
        transfer_dropout=0.4,
        threshold=threshold,
        image_size=384,
        infection_class_index=4,
        class_names=("class_0", "class_1", "class_2", "class_3", "class_4"),
        max_upload_mb=10,
        log_level="INFO",
        accepted_content_types=("image/jpeg", "image/png"),
        cors_allowed_origins=("http://localhost:3000",),
        cors_allowed_origin_regex=r"^https?://localhost(?::\d+)?$",
        workers=1,
        eval_hflip_tta=False,
        database_url="sqlite://",
        s3_endpoint_url="http://localhost:8333",
        s3_region="us-east-1",
        s3_access_key="seaweed-access",
        s3_secret_key="seaweed-secret",
        s3_bucket_name="pd-care-private",
        image_access_token_secret="test-secret",
        image_access_token_ttl_seconds=300,
    )


def _image_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (512, 512), color=(120, 80, 200)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _screen(probabilities: Sequence[float], threshold: float):
    settings = _screening_settings(threshold)
    loaded = LoadedModel(
        model=FixedProbabilityModel(probabilities),
        device=torch.device("cpu"),
        transform=build_transform(settings),
    )
    return predict_bytes(loaded, _image_bytes(), settings).screening


def test_argmax_infection_is_positive_even_below_threshold() -> None:
    """argmax == class_4 with P(class_4) = 0.60 < THRESHOLD 0.72 must stay positive.

    This is the exact shape of the production case (P = 0.7151, threshold 0.72)
    that was wrongly reported as "normal".
    """
    screening = _screen([0.10, 0.10, 0.10, 0.10, 0.60], threshold=0.72)

    assert screening.infection_probability == pytest.approx(0.60, abs=1e-5)
    assert screening.threshold == pytest.approx(0.72)
    assert screening.is_infection_positive is True


def test_threshold_can_still_add_positives_below_argmax() -> None:
    """A low threshold stays able to flag images whose top class is not class_4."""
    screening = _screen([0.40, 0.05, 0.05, 0.20, 0.30], threshold=0.30)

    assert screening.infection_probability == pytest.approx(0.30, abs=1e-5)
    assert screening.is_infection_positive is True


def test_non_infection_argmax_below_threshold_is_negative() -> None:
    screening = _screen([0.40, 0.05, 0.05, 0.20, 0.30], threshold=0.72)

    assert screening.is_infection_positive is False


@pytest.mark.parametrize("threshold", [0.5, 0.72])
def test_decision_rule_is_threshold_invariant_for_argmax_infection(threshold: float) -> None:
    """Deployed 0.5 and the previous 0.72 agree whenever argmax == class_4."""
    screening = _screen([0.12, 0.12, 0.12, 0.13, 0.51], threshold=threshold)

    assert screening.is_infection_positive is True
