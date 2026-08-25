from __future__ import annotations
# pyright: reportMissingImports=false

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Patient, StaffPatientAssignment, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-gallery-api",
        app_env="test",
        model_url="https://example.com/model.pt",
        model_path=Path("/tmp/model.pt"),
        model_cache_dir=Path("/tmp"),
        model_timeout_seconds=5.0,
        device="cpu",
        model_backbone="mobilenet_v3_large",
        model_arch="baseline",
        transfer_dropout=0.4,
        threshold=0.5,
        image_size=384,
        infection_class_index=4,
        class_names=("class_0", "class_1", "class_2", "class_3", "class_4"),
        max_upload_mb=10,
        log_level="INFO",
        accepted_content_types=("image/jpeg", "image/png"),
        cors_allowed_origins=("http://localhost:3000",),
        cors_allowed_origin_regex=r"^https?://(?:\d{1,3}\.){3}\d{1,3}:3000$",
        workers=1,
        eval_hflip_tta=False,
        database_url=migrated_sqlite_database_url(db_path),
        s3_endpoint_url="http://localhost:8333",
        s3_region="us-east-1",
        s3_access_key="seaweed-access",
        s3_secret_key="seaweed-secret",
        s3_bucket_name="pd-care-private",
        image_access_token_secret="test-secret",
        image_access_token_ttl_seconds=300,
        line_verify_mode="stub",
    )


class _FakeStorageService:
    def generate_access_token(self, object_key: str, subject: str, ttl_seconds: int) -> str:
        return f"{subject}:{object_key}:{ttl_seconds}"

    def validate_access_token(self, token: str, object_key: str, subject: str) -> bool:
        return token.startswith(f"{subject}:{object_key}:")

    def open_image_stream(self, object_key: str):
        return io.BytesIO(b"fake-image-bytes")


def _attach_storage(client: TestClient) -> None:
    client.app.state.storage_service = _FakeStorageService()


def _seed_matched_identity(client: TestClient, line_user_id: str = "U_GALLERY_PATIENT") -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="G111111", birth_date="1981-01-01", full_name="Gallery Patient", is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Gallery Patient",
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        session.commit()
        return patient.id


def _issue_token_for_line_user(client: TestClient, *, line_user_id: str, role: str = "patient") -> str:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == line_user_id).one()
    token_service = AuthTokenService(secret=client.app.state.settings.auth_token_secret)
    return token_service.issue_token(
        identity_id=identity.id,
        line_user_id=identity.line_user_id,
        role=role,
        patient_id=identity.patient_id,
        ttl_seconds=client.app.state.settings.auth_token_ttl_seconds,
    )


def _add_upload(
    session,
    *,
    patient_id: int,
    object_key: str,
    created_at: datetime,
    screening_result: str | None,
    symptom_pain: bool = False,
    symptom_pus: bool = False,
    symptom_cloudy_dialysate: bool = False,
) -> Upload:
    upload = Upload(
        patient_id=patient_id,
        object_key=object_key,
        content_type="image/jpeg",
        symptom_pain=symptom_pain,
        symptom_pus=symptom_pus,
        symptom_cloudy_dialysate=symptom_cloudy_dialysate,
        created_at=created_at,
    )
    session.add(upload)
    session.flush()
    if screening_result is not None:
        session.add(AIResult(upload_id=upload.id, screening_result=screening_result))
    return upload


def test_gallery_uploads_newest_page_is_chronological_and_excludes_rejected(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "gallery-newest.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client)
        token = _issue_token_for_line_user(client, line_user_id="U_GALLERY_PATIENT")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            base = datetime(2026, 5, 10, 4, 0, tzinfo=timezone.utc)
            oldest = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/g1.jpg",
                created_at=base,
                screening_result="normal",
            )
            rejected = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/g-rejected.jpg",
                created_at=base + timedelta(hours=1),
                screening_result="rejected",
            )
            mid = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/g2.jpg",
                created_at=base + timedelta(hours=2),
                screening_result="suspected",
            )
            newest = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/g3.jpg",
                created_at=base + timedelta(hours=3),
                screening_result="normal",
            )
            session.commit()
            oldest_id, rejected_id, mid_id, newest_id = oldest.id, rejected.id, mid.id, newest.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/gallery/uploads?limit=2",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["limit"] == 2
        assert payload["has_more_older"] is True
        assert [item["upload_id"] for item in payload["items"]] == [mid_id, newest_id]
        assert payload["items"][0]["date"] == "2026-05-10"
        assert payload["items"][0]["has_suspected_risk"] is True
        assert payload["items"][1]["has_suspected_risk"] is False
        assert payload["items"][1]["image_url"].startswith(
            f"/api/v1/patient/uploads/{newest_id}/image-public?token=patient:"
        )
        assert rejected_id not in {item["upload_id"] for item in payload["items"]}
        assert oldest_id not in {item["upload_id"] for item in payload["items"]}


