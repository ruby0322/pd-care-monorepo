from __future__ import annotations
# pyright: reportMissingImports=false

import pytest
import torch

from app.services.model_loader import ModelLoadError, resolve_device


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


def test_resolve_device_auto_logs_deprecation_warning(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING"):
        device = resolve_device("auto")

    assert device == torch.device("cpu")
    assert any("DEVICE=auto is deprecated" in record.message for record in caplog.records)
