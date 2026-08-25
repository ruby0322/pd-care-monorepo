from __future__ import annotations
# pyright: reportMissingImports=false

import io
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy.dialects import sqlite

from app.config import Settings
from app.db.models import AIResult, Annotation, LiffIdentity, Patient, PendingBinding, StaffPatientAssignment, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService
from app.services.upload_history import _patient_upload_date_counts_stmt
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-upload-history-api",
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
    )


def _seed_matched_identity(
    client: TestClient,
    line_user_id: str = "U_LINE_MATCHED",
    *,
    case_number: str = "P111111",
    birth_date: str = "1981-01-01",
    role: str = "patient",
) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number=case_number, birth_date=birth_date, full_name="Patient A", is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Patient A",
                picture_url=None,
                patient_id=patient.id,
                role=role,
            )
        )
        session.commit()
        return patient.id


def _seed_pending_identity(client: TestClient, line_user_id: str = "U_LINE_PENDING") -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name="Pending Patient",
                picture_url=None,
                patient_id=None,
            )
        )
        session.add(
            PendingBinding(
                line_user_id=line_user_id,
                case_number="P999999",
                birth_date="1970-05-08",
                status="pending",
            )
        )
        session.commit()


def _seed_upload_history(client: TestClient, patient_id: int) -> tuple[int, int, int]:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        base = datetime(2026, 5, 9, 2, 30, tzinfo=timezone.utc)
        first_day = base - timedelta(days=1)

        upload_1 = Upload(
            patient_id=patient_id,
            object_key="patients/1/uploads/u1.jpg",
            content_type="image/jpeg",
            symptom_pain=False,
            symptom_discharge=True,
            symptom_pus=False,
            created_at=first_day,
        )
        upload_2 = Upload(
            patient_id=patient_id,
            object_key="patients/1/uploads/u2.jpg",
            content_type="image/jpeg",
            symptom_pain=True,
            symptom_discharge=True,
            symptom_pus=True,
            created_at=first_day + timedelta(hours=2),
        )
        upload_3 = Upload(
            patient_id=patient_id,
            object_key="patients/1/uploads/u3.jpg",
            content_type="image/jpeg",
            symptom_pain=False,
            symptom_discharge=False,
            symptom_pus=False,
            created_at=base,
        )
        session.add_all([upload_1, upload_2, upload_3])
        session.flush()

        session.add_all(
            [
                AIResult(upload_id=upload_1.id, screening_result="normal"),
                AIResult(upload_id=upload_2.id, screening_result="suspected"),
                AIResult(upload_id=upload_3.id, screening_result="normal"),
            ]
        )
        session.commit()
        return upload_1.id, upload_2.id, upload_3.id


def _attach_storage(client: TestClient) -> None:
    client.app.state.storage_service = _FakeStorageService()


def _signed_history_day(
    *,
    date: str,
    upload_count: int,
    has_suspected_risk: bool,
    has_symptom_elevated_risk: bool,
    representative_upload_id: int,
    object_key: str,
    ttl_seconds: int = 300,
) -> dict:
    token = f"patient:{object_key}:{ttl_seconds}"
    return {
        "date": date,
        "upload_count": upload_count,
        "has_suspected_risk": has_suspected_risk,
        "has_symptom_elevated_risk": has_symptom_elevated_risk,
        "representative_upload_id": representative_upload_id,
        "representative_image_url": (
            f"/api/v1/patient/uploads/{representative_upload_id}/image-public?token={token}"
        ),
        "representative_image_expires_in": ttl_seconds,
    }


class _FakeStorageService:
    def __init__(self) -> None:
        self._store: dict[str, bytes] = {}

    def generate_access_token(self, object_key: str, subject: str, ttl_seconds: int) -> str:
        return f"{subject}:{object_key}:{ttl_seconds}"

    def validate_access_token(self, token: str, object_key: str, subject: str) -> bool:
        return token.startswith(f"{subject}:{object_key}:")

    def open_image_stream(self, object_key: str):
        return io.BytesIO(self._store.get(object_key, b"fake-image-bytes"))


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


