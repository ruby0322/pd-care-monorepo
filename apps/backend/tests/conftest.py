from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _skip_storage_bucket_initialization(
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> None:
    if request.node.get_closest_marker("no_bucket_patch"):
        return
    monkeypatch.setattr("app.main.StorageService.ensure_bucket_exists", lambda _self: None)

