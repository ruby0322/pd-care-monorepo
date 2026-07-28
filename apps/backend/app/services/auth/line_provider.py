from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import requests

logger = logging.getLogger(__name__)

LINE_VERIFY_UNAVAILABLE = "LINE_VERIFY_UNAVAILABLE"
LINE_TOKEN_EXPIRED = "LINE_TOKEN_EXPIRED"
LINE_TOKEN_INVALID = "LINE_TOKEN_INVALID"
LINE_VERIFY_MISCONFIGURED = "LINE_VERIFY_MISCONFIGURED"

MSG_VERIFY_UNAVAILABLE = "無法連上 LINE，請稍後再試。"
MSG_TOKEN_EXPIRED = "LINE 登入已過期，請重新開啟。"
MSG_TOKEN_INVALID = "LINE 登入失敗，請重新開啟。"
MSG_VERIFY_MISCONFIGURED = "系統異常，請聯絡護理師。"

LINE_VERIFY_MAX_ATTEMPTS = 3
LINE_VERIFY_RETRY_BACKOFF_SECONDS = (0.3, 0.6)


class LineTokenVerifyError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class LineIdentityProfile:
    line_user_id: str
    display_name: str | None
    picture_url: str | None


class LineIdentityProvider:
    def __init__(
        self,
        *,
        verify_mode: str,
        channel_id: str,
        verify_endpoint: str,
        timeout_seconds: float,
    ) -> None:
        self._verify_mode = verify_mode
        self._channel_id = channel_id
        self._verify_endpoint = verify_endpoint
        self._timeout_seconds = timeout_seconds

    def verify_id_token(self, *, line_id_token: str) -> LineIdentityProfile:
        if self._verify_mode == "stub":
            return self._verify_stub_token(line_id_token=line_id_token)
        return self._verify_line_id_token(line_id_token=line_id_token)

    def _verify_stub_token(self, *, line_id_token: str) -> LineIdentityProfile:
        if not line_id_token.startswith("stub:"):
            raise LineTokenVerifyError(LINE_TOKEN_INVALID, MSG_TOKEN_INVALID)
        line_user_id = line_id_token.replace("stub:", "", 1).strip()
        if not line_user_id:
            raise LineTokenVerifyError(LINE_TOKEN_INVALID, MSG_TOKEN_INVALID)
        return LineIdentityProfile(
            line_user_id=line_user_id,
            display_name=None,
            picture_url=None,
        )

    def _verify_line_id_token(self, *, line_id_token: str) -> LineIdentityProfile:
        if line_id_token.startswith("stub:"):
            raise LineTokenVerifyError(LINE_VERIFY_MISCONFIGURED, MSG_VERIFY_MISCONFIGURED)
        if not self._channel_id:
            raise LineTokenVerifyError(LINE_VERIFY_MISCONFIGURED, MSG_VERIFY_MISCONFIGURED)

        payload = {"id_token": line_id_token, "client_id": self._channel_id}
        last_request_error: requests.RequestException | None = None

        for attempt in range(1, LINE_VERIFY_MAX_ATTEMPTS + 1):
            try:
                response = requests.post(
                    self._verify_endpoint,
                    data=payload,
                    timeout=self._timeout_seconds,
                )
            except requests.RequestException as exc:
                last_request_error = exc
                logger.warning(
                    "LINE verify request failed (attempt %s/%s): %s",
                    attempt,
                    LINE_VERIFY_MAX_ATTEMPTS,
                    type(exc).__name__,
                )
                if attempt < LINE_VERIFY_MAX_ATTEMPTS:
                    time.sleep(LINE_VERIFY_RETRY_BACKOFF_SECONDS[attempt - 1])
                    continue
                raise LineTokenVerifyError(LINE_VERIFY_UNAVAILABLE, MSG_VERIFY_UNAVAILABLE) from exc

            if response.status_code >= 500:
                logger.warning(
                    "LINE verify returned %s (attempt %s/%s)",
                    response.status_code,
                    attempt,
                    LINE_VERIFY_MAX_ATTEMPTS,
                )
                if attempt < LINE_VERIFY_MAX_ATTEMPTS:
                    time.sleep(LINE_VERIFY_RETRY_BACKOFF_SECONDS[attempt - 1])
                    continue
                raise LineTokenVerifyError(LINE_VERIFY_UNAVAILABLE, MSG_VERIFY_UNAVAILABLE)

            if response.status_code != 200:
                verify_error = self._extract_verify_error(response)
                if "expired" in verify_error.lower():
                    raise LineTokenVerifyError(LINE_TOKEN_EXPIRED, MSG_TOKEN_EXPIRED)
                raise LineTokenVerifyError(LINE_TOKEN_INVALID, MSG_TOKEN_INVALID)

            body: Any = response.json()
            line_user_id = str(body.get("sub", "")).strip()
            if not line_user_id:
                raise LineTokenVerifyError(LINE_VERIFY_MISCONFIGURED, MSG_VERIFY_MISCONFIGURED)
            display_name = body.get("name")
            picture_url = body.get("picture")
            return LineIdentityProfile(
                line_user_id=line_user_id,
                display_name=str(display_name).strip() if isinstance(display_name, str) and display_name.strip() else None,
                picture_url=str(picture_url).strip() if isinstance(picture_url, str) and picture_url.strip() else None,
            )

        raise LineTokenVerifyError(LINE_VERIFY_UNAVAILABLE, MSG_VERIFY_UNAVAILABLE) from last_request_error

    @staticmethod
    def _extract_verify_error(response: requests.Response) -> str:
        try:
            body_json: Any = response.json()
            error_code = str(body_json.get("error", "")).strip()
            error_description = str(body_json.get("error_description", "")).strip()
            if error_code or error_description:
                return f"{error_code} {error_description}".strip()
        except ValueError:
            pass
        return response.text[:200].strip()