def test_upload_history_returns_aggregated_days_for_matched_patient(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-matched.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_HISTORY")
        _, upload_2_id, upload_3_id = _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_HISTORY")
        _attach_storage(client)

        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["patient_id"] == patient_id
        assert payload["can_upload"] is True
        assert payload["days"] == [
            _signed_history_day(
                date="2026-05-08",
                upload_count=2,
                has_suspected_risk=True,
                has_symptom_elevated_risk=False,
                representative_upload_id=upload_2_id,
                object_key="patients/1/uploads/u2.jpg",
            ),
            _signed_history_day(
                date="2026-05-09",
                upload_count=1,
                has_suspected_risk=False,
                has_symptom_elevated_risk=False,
                representative_upload_id=upload_3_id,
                object_key="patients/1/uploads/u3.jpg",
            ),
        ]
        assert payload["summary"]["continuous_upload_streak_days"] >= 0


def test_upload_history_window_filters_days_and_keeps_lifetime_streak(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-month-window.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_WINDOW")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_WINDOW")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            january = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/jan.jpg",
                content_type="image/jpeg",
                created_at=datetime(2026, 1, 15, 4, 0, tzinfo=timezone.utc),
            )
            march = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/mar.jpg",
                content_type="image/jpeg",
                created_at=datetime(2026, 3, 10, 4, 0, tzinfo=timezone.utc),
            )
            today_upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/today.jpg",
                content_type="image/jpeg",
                created_at=datetime.now(tz=timezone.utc) - timedelta(minutes=5),
            )
            session.add_all([january, march, today_upload])
            session.flush()
            session.add_all(
                [
                    AIResult(upload_id=january.id, screening_result="normal"),
                    AIResult(upload_id=march.id, screening_result="normal"),
                    AIResult(upload_id=today_upload.id, screening_result="normal"),
                ]
            )
            session.commit()
            march_id = march.id

        _attach_storage(client)
        windowed = client.get(
            "/v1/patient/upload-history",
            params={"month_start": "2026-03", "month_end": "2026-03"},
            headers={"Authorization": f"Bearer {token}"},
        )
        unwindowed = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert windowed.status_code == 200
        assert unwindowed.status_code == 200
        windowed_payload = windowed.json()
        unwindowed_payload = unwindowed.json()
        assert [day["date"] for day in windowed_payload["days"]] == ["2026-03-10"]
        assert windowed_payload["days"][0]["representative_upload_id"] == march_id
        assert {day["date"] for day in unwindowed_payload["days"]} >= {"2026-01-15", "2026-03-10"}
        assert windowed_payload["summary"]["continuous_upload_streak_days"] == 1
        assert (
            windowed_payload["summary"]["continuous_upload_streak_days"]
            == unwindowed_payload["summary"]["continuous_upload_streak_days"]
        )