def test_gallery_uploads_before_id_returns_older_page(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "gallery-before.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_GALLERY_BEFORE")
        token = _issue_token_for_line_user(client, line_user_id="U_GALLERY_BEFORE")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            base = datetime(2026, 5, 10, 4, 0, tzinfo=timezone.utc)
            first = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/older.jpg",
                created_at=base,
                screening_result="normal",
            )
            second = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/mid.jpg",
                created_at=base + timedelta(hours=1),
                screening_result="normal",
            )
            newest = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/newest.jpg",
                created_at=base + timedelta(hours=2),
                screening_result="normal",
            )
            session.commit()
            first_id, second_id, newest_id = first.id, second.id, newest.id

        _attach_storage(client)
        first_page = client.get(
            "/v1/patient/gallery/uploads?limit=1",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert [item["upload_id"] for item in first_page["items"]] == [newest_id]

        older = client.get(
            f"/v1/patient/gallery/uploads?before_id={newest_id}&limit=1",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert older.status_code == 200
        older_payload = older.json()
        assert [item["upload_id"] for item in older_payload["items"]] == [second_id]
        assert older_payload["has_more_older"] is True

        oldest = client.get(
            f"/v1/patient/gallery/uploads?before_id={second_id}&limit=1",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert [item["upload_id"] for item in oldest["items"]] == [first_id]
        assert oldest["has_more_older"] is False


def test_gallery_month_covers_match_staff_pick_rule_and_skip_rejected(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "gallery-month.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_GALLERY_MONTH")
        token = _issue_token_for_line_user(client, line_user_id="U_GALLERY_MONTH")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            april = datetime(2026, 4, 30, 4, 0, tzinfo=timezone.utc)
            may_day = datetime(2026, 5, 8, 2, 0, tzinfo=timezone.utc)
            _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/april.jpg",
                created_at=april,
                screening_result="normal",
            )
            earlier_normal = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/may-normal.jpg",
                created_at=may_day,
                screening_result="normal",
            )
            suspected = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/may-suspected.jpg",
                created_at=may_day + timedelta(hours=1),
                screening_result="suspected",
            )
            earlier_elevated = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/may-elevated-1.jpg",
                created_at=may_day + timedelta(days=1),
                screening_result="normal",
                symptom_pain=True,
            )
            _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/may-elevated-2.jpg",
                created_at=may_day + timedelta(days=1, hours=2),
                screening_result="normal",
                symptom_pus=True,
            )
            later_normal = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/may-latest.jpg",
                created_at=may_day + timedelta(days=2, hours=3),
                screening_result="normal",
            )
            _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/may-rejected.jpg",
                created_at=may_day + timedelta(days=3),
                screening_result="rejected",
            )
            _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/june.jpg",
                created_at=datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc),
                screening_result="normal",
            )
            session.commit()
            suspected_id = suspected.id
            elevated_id = earlier_elevated.id
            latest_normal_id = later_normal.id
            unused_normal_id = earlier_normal.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/gallery/months?month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["month"] == "2026-05"
        assert payload["has_more_older"] is True
        days = {day["date"]: day for day in payload["days"]}
        assert set(days) == {"2026-05-08", "2026-05-09", "2026-05-10"}
        assert days["2026-05-08"]["representative_upload_id"] == suspected_id
        assert days["2026-05-08"]["has_suspected_risk"] is True
        assert days["2026-05-09"]["representative_upload_id"] == elevated_id
        assert days["2026-05-09"]["has_symptom_elevated_risk"] is True
        assert days["2026-05-10"]["representative_upload_id"] == latest_normal_id
        assert unused_normal_id != suspected_id
        assert days["2026-05-08"]["representative_image_url"].startswith(
            f"/api/v1/patient/uploads/{suspected_id}/image-public?token=patient:"
        )

        april_payload = client.get(
            "/v1/patient/gallery/months?month=2026-04",
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        assert april_payload["has_more_older"] is False
        assert [day["date"] for day in april_payload["days"]] == ["2026-04-30"]


def test_staff_gallery_uses_staff_image_urls(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "gallery-staff.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_GALLERY_STAFF_PATIENT")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            staff = LiffIdentity(line_user_id="U_GALLERY_STAFF", display_name="Staff", role="staff")
            session.add(staff)
            session.flush()
            session.add(StaffPatientAssignment(staff_identity_id=staff.id, patient_id=patient_id))
            upload = _add_upload(
                session,
                patient_id=patient_id,
                object_key="patients/1/uploads/staff.jpg",
                created_at=datetime(2026, 5, 10, 4, 0, tzinfo=timezone.utc),
                screening_result="normal",
            )
            session.commit()
            upload_id = upload.id

        staff_token = _issue_token_for_line_user(client, line_user_id="U_GALLERY_STAFF", role="staff")
        _attach_storage(client)
        headers = {"Authorization": f"Bearer {staff_token}"}
        uploads = client.get(f"/v1/staff/patients/{patient_id}/gallery/uploads", headers=headers)
        assert uploads.status_code == 200
        item = uploads.json()["items"][0]
        assert item["upload_id"] == upload_id
        assert item["image_url"].startswith(f"/api/v1/staff/uploads/{upload_id}/image-public?token=staff:")

        month = client.get(
            f"/v1/staff/patients/{patient_id}/gallery/months?month=2026-05",
            headers=headers,
        )
        assert month.status_code == 200
        day = month.json()["days"][0]
        assert day["representative_upload_id"] == upload_id
        assert day["representative_image_url"].startswith(
            f"/api/v1/staff/uploads/{upload_id}/image-public?token=staff:"
        )
