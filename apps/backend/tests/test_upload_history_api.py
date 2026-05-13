from __future__ import annotations
# pyright: reportMissingImports=false

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, Annotation, LiffIdentity, Patient, PendingBinding, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService


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
        database_url=f"sqlite+pysqlite:///{db_path}",
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


def _seed_upload_history(client: TestClient, patient_id: int) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        base = datetime(2026, 5, 9, 2, 30, tzinfo=timezone.utc)
        first_day = base - timedelta(days=1)

        upload_1 = Upload(
            patient_id=patient_id,
            object_key="patients/1/uploads/u1.jpg",
            content_type="image/jpeg",
            created_at=first_day,
        )
        upload_2 = Upload(
            patient_id=patient_id,
            object_key="patients/1/uploads/u2.jpg",
            content_type="image/jpeg",
            created_at=first_day + timedelta(hours=2),
        )
        upload_3 = Upload(
            patient_id=patient_id,
            object_key="patients/1/uploads/u3.jpg",
            content_type="image/jpeg",
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
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_HISTORY")

        response = client.get(
            "/v1/patient/upload-history",
            params={"line_user_id": "U_LINE_HISTORY"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["patient_id"] == patient_id
        assert payload["can_upload"] is True
        assert payload["days"] == [
            {"date": "2026-05-08", "upload_count": 2, "has_suspected_risk": True},
            {"date": "2026-05-09", "upload_count": 1, "has_suspected_risk": False},
        ]
        assert payload["summary_28d"]["all_upload_count_28d"] >= 0
        assert payload["summary_28d"]["suspected_upload_count_28d"] >= 0
        assert payload["summary_28d"]["continuous_upload_streak_days"] >= 0


def test_upload_history_returns_pending_status_without_day_data(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_pending_identity(client)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_PENDING")

        response = client.get(
            "/v1/patient/upload-history",
            params={"line_user_id": "U_LINE_PENDING"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "pending"
        assert payload["patient_id"] is None
        assert payload["can_upload"] is False
        assert payload["days"] == []
        assert payload["summary_28d"] == {
            "all_upload_count_28d": 0,
            "suspected_upload_count_28d": 0,
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

        response = client.get(
            "/v1/patient/upload-history",
            params={"line_user_id": "U_LINE_TZ_BOUNDARY"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["days"] == [
            {"date": "2026-05-11", "upload_count": 1, "has_suspected_risk": False},
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
            params={"line_user_id": "U_LINE_PROFILE"},
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

        response = client.get(
            "/v1/patient/upload-history",
            params={"line_user_id": "U_LINE_SUMMARY_ANNOTATION"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["days"] == [
            {
                "date": datetime.now(tz=timezone.utc).astimezone(timezone(timedelta(hours=8))).date().isoformat(),
                "upload_count": 1,
                "has_suspected_risk": True,
            }
        ]
        assert payload["summary_28d"]["all_upload_count_28d"] == 1
        assert payload["summary_28d"]["suspected_upload_count_28d"] == 1
        assert payload["summary_28d"]["continuous_upload_streak_days"] == 1


def test_patient_uploads_by_day_returns_day_scoped_records(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-by-day.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_BY_DAY")
        _seed_upload_history(client, patient_id=patient_id)
        token = _issue_token_for_line_user(client, line_user_id="U_LINE_BY_DAY")

        response = client.get(
            "/v1/patient/uploads/by-day",
            params={"date": "2026-05-08", "line_user_id": "U_LINE_BY_DAY"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["date"] == "2026-05-08"
        assert len(payload["items"]) == 2
        assert payload["items"][0]["upload_id"] < payload["items"][1]["upload_id"]


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
            params={"line_user_id": "U_LINE_DETAIL"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["upload_id"] == target_upload_id
        assert payload["annotation_label"] == "suspected"
        assert payload["annotation_comment"] == "needs follow-up"
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
            params={"line_user_id": "U_LINE_DETAIL_OWNER"},
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert owner_response.status_code == 200

        forbidden_response = client.get(
            f"/v1/patient/uploads/{target_upload_id}/detail",
            params={"line_user_id": "U_LINE_DETAIL_OTHER"},
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
            params={"line_user_id": "U_LINE_MESSAGES", "limit": 10, "offset": 0, "unread_only": True},
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
            params={"line_user_id": "U_LINE_MESSAGES_READ"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["annotation_id"] == annotation_id
        assert payload["is_read"] is True

        unread_after = client.get(
            "/v1/patient/messages",
            params={"line_user_id": "U_LINE_MESSAGES_READ", "unread_only": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert unread_after.status_code == 200
        unread_payload = unread_after.json()
        assert unread_payload["unread_count"] == 0


def test_staff_with_bound_patient_can_access_patient_messages(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "patient-messages-staff-role.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_MESSAGES_STAFF")
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
            params={"line_user_id": "U_LINE_MESSAGES_STAFF"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
