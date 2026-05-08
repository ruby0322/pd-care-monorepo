from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any, Callable

import boto3


def _urlsafe_b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def build_storage_client(endpoint_url: str, region: str, access_key: str, secret_key: str) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )


class StorageService:
    def __init__(
        self,
        s3_client: Any,
        bucket: str,
        token_secret: str,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._s3_client = s3_client
        self._bucket = bucket
        self._token_secret = token_secret.encode("utf-8")
        self._now_fn = now_fn or (lambda: datetime.now(tz=timezone.utc))

    def generate_object_key(self, patient_id: int, upload_id: int, file_extension: str = "jpg") -> str:
        extension = file_extension.lower().lstrip(".") or "jpg"
        return f"patients/{patient_id}/uploads/{upload_id}.{extension}"

    def store_image(self, object_key: str, content: bytes, content_type: str) -> None:
        self._s3_client.put_object(
            Bucket=self._bucket,
            Key=object_key,
            Body=content,
            ContentType=content_type,
        )

    def open_image_stream(self, object_key: str) -> Any:
        response = self._s3_client.get_object(Bucket=self._bucket, Key=object_key)
        return response["Body"]

    def generate_access_token(self, object_key: str, subject: str, ttl_seconds: int) -> str:
        now_ts = int(self._now_fn().timestamp())
        payload = {
            "k": object_key,
            "s": subject,
            "exp": now_ts + ttl_seconds,
        }
        payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        payload_part = _urlsafe_b64encode(payload_bytes)
        signature = hmac.new(self._token_secret, payload_part.encode("ascii"), hashlib.sha256).digest()
        signature_part = _urlsafe_b64encode(signature)
        return f"{payload_part}.{signature_part}"

    def validate_access_token(self, token: str, object_key: str, subject: str) -> bool:
        try:
            payload_part, signature_part = token.split(".", 1)
            expected_sig = hmac.new(self._token_secret, payload_part.encode("ascii"), hashlib.sha256).digest()
            actual_sig = _urlsafe_b64decode(signature_part)
            if not hmac.compare_digest(expected_sig, actual_sig):
                return False

            payload = json.loads(_urlsafe_b64decode(payload_part).decode("utf-8"))
            if payload.get("k") != object_key:
                return False
            if payload.get("s") != subject:
                return False
            if int(payload.get("exp", 0)) < int(self._now_fn().timestamp()):
                return False
            return True
        except Exception:
            return False
