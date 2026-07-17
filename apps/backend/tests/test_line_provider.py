from __future__ import annotations

import pytest

from app.services.auth.line_provider import LineIdentityProvider


def test_stub_mode_accepts_stub_token() -> None:
    provider = LineIdentityProvider(
        verify_mode="stub",
        channel_id="",
        verify_endpoint="https://example.invalid/verify",
        timeout_seconds=1.0,
    )
    profile = provider.verify_id_token(line_id_token="stub:U_DEV_ADMIN")
    assert profile.line_user_id == "U_DEV_ADMIN"


def test_stub_mode_rejects_real_shaped_token_with_actionable_message() -> None:
    provider = LineIdentityProvider(
        verify_mode="stub",
        channel_id="",
        verify_endpoint="https://example.invalid/verify",
        timeout_seconds=1.0,
    )
    with pytest.raises(ValueError, match="NEXT_PUBLIC_LIFF_ID"):
        provider.verify_id_token(line_id_token="eyJhbGciOiJIUzI1NiJ9.e30.signature")


def test_line_mode_rejects_stub_token_with_actionable_message() -> None:
    provider = LineIdentityProvider(
        verify_mode="line",
        channel_id="1657724367",
        verify_endpoint="https://example.invalid/verify",
        timeout_seconds=1.0,
    )
    with pytest.raises(ValueError, match="LINE_VERIFY_MODE=stub"):
        provider.verify_id_token(line_id_token="stub:U_DEV_ADMIN")
