from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from app.services.auth.line_provider import (
    LINE_TOKEN_EXPIRED,
    LINE_TOKEN_INVALID,
    LINE_VERIFY_MISCONFIGURED,
    LINE_VERIFY_UNAVAILABLE,
    MSG_TOKEN_EXPIRED,
    MSG_TOKEN_INVALID,
    MSG_VERIFY_MISCONFIGURED,
    MSG_VERIFY_UNAVAILABLE,
    LineIdentityProvider,
    LineTokenVerifyError,
)


def _line_provider() -> LineIdentityProvider:
    return LineIdentityProvider(
        verify_mode="line",
        channel_id="1657724367",
        verify_endpoint="https://example.invalid/verify",
        timeout_seconds=1.0,
    )


def test_stub_mode_accepts_stub_token() -> None:
    provider = LineIdentityProvider(
        verify_mode="stub",
        channel_id="",
        verify_endpoint="https://example.invalid/verify",
        timeout_seconds=1.0,
    )
    profile = provider.verify_id_token(line_id_token="stub:U_DEV_ADMIN")
    assert profile.line_user_id == "U_DEV_ADMIN"


def test_stub_mode_rejects_real_shaped_token() -> None:
    provider = LineIdentityProvider(
        verify_mode="stub",
        channel_id="",
        verify_endpoint="https://example.invalid/verify",
        timeout_seconds=1.0,
    )
    with pytest.raises(LineTokenVerifyError) as exc_info:
        provider.verify_id_token(line_id_token="eyJhbGciOiJIUzI1NiJ9.e30.signature")
    assert exc_info.value.code == LINE_TOKEN_INVALID
    assert exc_info.value.message == MSG_TOKEN_INVALID


def test_line_mode_rejects_stub_token() -> None:
    provider = _line_provider()
    with pytest.raises(LineTokenVerifyError) as exc_info:
        provider.verify_id_token(line_id_token="stub:U_DEV_ADMIN")
    assert exc_info.value.code == LINE_VERIFY_MISCONFIGURED
    assert exc_info.value.message == MSG_VERIFY_MISCONFIGURED


@patch("app.services.auth.line_provider.time.sleep")
@patch("app.services.auth.line_provider.requests.post")
def test_line_verify_retries_on_timeout_then_raises_unavailable(
    mock_post: MagicMock,
    _mock_sleep: MagicMock,
) -> None:
    mock_post.side_effect = requests.Timeout("timed out")
    provider = _line_provider()

    with pytest.raises(LineTokenVerifyError) as exc_info:
        provider.verify_id_token(line_id_token="real-token")

    assert exc_info.value.code == LINE_VERIFY_UNAVAILABLE
    assert exc_info.value.message == MSG_VERIFY_UNAVAILABLE
    assert mock_post.call_count == 3


@patch("app.services.auth.line_provider.time.sleep")
@patch("app.services.auth.line_provider.requests.post")
def test_line_verify_succeeds_on_second_attempt(mock_post: MagicMock, _mock_sleep: MagicMock) -> None:
    success = MagicMock()
    success.status_code = 200
    success.json.return_value = {"sub": "U_LINE_OK", "name": "Test User"}
    mock_post.side_effect = [requests.Timeout("timed out"), success]
    provider = _line_provider()

    profile = provider.verify_id_token(line_id_token="real-token")

    assert profile.line_user_id == "U_LINE_OK"
    assert profile.display_name == "Test User"
    assert mock_post.call_count == 2


@patch("app.services.auth.line_provider.requests.post")
def test_line_verify_expired_token_does_not_retry(mock_post: MagicMock) -> None:
    response = MagicMock()
    response.status_code = 400
    response.json.return_value = {"error": "invalid_request", "error_description": "IdToken expired."}
    mock_post.return_value = response
    provider = _line_provider()

    with pytest.raises(LineTokenVerifyError) as exc_info:
        provider.verify_id_token(line_id_token="real-token")

    assert exc_info.value.code == LINE_TOKEN_EXPIRED
    assert exc_info.value.message == MSG_TOKEN_EXPIRED
    assert mock_post.call_count == 1


@patch("app.services.auth.line_provider.time.sleep")
@patch("app.services.auth.line_provider.requests.post")
def test_line_verify_retries_on_429_then_raises_unavailable(mock_post: MagicMock, _mock_sleep: MagicMock) -> None:
    response = MagicMock()
    response.status_code = 429
    response.json.return_value = {"error": "too_many_requests"}
    mock_post.return_value = response
    provider = _line_provider()

    with pytest.raises(LineTokenVerifyError) as exc_info:
        provider.verify_id_token(line_id_token="real-token")

    assert exc_info.value.code == LINE_VERIFY_UNAVAILABLE
    assert mock_post.call_count == 3
