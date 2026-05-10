from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable


def _urlsafe_b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


@dataclass(frozen=True)
class AuthPrincipal:
    identity_id: int
    line_user_id: str
    role: str
    patient_id: int | None
    expires_at: int


class AuthTokenService:
    def __init__(self, *, secret: str, now_fn: Callable[[], datetime] | None = None) -> None:
        self._secret = secret.encode("utf-8")
        self._now_fn = now_fn or (lambda: datetime.now(tz=timezone.utc))

    def issue_token(
        self,
        *,
        identity_id: int,
        line_user_id: str,
        role: str,
        patient_id: int | None,
        ttl_seconds: int,
    ) -> str:
        now_ts = int(self._now_fn().timestamp())
        payload = {
            "sub": f"identity:{identity_id}",
            "iid": identity_id,
            "line_user_id": line_user_id,
            "role": role,
            "patient_id": patient_id,
            "exp": now_ts + ttl_seconds,
        }
        payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        payload_part = _urlsafe_b64encode(payload_bytes)
        signature = hmac.new(self._secret, payload_part.encode("ascii"), hashlib.sha256).digest()
        signature_part = _urlsafe_b64encode(signature)
        return f"{payload_part}.{signature_part}"

    def verify_token(self, token: str) -> AuthPrincipal:
        try:
            payload_part, signature_part = token.split(".", 1)
            expected_sig = hmac.new(self._secret, payload_part.encode("ascii"), hashlib.sha256).digest()
            actual_sig = _urlsafe_b64decode(signature_part)
            if not hmac.compare_digest(expected_sig, actual_sig):
                raise ValueError("Invalid token signature")

            payload = json.loads(_urlsafe_b64decode(payload_part).decode("utf-8"))
            expires_at = int(payload.get("exp", 0))
            if expires_at < int(self._now_fn().timestamp()):
                raise ValueError("Token is expired")

            identity_id = int(payload["iid"])
            line_user_id = str(payload["line_user_id"])
            role = str(payload["role"])
            patient_id_raw = payload.get("patient_id")
            patient_id = int(patient_id_raw) if patient_id_raw is not None else None
            return AuthPrincipal(
                identity_id=identity_id,
                line_user_id=line_user_id,
                role=role,
                patient_id=patient_id,
                expires_at=expires_at,
            )
        except Exception as exc:  # pragma: no cover - normalized into auth error
            if isinstance(exc, ValueError):
                raise
            raise ValueError("Invalid auth token") from exc
