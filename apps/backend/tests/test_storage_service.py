from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone

from app.services.storage import StorageService, build_storage_client


class FakeS3Client:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def put_object(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        return {"ETag": '"etag"'}


def test_object_key_generation_uses_patient_and_upload_ids() -> None:
    service = StorageService(
        s3_client=FakeS3Client(),
        bucket="pd-care-private",
        token_secret="secret-key",
    )

    object_key = service.generate_object_key(patient_id=12, upload_id=34, file_extension="png")

    assert object_key == "patients/12/uploads/34.png"


def test_store_image_writes_private_object_to_bucket() -> None:
    fake_client = FakeS3Client()
    service = StorageService(
        s3_client=fake_client,
        bucket="pd-care-private",
        token_secret="secret-key",
    )

    service.store_image(
        object_key="patients/7/uploads/9.jpg",
        content=b"image-bytes",
        content_type="image/jpeg",
    )

    assert len(fake_client.calls) == 1
    assert fake_client.calls[0]["Bucket"] == "pd-care-private"
    assert fake_client.calls[0]["Key"] == "patients/7/uploads/9.jpg"
    assert fake_client.calls[0]["Body"] == b"image-bytes"
    assert fake_client.calls[0]["ContentType"] == "image/jpeg"


def test_token_validation_rejects_wrong_subject() -> None:
    fixed_now = datetime(2026, 5, 8, 8, 0, tzinfo=timezone.utc)
    service = StorageService(
        s3_client=FakeS3Client(),
        bucket="pd-care-private",
        token_secret="secret-key",
        now_fn=lambda: fixed_now,
    )
    token = service.generate_access_token(
        object_key="patients/1/uploads/5.jpg",
        subject="patient:1",
        ttl_seconds=300,
    )

    assert service.validate_access_token(
        token=token,
        object_key="patients/1/uploads/5.jpg",
        subject="staff:1",
    ) is False


def test_token_validation_rejects_expired_token() -> None:
    base_now = datetime(2026, 5, 8, 8, 0, tzinfo=timezone.utc)
    service = StorageService(
        s3_client=FakeS3Client(),
        bucket="pd-care-private",
        token_secret="secret-key",
        now_fn=lambda: base_now,
    )
    token = service.generate_access_token(
        object_key="patients/1/uploads/5.jpg",
        subject="patient:1",
        ttl_seconds=60,
    )

    later_service = StorageService(
        s3_client=FakeS3Client(),
        bucket="pd-care-private",
        token_secret="secret-key",
        now_fn=lambda: base_now + timedelta(minutes=2),
    )
    assert later_service.validate_access_token(
        token=token,
        object_key="patients/1/uploads/5.jpg",
        subject="patient:1",
    ) is False


def test_build_storage_client_uses_explicit_endpoint() -> None:
    client = build_storage_client(
        endpoint_url="http://seaweedfs-s3:8333",
        region="us-east-1",
        access_key="seaweed-access",
        secret_key="seaweed-secret",
    )

    assert client is not None