def test_upload_history_window_can_omit_lifetime_summary(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-month-window-no-summary.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_WINDOW_NO_SUMMARY")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_WINDOW_NO_SUMMARY")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            march = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/mar.jpg",
                content_type="image/jpeg",
                created_at=datetime(2026, 3, 10, 4, 0, tzinfo=timezone.utc),
            )
            today_upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/today.jpg",
                content_type="image/jpeg",
                created_at=datetime.now(tz=timezone.utc) - timedelta(minutes=5),
            )
            session.add_all([march, today_upload])
            session.flush()
            session.add_all(
                [
                    AIResult(upload_id=march.id, screening_result="normal"),
                    AIResult(upload_id=today_upload.id, screening_result="normal"),
                ]
            )
            session.commit()
            march_id = march.id

        _attach_storage(client)
        omitted = client.get(
            "/v1/patient/upload-history",
            params={
                "month_start": "2026-03",
                "month_end": "2026-03",
                "include_summary": "false",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        included = client.get(
            "/v1/patient/upload-history",
            params={"month_start": "2026-03", "month_end": "2026-03"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert omitted.status_code == 200
        assert included.status_code == 200
        omitted_payload = omitted.json()
        assert [day["date"] for day in omitted_payload["days"]] == ["2026-03-10"]
        assert omitted_payload["days"][0]["representative_upload_id"] == march_id
        assert omitted_payload["summary"]["continuous_upload_streak_days"] == 0
        assert included.json()["summary"]["continuous_upload_streak_days"] == 1


def test_upload_history_rejects_invalid_month_window(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-month-window-invalid.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_matched_identity(client, line_user_id="U_LINE_WINDOW_BAD")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_WINDOW_BAD")

        missing_end = client.get(
            "/v1/patient/upload-history",
            params={"month_start": "2026-03"},
            headers={"Authorization": f"Bearer {token}"},
        )
        inverted = client.get(
            "/v1/patient/upload-history",
            params={"month_start": "2026-05", "month_end": "2026-03"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert missing_end.status_code == 400
        assert inverted.status_code == 400


def test_upload_history_returns_pending_status_without_day_data(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_pending_identity(client)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PENDING")

        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "pending"
        assert payload["patient_id"] is None
        assert payload["can_upload"] is False
        assert payload["days"] == []
        assert payload["summary"] == {
            "continuous_upload_streak_days": 0,
        }


def test_upload_history_returns_unbound_status_without_day_data(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-unbound.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        response = client.get("/v1/patient/upload-history")
        assert response.status_code == 401


def test_upload_history_groups_by_taipei_local_date_boundary(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-timezone-boundary.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_TZ_BOUNDARY")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_TZ_BOUNDARY")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            # 17:10 UTC is next day in Asia/Taipei (+08:00).
            upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/tz-boundary.jpg",
                content_type="image/jpeg",
                created_at=datetime(2026, 5, 10, 17, 10, tzinfo=timezone.utc),
            )
            session.add(upload)
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result="normal"))
            session.commit()
            upload_id = upload.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["days"] == [
            _signed_history_day(
                date="2026-05-11",
                upload_count=1,
                has_suspected_risk=False,
                has_symptom_elevated_risk=False,
                representative_upload_id=upload_id,
                object_key="patients/1/uploads/tz-boundary.jpg",
            ),
        ]


def test_patient_profile_returns_basic_profile_and_line_avatar(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-profile.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_PROFILE")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PROFILE")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == "U_LINE_PROFILE").one()
            identity.picture_url = "https://example.com/avatar.jpg"
            session.commit()

        response = client.get(
            "/v1/patient/profile",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["can_upload"] is True
        assert payload["line_user_id"] == "U_LINE_PROFILE"
        assert payload["display_name"] == "Patient A"
        assert payload["picture_url"] == "https://example.com/avatar.jpg"
        assert payload["patient_id"] == patient_id
        assert payload["case_number"] == "P111111"
        assert payload["birth_date"] == "1981-01-01"
        assert payload["longest_continuous_upload_streak_days"] == 0
        assert payload["total_upload_count"] == 0
        assert payload["primary_nurse_name"] is None


def test_patient_profile_returns_assigned_nurse_real_name_not_line_display_name(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-profile-nurse.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_PROFILE_NURSE")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PROFILE_NURSE")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            nurse = LiffIdentity(
                line_user_id="U_LINE_NURSE_ASSIGNEE",
                display_name="LINE Nickname",
                real_name="鄭靜誼",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(nurse)
            session.flush()
            session.add(StaffPatientAssignment(staff_identity_id=nurse.id, patient_id=patient_id))
            session.commit()

        response = client.get(
            "/v1/patient/profile",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["primary_nurse_name"] == "鄭靜誼"


def test_patient_profile_omits_nurse_name_when_assignee_has_only_line_display_name(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-profile-nurse-line-only.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_PROFILE_NURSE_LINE")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PROFILE_NURSE_LINE")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            nurse = LiffIdentity(
                line_user_id="U_LINE_NURSE_LINE_ONLY",
                display_name="LINE Nickname",
                real_name=None,
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(nurse)
            session.flush()
            session.add(StaffPatientAssignment(staff_identity_id=nurse.id, patient_id=patient_id))
            session.commit()

        response = client.get(
            "/v1/patient/profile",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["primary_nurse_name"] is None


def test_upload_history_summary_counts_staff_annotation_as_suspected(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-summary-annotation.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_SUMMARY_ANNOTATION")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_SUMMARY_ANNOTATION")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/summary-annotation.jpg",
                content_type="image/jpeg",
                created_at=datetime.now(tz=timezone.utc),
            )
            reviewer = LiffIdentity(
                line_user_id="U_LINE_REVIEWER",
                display_name="Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add_all([upload, reviewer])
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result="normal"))
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=upload.id,
                    reviewer_identity_id=reviewer.id,
                    label="confirmed_infection",
                    comment="clinical confirmation",
                )
            )
            session.commit()
            upload_id = upload.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["days"] == [
            _signed_history_day(
                date=datetime.now(tz=timezone.utc).astimezone(timezone(timedelta(hours=8))).date().isoformat(),
                upload_count=1,
                has_suspected_risk=True,
                has_symptom_elevated_risk=False,
                representative_upload_id=upload_id,
                object_key="patients/1/uploads/summary-annotation.jpg",
            )
        ]
        assert payload["summary"]["continuous_upload_streak_days"] == 1


def test_upload_history_excludes_rejected_from_summary_and_daily_counts(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-summary-rejected-excluded.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_SUMMARY_REJECTED")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_SUMMARY_REJECTED")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            now_utc = datetime.now(tz=timezone.utc)
            upload_suspected = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/summary-suspected.jpg",
                content_type="image/jpeg",
                created_at=now_utc - timedelta(minutes=5),
            )
            upload_rejected = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/summary-rejected.jpg",
                content_type="image/jpeg",
                created_at=now_utc,
            )
            session.add_all([upload_suspected, upload_rejected])
            session.flush()
            session.add_all(
                [
                    AIResult(upload_id=upload_suspected.id, screening_result="suspected"),
                    AIResult(upload_id=upload_rejected.id, screening_result="rejected"),
                ]
            )
            session.commit()
            suspected_upload_id = upload_suspected.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert len(payload["days"]) == 1
        assert payload["days"][0]["upload_count"] == 1
        assert payload["days"][0]["has_suspected_risk"] is True
        assert payload["days"][0]["has_symptom_elevated_risk"] is False
        assert payload["days"][0]["representative_upload_id"] == suspected_upload_id
        assert payload["days"][0]["representative_image_url"].startswith(
            f"/api/v1/patient/uploads/{suspected_upload_id}/image-public?token="
        )
        assert payload["summary"]["continuous_upload_streak_days"] == 1


def test_upload_history_counts_unscored_uploads_on_calendar_streak_and_profile_total(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-unscored-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_UNSCORED")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_UNSCORED")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/pending.jpg",
                content_type="image/jpeg",
                created_at=datetime.now(tz=timezone.utc),
            )
            session.add(upload)
            session.commit()
            upload_id = upload.id

        _attach_storage(client)
        history = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        profile = client.get(
            "/v1/patient/profile",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert history.status_code == 200
        assert profile.status_code == 200
        payload = history.json()
        assert payload["days"] == [
            _signed_history_day(
                date=datetime.now(tz=timezone.utc).astimezone(timezone(timedelta(hours=8))).date().isoformat(),
                upload_count=1,
                has_suspected_risk=False,
                has_symptom_elevated_risk=False,
                representative_upload_id=upload_id,
                object_key="patients/1/uploads/pending.jpg",
            )
        ]
        assert payload["summary"]["continuous_upload_streak_days"] == 1
        assert profile.json()["total_upload_count"] == 1
        assert profile.json()["longest_continuous_upload_streak_days"] == 1


def test_patient_uploads_by_day_returns_day_scoped_records(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-by-day.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_BY_DAY")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_BY_DAY")

        response = client.get(
            "/v1/patient/uploads/by-day",
            params={"date": "2026-05-08"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["date"] == "2026-05-08"
        assert len(payload["items"]) == 2
        assert payload["items"][0]["upload_id"] < payload["items"][1]["upload_id"]
        assert payload["items"][0]["symptom_pain"] is False
        assert payload["items"][0]["symptom_discharge"] is True
        assert payload["items"][0]["symptom_pus"] is False
        assert payload["items"][0]["symptom_cloudy_dialysate"] is False
        assert payload["items"][0]["has_high_risk_symptoms"] is False
        assert payload["items"][0]["symptom_aware_priority"] == "normal"
        assert payload["items"][1]["symptom_pain"] is True
        assert payload["items"][1]["symptom_discharge"] is True
        assert payload["items"][1]["symptom_pus"] is True
        assert payload["items"][1]["has_high_risk_symptoms"] is True
        assert payload["items"][1]["symptom_aware_priority"] == "suspected"


def test_patient_upload_detail_returns_prev_next_and_latest_annotation(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-detail.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_DETAIL")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_DETAIL")
        client.app.state.storage_service = _FakeStorageService()

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            uploads = session.query(Upload).filter(Upload.patient_id == patient_id).order_by(Upload.created_at.asc()).all()
            reviewer = LiffIdentity(
                line_user_id="U_LINE_DETAIL_REVIEWER",
                display_name="Detail Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(reviewer)
            session.flush()
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=uploads[1].id,
                    reviewer_identity_id=reviewer.id,
                    label="suspected",
                    comment="needs follow-up",
                )
            )
            session.commit()
            target_upload_id = uploads[1].id

        response = client.get(
            f"/v1/patient/uploads/{target_upload_id}/detail",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["upload_id"] == target_upload_id
        assert payload["annotation_label"] == "suspected"
        assert payload["annotation_comment"] == "needs follow-up"
        assert payload["symptom_pain"] is True
        assert payload["symptom_discharge"] is True
        assert payload["symptom_pus"] is True
        assert payload["symptom_cloudy_dialysate"] is False
        assert payload["has_high_risk_symptoms"] is True
        assert payload["symptom_aware_priority"] == "suspected"
        assert payload["prev_upload_id"] is not None
        assert payload["next_upload_id"] is None
        assert payload["image_url"].startswith(f"/api/v1/patient/uploads/{target_upload_id}/image-public?token=")


def test_patient_upload_detail_rejects_other_patient_access(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-detail-forbidden.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_a = _seed_matched_identity(client, line_user_id="U_LINE_DETAIL_OWNER")
        patient_b = _seed_matched_identity(
            client,
            line_user_id="U_LINE_DETAIL_OTHER",
            case_number="P222222",
            birth_date="1985-08-17",
        )
        assert patient_a != patient_b
        _seed_upload_history(client, patient_id=patient_a)
        owner_token = _issue_token_for_line_user(client, line_user_id="U_LINE_DETAIL_OWNER")
        other_token = _issue_token_for_line_user(client, line_user_id="U_LINE_DETAIL_OTHER")

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            target_upload = (
                session.query(Upload).filter(Upload.patient_id == patient_a).order_by(Upload.created_at.asc()).first()
            )
            assert target_upload is not None
            target_upload_id = target_upload.id

        owner_response = client.get(
            f"/v1/patient/uploads/{target_upload_id}/detail",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert owner_response.status_code == 200

        forbidden_response = client.get(
            f"/v1/patient/uploads/{target_upload_id}/detail",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert forbidden_response.status_code == 404


def test_patient_messages_returns_latest_annotations_with_unread_filter(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-messages.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_MESSAGES")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_MESSAGES")
        client.app.state.storage_service = _FakeStorageService()
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            uploads = session.query(Upload).filter(Upload.patient_id == patient_id).order_by(Upload.created_at.desc()).all()
            reviewer = LiffIdentity(
                line_user_id="U_LINE_MESSAGES_REVIEWER",
                display_name="Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(reviewer)
            session.flush()
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=uploads[0].id,
                    reviewer_identity_id=reviewer.id,
                    label="suspected",
                    comment="new unread annotation",
                )
            )
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=uploads[1].id,
                    reviewer_identity_id=reviewer.id,
                    label="normal",
                    comment="already read annotation",
                    patient_read_at=datetime.now(tz=timezone.utc),
                )
            )
            session.commit()

        unread_only_response = client.get(
            "/v1/patient/messages",
            params={"limit": 10, "offset": 0, "unread_only": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert unread_only_response.status_code == 200
        unread_payload = unread_only_response.json()
        assert unread_payload["unread_count"] == 1
        assert unread_payload["total"] == 2
        assert len(unread_payload["items"]) == 1
        assert unread_payload["items"][0]["is_read"] is False
        assert unread_payload["items"][0]["image_url"].startswith("/api/v1/patient/uploads/")


def test_patient_message_mark_read_updates_read_state(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-messages-read.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_MESSAGES_READ")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_MESSAGES_READ")
        client.app.state.storage_service = _FakeStorageService()
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            upload = session.query(Upload).filter(Upload.patient_id == patient_id).order_by(Upload.created_at.desc()).first()
            assert upload is not None
            reviewer = LiffIdentity(
                line_user_id="U_LINE_MESSAGES_READ_REVIEWER",
                display_name="Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(reviewer)
            session.flush()
            annotation = Annotation(
                patient_id=patient_id,
                upload_id=upload.id,
                reviewer_identity_id=reviewer.id,
                label="suspected",
                comment="mark as read target",
            )
            session.add(annotation)
            session.commit()
            session.refresh(annotation)
            annotation_id = annotation.id

        response = client.post(
            f"/v1/patient/messages/{annotation_id}/read",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["annotation_id"] == annotation_id
        assert payload["is_read"] is True

        unread_after = client.get(
            "/v1/patient/messages",
            params={"unread_only": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert unread_after.status_code == 200
        unread_payload = unread_after.json()
        assert unread_payload["unread_count"] == 0


def test_patient_message_mark_all_read_updates_all_unread(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-messages-read-all.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_MESSAGES_READ_ALL")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_MESSAGES_READ_ALL")
        client.app.state.storage_service = _FakeStorageService()
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            uploads = session.query(Upload).filter(Upload.patient_id == patient_id).order_by(Upload.created_at.desc()).all()
            reviewer = LiffIdentity(
                line_user_id="U_LINE_MESSAGES_READ_ALL_REVIEWER",
                display_name="Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(reviewer)
            session.flush()
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=uploads[0].id,
                    reviewer_identity_id=reviewer.id,
                    label="suspected",
                    comment="unread one",
                )
            )
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=uploads[1].id,
                    reviewer_identity_id=reviewer.id,
                    label="normal",
                    comment="unread two",
                )
            )
            session.commit()

        response = client.post(
            "/v1/patient/messages/read-all",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["updated_count"] == 2
        assert payload["unread_count"] == 0

        unread_after = client.get(
            "/v1/patient/messages",
            params={"unread_only": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert unread_after.status_code == 200
        unread_payload = unread_after.json()
        assert unread_payload["unread_count"] == 0


def test_staff_with_bound_patient_can_access_patient_messages(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-messages-staff-role.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_MESSAGES_STAFF", role="staff")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_MESSAGES_STAFF", role="staff")
        client.app.state.storage_service = _FakeStorageService()
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            upload = session.query(Upload).filter(Upload.patient_id == patient_id).order_by(Upload.created_at.desc()).first()
            assert upload is not None
            reviewer = LiffIdentity(
                line_user_id="U_LINE_MESSAGES_STAFF_REVIEWER",
                display_name="Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add(reviewer)
            session.flush()
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=upload.id,
                    reviewer_identity_id=reviewer.id,
                    label="suspected",
                    comment="visible for staff role with patient binding",
                )
            )
            session.commit()

        response = client.get(
            "/v1/patient/messages",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1


def test_upload_history_marks_symptom_elevated_day_and_counts_rate(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-elevated.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_ELEVATED")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_ELEVATED")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/elevated.jpg",
                content_type="image/jpeg",
                created_at=datetime.now(tz=timezone.utc),
                symptom_pain=True,
            )
            session.add(upload)
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result="normal"))
            session.commit()
            upload_id = upload.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["days"] == [
            _signed_history_day(
                date=datetime.now(tz=timezone.utc).astimezone(timezone(timedelta(hours=8))).date().isoformat(),
                upload_count=1,
                has_suspected_risk=False,
                has_symptom_elevated_risk=True,
                representative_upload_id=upload_id,
                object_key="patients/1/uploads/elevated.jpg",
            )
        ]
        assert payload["summary"]["continuous_upload_streak_days"] == 1


def test_upload_history_elevated_cleared_when_annotated_normal(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-elevated-cleared.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_ELEVATED_CLEAR")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_ELEVATED_CLEAR")
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            upload = Upload(
                patient_id=patient_id,
                object_key="patients/1/uploads/elevated-clear.jpg",
                content_type="image/jpeg",
                created_at=datetime.now(tz=timezone.utc),
                symptom_pus=True,
            )
            reviewer = LiffIdentity(
                line_user_id="U_LINE_ELEVATED_CLEAR_REVIEWER",
                display_name="Reviewer",
                picture_url=None,
                patient_id=None,
                role="staff",
            )
            session.add_all([upload, reviewer])
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result="normal"))
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=upload.id,
                    reviewer_identity_id=reviewer.id,
                    label="normal",
                    comment="false alarm",
                )
            )
            session.commit()
            upload_id = upload.id

        _attach_storage(client)
        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["days"] == [
            _signed_history_day(
                date=datetime.now(tz=timezone.utc).astimezone(timezone(timedelta(hours=8))).date().isoformat(),
                upload_count=1,
                has_suspected_risk=False,
                has_symptom_elevated_risk=False,
                representative_upload_id=upload_id,
                object_key="patients/1/uploads/elevated-clear.jpg",
            )
        ]
        assert payload["summary"]["continuous_upload_streak_days"] == 1


def _taipei_today() -> date:
    return datetime.now(tz=timezone.utc).astimezone(timezone(timedelta(hours=8))).date()


def _taipei_noon(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=timezone(timedelta(hours=8)))


def _add_qualified_upload(
    session,
    *,
    patient_id: int,
    day: date,
    suffix: str,
    screening_result: str = "normal",
) -> None:
    upload = Upload(
        patient_id=patient_id,
        object_key=f"patients/{patient_id}/uploads/{suffix}.jpg",
        content_type="image/jpeg",
        created_at=_taipei_noon(day),
    )
    session.add(upload)
    session.flush()
    session.add(AIResult(upload_id=upload.id, screening_result=screening_result))


def test_upload_history_current_streak_is_not_capped_at_28_days(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-streak-uncapped.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_STREAK_30")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_STREAK_30")
        today = _taipei_today()
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            for offset in range(30):
                _add_qualified_upload(
                    session,
                    patient_id=patient_id,
                    day=today - timedelta(days=offset),
                    suffix=f"streak-{offset}",
                )
            session.commit()

        _attach_storage(client)
        response = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["summary"]["continuous_upload_streak_days"] == 30


def test_lifetime_metrics_query_aggregates_counts_by_taipei_date() -> None:
    stmt = _patient_upload_date_counts_stmt(
        patient_id=1,
        dialect_name="sqlite",
        local_today=date(2026, 8, 25),
    )
    sql = str(stmt.compile(dialect=sqlite.dialect(), compile_kwargs={"literal_binds": True})).lower()
    assert "group by" in sql
    assert "datetime" in sql


def test_patient_profile_reports_longest_streak_and_total_upload_count(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "profile-lifetime-metrics.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_PROFILE_METRICS")
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PROFILE_METRICS")
        today = _taipei_today()
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            for offset in range(10):
                _add_qualified_upload(
                    session,
                    patient_id=patient_id,
                    day=today - timedelta(days=15 + offset),
                    suffix=f"long-{offset}",
                )
            for offset in range(3):
                _add_qualified_upload(
                    session,
                    patient_id=patient_id,
                    day=today - timedelta(days=offset),
                    suffix=f"current-{offset}",
                )
            _add_qualified_upload(
                session,
                patient_id=patient_id,
                day=today,
                suffix="rejected-today",
                screening_result="rejected",
            )
            session.commit()

        _attach_storage(client)
        history = client.get(
            "/v1/patient/upload-history",
            headers={"Authorization": f"Bearer {token}"},
        )
        profile = client.get(
            "/v1/patient/profile",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert history.status_code == 200
        assert profile.status_code == 200
        assert history.json()["summary"]["continuous_upload_streak_days"] == 3
        assert profile.json()["longest_continuous_upload_streak_days"] == 10
        assert profile.json()["total_upload_count"] == 13
