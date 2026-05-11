from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


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
        # Test-only mode; enables deterministic API tests without network.
        if not line_id_token.startswith("stub:"):
            raise ValueError("Invalid LINE id token (stub mode)")
        line_user_id = line_id_token.replace("stub:", "", 1).strip()
        if not line_user_id:
            raise ValueError("Invalid LINE id token subject")
        return LineIdentityProfile(
            line_user_id=line_user_id,
            display_name=None,
            picture_url=None,
        )

    def _verify_line_id_token(self, *, line_id_token: str) -> LineIdentityProfile:
        if not self._channel_id:
            raise ValueError("LINE_CHANNEL_ID is required for LINE token verification")

        payload = {"id_token": line_id_token, "client_id": self._channel_id}
        try:
            response = requests.post(self._verify_endpoint, data=payload, timeout=self._timeout_seconds)
        except requests.RequestException as exc:
            raise ValueError("Failed to verify LINE id token") from exc

        if response.status_code != 200:
            verify_error = ""
            try:
                body_json: Any = response.json()
                error_code = str(body_json.get("error", "")).strip()
                error_description = str(body_json.get("error_description", "")).strip()
                if error_code or error_description:
                    verify_error = f"{error_code} {error_description}".strip()
            except ValueError:
                verify_error = response.text[:200].strip()
            detail = f" (LINE verify {response.status_code}: {verify_error})" if verify_error else f" (LINE verify {response.status_code})"
            raise ValueError(f"Invalid LINE id token{detail}")

        body: Any = response.json()
        line_user_id = str(body.get("sub", "")).strip()
        if not line_user_id:
            raise ValueError("LINE verify response missing subject")
        display_name = body.get("name")
        picture_url = body.get("picture")
        return LineIdentityProfile(
            line_user_id=line_user_id,
            display_name=str(display_name).strip() if isinstance(display_name, str) and display_name.strip() else None,
            picture_url=str(picture_url).strip() if isinstance(picture_url, str) and picture_url.strip() else None,
        )
