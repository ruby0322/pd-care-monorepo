from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone

from botocore.exceptions import ClientError

from app.services.storage import StorageService, build_storage_client


class FakeS3Client:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def put_object(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        return {"ETag": '"etag"'}

    def head_bucket(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        return {}

    def create_bucket(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        return {}


class MissingBucketS3Client(FakeS3Client):
    def head_bucket(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        raise ClientError(
            {
                "Error": {"Code": "404", "Message": "Not Found"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            },
            "HeadBucket",
        )


class BrokenS3Client(FakeS3Client):
    def head_bucket(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        raise ClientError(
            {
                "Error": {"Code": "403", "Message": "Forbidden"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            },
            "HeadBucket",
        )


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


def test_ensure_bucket_exists_is_noop_when_bucket_already_exists() -> None:
    fake_client = FakeS3Client()
    service = StorageService(
        s3_client=fake_client,
        bucket="pd-care-private",
        token_secret="secret-key",
    )

    service.ensure_bucket_exists()

    assert fake_client.calls == [{"Bucket": "pd-care-private"}]


def test_ensure_bucket_exists_creates_bucket_when_missing() -> None:
    fake_client = MissingBucketS3Client()
    service = StorageService(
        s3_client=fake_client,
        bucket="pd-care-private",
        token_secret="secret-key",
    )

    service.ensure_bucket_exists()

    assert fake_client.calls == [
        {"Bucket": "pd-care-private"},
        {"Bucket": "pd-care-private"},
    ]


def test_ensure_bucket_exists_raises_for_non_recoverable_errors() -> None:
    fake_client = BrokenS3Client()
    service = StorageService(
        s3_client=fake_client,
        bucket="pd-care-private",
        token_secret="secret-key",
    )

    try:
        service.ensure_bucket_exists()
    except ClientError as exc:
        assert exc.response["Error"]["Code"] == "403"
    else:
        raise AssertionError("Expected ensure_bucket_exists to raise ClientError")


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
