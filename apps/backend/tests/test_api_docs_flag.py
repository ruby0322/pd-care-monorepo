from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from app.config import Settings


def _settings(*, app_env: str) -> Settings:
    return Settings(
        app_name="test-api-docs-flag",
        app_env=app_env,
        model_url="https://example.com/model.pt",
        model_path=Path("/tmp/model.pt"),
        model_cache_dir=Path("/tmp"),
        model_timeout_seconds=5.0,
        device="cpu",
        model_backbone="n",
        model_arch="n",
        transfer_dropout=0.4,
        threshold=0.5,
        image_size=384,
        infection_class_index=4,
        class_names=("class_0",),
        max_upload_mb=10,
        log_level="INFO",
        accepted_content_types=("image/jpeg",),
        cors_allowed_origins=("http://localhost:3000",),
        cors_allowed_origin_regex=r"^https?://localhost(?::\d+)?$",
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


def test_api_docs_enabled_for_unit_test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    assert _settings(app_env="test").api_docs_enabled() is True


def test_api_docs_disabled_for_deployed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    assert _settings(app_env="prod").api_docs_enabled() is False
    assert _settings(app_env="development").api_docs_enabled() is False


def test_api_docs_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENABLE_API_DOCS", "true")
    assert _settings(app_env="prod").api_docs_enabled() is True
    monkeypatch.setenv("ENABLE_API_DOCS", "false")
    assert _settings(app_env="test").api_docs_enabled() is False


def test_replace_keeps_docs_flag() -> None:
    settings = replace(_settings(app_env="test"), app_env="prod")
    assert settings.api_docs_enabled() is False
