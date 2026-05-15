from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, PendingBinding, StaffPatientAssignment, Upload
from app.main import create_app
from app.services.auth.token_service import AuthTokenService


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-staff-dashboard-api",
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
        auth_token_secret="test-auth-secret",
        auth_token_ttl_seconds=3600,
        line_verify_mode="stub",
    )


def _seed_staff(client: TestClient, *, line_user_id: str = "U_STAFF", role: str = "staff") -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        staff_identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name="Staff",
            picture_url=None,
            patient_id=None,
            role=role,
        )
        session.add(staff_identity)
        session.commit()
        session.refresh(staff_identity)
        return staff_identity.id


def _seed_patient_with_uploads(client: TestClient) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="P123456", birth_date="1980-01-02", full_name="Patient A", is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id="U_PATIENT_A",
                display_name="Patient A",
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )

        upload1 = Upload(
            patient_id=patient.id,
            object_key="patients/1/uploads/1.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 10, 0, 0, tzinfo=timezone.utc),
        )
        upload2 = Upload(
            patient_id=patient.id,
            object_key="patients/1/uploads/2.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 9, 0, 0, tzinfo=timezone.utc),
        )
        session.add_all([upload1, upload2])
        session.flush()
        session.add_all(
            [
                AIResult(upload_id=upload1.id, screening_result="suspected", probability=0.9, threshold=0.5),
                AIResult(upload_id=upload2.id, screening_result="normal", probability=0.1, threshold=0.5),
            ]
        )
        session.commit()
        return patient.id


def _seed_admin_analytics_data(client: TestClient) -> None:
    now = datetime.now(tz=timezone.utc)
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient_male = Patient(
            case_number="A1001",
            birth_date="1990-01-01",
            full_name="Male Patient",
            gender="male",
            is_active=True,
        )
        patient_female = Patient(
            case_number="A1002",
            birth_date="1982-06-08",
            full_name="Female Patient",
            gender="female",
            is_active=True,
        )
        patient_unknown = Patient(
            case_number="A1003",
            birth_date="2005-03-11",
            full_name="Unknown Patient",
            gender="unknown",
            is_active=False,
        )
        session.add_all([patient_male, patient_female, patient_unknown])
        session.flush()

        uploads = [
            Upload(
                patient_id=patient_male.id,
                object_key="patients/a1001/uploads/today-1.jpg",
                content_type="image/jpeg",
                created_at=now - timedelta(hours=1),
            ),
            Upload(
                patient_id=patient_female.id,
                object_key="patients/a1002/uploads/today-2.jpg",
                content_type="image/jpeg",
                created_at=now - timedelta(hours=2),
            ),
            Upload(
                patient_id=patient_male.id,
                object_key="patients/a1001/uploads/day-3.jpg",
                content_type="image/jpeg",
                created_at=now - timedelta(days=3),
            ),
            Upload(
                patient_id=patient_unknown.id,
                object_key="patients/a1003/uploads/day-5.jpg",
                content_type="image/jpeg",
                created_at=now - timedelta(days=5),
            ),
        ]
        session.add_all(uploads)
        session.flush()
        session.add_all(
            [
                AIResult(upload_id=uploads[0].id, screening_result="suspected", probability=0.88, threshold=0.5),
                AIResult(upload_id=uploads[1].id, screening_result="normal", probability=0.12, threshold=0.5),
                AIResult(upload_id=uploads[2].id, screening_result="suspected", probability=0.84, threshold=0.5),
                AIResult(upload_id=uploads[3].id, screening_result="normal", probability=0.25, threshold=0.5),
            ]
        )
        session.commit()


def _assign_staff_patient(client: TestClient, *, staff_identity_id: int, patient_id: int) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(StaffPatientAssignment(staff_identity_id=staff_identity_id, patient_id=patient_id))
        session.commit()


def _seed_pending_binding(client: TestClient, *, line_user_id: str = "U_PENDING_1") -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        pending = PendingBinding(
            line_user_id=line_user_id,
            case_number="P123456",
            birth_date="1980-01-02",
            status="pending",
        )
        session.add(pending)
        session.commit()
        session.refresh(pending)
        return pending.id


def _seed_notifications_for_patient(client: TestClient) -> tuple[int, int, int]:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="P778899", birth_date="1979-08-01", full_name="Patient Notify", is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id="U_PATIENT_NOTIFY",
                display_name="Patient Notify",
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        older_upload = Upload(
            patient_id=patient.id,
            object_key="patients/99/uploads/99.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 8, 0, 0, tzinfo=timezone.utc),
        )
        newer_upload = Upload(
            patient_id=patient.id,
            object_key="patients/99/uploads/100.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 10, 0, 0, tzinfo=timezone.utc),
        )
        session.add_all([older_upload, newer_upload])
        session.flush()
        older_ai = AIResult(upload_id=older_upload.id, screening_result="suspected", probability=0.77, threshold=0.5)
        newer_ai = AIResult(upload_id=newer_upload.id, screening_result="suspected", probability=0.91, threshold=0.5)
        session.add_all([older_ai, newer_ai])
        session.flush()
        session.add_all(
            [
                Notification(
                    patient_id=patient.id,
                    upload_id=older_upload.id,
                    ai_result_id=older_ai.id,
                    status="reviewed",
                    summary="Older reviewed alert",
                    created_at=datetime(2026, 5, 8, 1, 0, tzinfo=timezone.utc),
                ),
                Notification(
                    patient_id=patient.id,
                    upload_id=newer_upload.id,
                    ai_result_id=newer_ai.id,
                    status="new",
                    summary="Newest unread alert",
                    created_at=datetime(2026, 5, 10, 1, 0, tzinfo=timezone.utc),
                ),
            ]
        )
        session.commit()
        return patient.id, newer_ai.id, newer_upload.id


def _login_staff_token(client: TestClient, line_user_id: str = "U_STAFF") -> str:
    response = client.post("/v1/auth/login", json={"line_id_token": f"stub:{line_user_id}"})
    assert response.status_code == 200
    return response.json()["access_token"]


def _issue_patient_token(client: TestClient) -> str:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient_identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == "U_PATIENT_A").one()
    token_service = AuthTokenService(secret=client.app.state.settings.auth_token_secret)
    return token_service.issue_token(
        identity_id=patient_identity.id,
        line_user_id=patient_identity.line_user_id,
        role="patient",
        patient_id=patient_identity.patient_id,
        ttl_seconds=client.app.state.settings.auth_token_ttl_seconds,
    )


def test_staff_patient_list_and_queue_are_accessible(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-list.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        list_response = client.get("/v1/staff/patients", headers=headers)
        assert list_response.status_code == 200
        assert list_response.json()["total_patients"] == 1
        assert list_response.json()["items"][0]["suspected_count"] == 1

        queue_response = client.get("/v1/staff/uploads/queue", headers=headers)
        assert queue_response.status_code == 200
        assert len(queue_response.json()["items"]) >= 1


def test_patient_token_is_denied_for_staff_dashboard_endpoints(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-denied.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _issue_patient_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/patients", headers=headers)
        assert response.status_code == 403


def test_staff_can_upsert_annotation(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-annotation.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        detail = client.get(f"/v1/staff/patients/{patient_id}", headers=headers)
        upload_id = detail.json()["uploads"][0]["upload_id"]

        create_response = client.post(
            f"/v1/staff/uploads/{upload_id}/annotation",
            headers=headers,
            json={"label": "suspected", "comment": "Needs closer review"},
        )
        assert create_response.status_code == 200

        list_response = client.get(f"/v1/staff/patients/{patient_id}/annotations", headers=headers)
        assert list_response.status_code == 200
        assert list_response.json()["items"][0]["upload_id"] == upload_id
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            annotation = session.query(Annotation).filter(Annotation.upload_id == upload_id).one()
            annotation.patient_read_at = datetime.now(tz=timezone.utc)
            session.commit()

        update_response = client.post(
            f"/v1/staff/uploads/{upload_id}/annotation",
            headers=headers,
            json={"label": "confirmed_infection", "comment": "Escalate follow-up"},
        )
        assert update_response.status_code == 200

        with session_factory() as session:
            updated = session.query(Annotation).filter(Annotation.upload_id == upload_id).one()
            assert updated.patient_read_at is None


def test_staff_can_link_and_reject_pending_bindings(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        pending_id = _seed_pending_binding(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        pending_list = client.get("/v1/staff/pending-bindings", headers=headers)
        assert pending_list.status_code == 200
        assert pending_list.json()["items"][0]["id"] == pending_id

        link_response = client.post(
            f"/v1/staff/pending-bindings/{pending_id}/link",
            headers=headers,
            json={"patient_id": patient_id},
        )
        assert link_response.status_code == 200
        assert link_response.json()["status"] == "approved"

        pending_id_2 = _seed_pending_binding(client)
        reject_response = client.post(f"/v1/staff/pending-bindings/{pending_id_2}/reject", headers=headers)
        assert reject_response.status_code == 200
        assert reject_response.json()["status"] == "rejected"


def test_staff_can_reject_all_pending_bindings(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-pending-reject-all.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        _seed_pending_binding(client, line_user_id="U_PENDING_BATCH_1")
        _seed_pending_binding(client, line_user_id="U_PENDING_BATCH_2")
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        reject_all_response = client.post("/v1/staff/pending-bindings/reject-all", headers=headers)
        assert reject_all_response.status_code == 200
        assert reject_all_response.json()["rejected_count"] == 2

        pending_list = client.get("/v1/staff/pending-bindings", headers=headers)
        assert pending_list.status_code == 200
        assert pending_list.json()["items"] == []


def test_staff_can_create_patient_and_link_pending_binding(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-create-and-link.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        pending_id = _seed_pending_binding(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            f"/v1/staff/pending-bindings/{pending_id}/create-patient",
            headers=headers,
            json={"full_name": "New Pending Patient"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "approved"
        assert isinstance(response.json()["patient_id"], int)


def test_staff_and_admin_can_precreate_patient_record(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-precreate-patient.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_STAFF_CREATE")
        _seed_staff(client, line_user_id="U_ADMIN_CREATE", role="admin")

        staff_token = _login_staff_token(client, "U_STAFF_CREATE")
        staff_headers = {"Authorization": f"Bearer {staff_token}"}
        staff_response = client.post(
            "/v1/staff/patients",
            headers=staff_headers,
            json={"case_number": "PRE001", "birth_date": "1985-05-05", "full_name": "Pre Created Staff"},
        )
        assert staff_response.status_code == 200
        assert staff_response.json()["case_number"] == "PRE001"
        assert staff_response.json()["birth_date"] == "1985-05-05"
        assert staff_response.json()["is_active"] is True

        admin_token = _login_staff_token(client, "U_ADMIN_CREATE")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        admin_response = client.post(
            "/v1/staff/patients",
            headers=admin_headers,
            json={"case_number": "PRE002", "birth_date": "1986-06-06", "full_name": "Pre Created Admin"},
        )
        assert admin_response.status_code == 200
        assert admin_response.json()["case_number"] == "PRE002"
        assert admin_response.json()["birth_date"] == "1986-06-06"
        assert admin_response.json()["is_active"] is True


def test_precreate_patient_rejects_duplicate_case_birth(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-precreate-duplicate.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        first_response = client.post(
            "/v1/staff/patients",
            headers=headers,
            json={"case_number": "PRE003", "birth_date": "1987-07-07", "full_name": "First Name"},
        )
        assert first_response.status_code == 200

        duplicate_response = client.post(
            "/v1/staff/patients",
            headers=headers,
            json={"case_number": "PRE003", "birth_date": "1987-07-07", "full_name": "Second Name"},
        )
        assert duplicate_response.status_code == 409
        assert "already exists" in duplicate_response.json()["detail"]


def test_precreated_patient_can_match_identity_without_review(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-precreate-bind-match.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        create_response = client.post(
            "/v1/staff/patients",
            headers=headers,
            json={"case_number": "PRE004", "birth_date": "1988-08-08", "full_name": "Pre Bound Patient"},
        )
        assert create_response.status_code == 200

        bind_response = client.post(
            "/v1/identity/bind",
            json={
                "line_user_id": "U_PRECREATE_MATCH",
                "display_name": "Line User",
                "picture_url": "https://example.com/match.jpg",
                "case_number": "PRE004",
                "birth_date": "1988-08-08",
            },
        )
        assert bind_response.status_code == 200
        assert bind_response.json()["status"] == "matched"
        assert bind_response.json()["can_upload"] is True


def test_staff_can_list_notifications_newest_first(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-notifications-list.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id, _, _ = _seed_notifications_for_patient(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/notifications", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 2
        assert payload["unread_count"] == 1
        assert payload["items"][0]["summary"] == "Newest unread alert"
        assert payload["items"][0]["status"] == "new"
        assert payload["items"][1]["summary"] == "Older reviewed alert"


def test_staff_can_mark_single_notification_as_read_without_changing_ai_result(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-notifications-read.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id, ai_result_id, _ = _seed_notifications_for_patient(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        list_response = client.get("/v1/staff/notifications", headers=headers)
        notification_id = list_response.json()["items"][0]["id"]

        mark_response = client.post(f"/v1/staff/notifications/{notification_id}/read", headers=headers)
        assert mark_response.status_code == 200
        assert mark_response.json()["status"] == "reviewed"

        verify_response = client.get("/v1/staff/notifications", headers=headers)
        assert verify_response.status_code == 200
        assert verify_response.json()["unread_count"] == 0
        assert verify_response.json()["items"][0]["status"] == "reviewed"

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            ai_result = session.get(AIResult, ai_result_id)
            assert ai_result is not None
            assert ai_result.screening_result == "suspected"
            assert ai_result.probability == 0.91


def test_patient_token_is_denied_for_notification_endpoints(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-notifications-rbac.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        notify_patient_id, _, _ = _seed_notifications_for_patient(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=notify_patient_id)
        token = _issue_patient_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        list_response = client.get("/v1/staff/notifications", headers=headers)
        assert list_response.status_code == 403

        mark_response = client.post("/v1/staff/notifications/1/read", headers=headers)
        assert mark_response.status_code == 403


def test_staff_cannot_access_unassigned_patient_detail(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-unassigned-forbidden.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        detail = client.get(f"/v1/staff/patients/{patient_id}", headers=headers)
        assert detail.status_code == 403


def test_staff_can_toggle_assigned_patient_status(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-toggle-status.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        disable_response = client.post(
            f"/v1/staff/patients/{patient_id}/status",
            headers=headers,
            json={"is_active": False},
        )
        assert disable_response.status_code == 200
        assert disable_response.json()["is_active"] is False

        restore_response = client.post(
            f"/v1/staff/patients/{patient_id}/status",
            headers=headers,
            json={"is_active": True},
        )
        assert restore_response.status_code == 200
        assert restore_response.json()["is_active"] is True


def test_admin_analytics_endpoints_return_expected_payloads(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-analytics.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_ADMIN_ANALYTICS", role="admin")
        _seed_admin_analytics_data(client)
        token = _login_staff_token(client, "U_ADMIN_ANALYTICS")
        headers = {"Authorization": f"Bearer {token}"}

        gender_response = client.get("/v1/staff/admin/analytics/gender-distribution", headers=headers)
        assert gender_response.status_code == 200
        gender_payload = gender_response.json()
        assert gender_payload["total_patients"] == 3
        assert {item["gender"] for item in gender_payload["items"]} == {"male", "female", "other", "unknown"}

        today_response = client.get("/v1/staff/admin/analytics/suspected-infections/today", headers=headers)
        assert today_response.status_code == 200
        today_payload = today_response.json()
        assert today_payload["total_uploads"] == 2
        assert today_payload["suspected_uploads"] == 1
        assert today_payload["normal_uploads"] == 1
        assert today_payload["suspected_ratio"] == 0.5

        histogram_response = client.get("/v1/staff/admin/analytics/age-histogram?bucket_size=10", headers=headers)
        assert histogram_response.status_code == 200
        histogram_payload = histogram_response.json()
        assert histogram_payload["bucket_size"] == 10
        assert histogram_payload["total_patients"] == 2
        assert len(histogram_payload["items"]) >= 1

        active_response = client.get(
            "/v1/staff/admin/analytics/active-users?active_window_days=7&lookback_days=30&interval=day",
            headers=headers,
        )
        assert active_response.status_code == 200
        active_payload = active_response.json()
        assert active_payload["active_window_days"] == 7
        assert active_payload["lookback_days"] == 30
        assert active_payload["interval"] == "day"
        assert len(active_payload["items"]) == 30
        assert active_payload["items"][-1]["active_users"] >= 2

        daily_response = client.get("/v1/staff/admin/analytics/daily-suspected-series?lookback_days=30", headers=headers)
        assert daily_response.status_code == 200
        daily_payload = daily_response.json()
        assert daily_payload["lookback_days"] == 30
        assert len(daily_payload["items"]) == 30
        assert any(item["total_uploads"] == 0 and item["suspected_ratio"] == 0 for item in daily_payload["items"])


def test_staff_is_denied_for_admin_analytics_endpoints(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-analytics-rbac.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_STAFF_ANALYTICS", role="staff")
        token = _login_staff_token(client, "U_STAFF_ANALYTICS")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/admin/analytics/gender-distribution", headers=headers)
        assert response.status_code == 403


def test_admin_can_assign_patient_to_staff_and_list_assignments(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-assignment-single.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_ADMIN_ASSIGN", role="admin")
        staff_identity_id = _seed_staff(client, line_user_id="U_STAFF_ASSIGN_1")
        patient_id = _seed_patient_with_uploads(client)
        admin_token = _login_staff_token(client, "U_ADMIN_ASSIGN")
        headers = {"Authorization": f"Bearer {admin_token}"}

        assign_response = client.post(
            "/v1/staff/admin/assignments",
            headers=headers,
            json={"patient_id": patient_id, "staff_identity_id": staff_identity_id},
        )
        assert assign_response.status_code == 200
        assert assign_response.json()["status"] == "updated"

        list_response = client.get("/v1/staff/admin/assignments", headers=headers)
        assert list_response.status_code == 200
        assigned_item = next((item for item in list_response.json()["items"] if item["patient_id"] == patient_id), None)
        assert assigned_item is not None
        assert assigned_item["staff_identity_id"] == staff_identity_id


def test_admin_assignment_replaces_previous_owner(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-assignment-transfer.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_ADMIN_ASSIGN_TRANSFER", role="admin")
        staff_a_id = _seed_staff(client, line_user_id="U_STAFF_ASSIGN_A")
        staff_b_id = _seed_staff(client, line_user_id="U_STAFF_ASSIGN_B")
        patient_id = _seed_patient_with_uploads(client)
        admin_token = _login_staff_token(client, "U_ADMIN_ASSIGN_TRANSFER")
        headers = {"Authorization": f"Bearer {admin_token}"}

        first_assign = client.post(
            "/v1/staff/admin/assignments",
            headers=headers,
            json={"patient_id": patient_id, "staff_identity_id": staff_a_id},
        )
        assert first_assign.status_code == 200
        assert first_assign.json()["status"] == "updated"

        second_assign = client.post(
            "/v1/staff/admin/assignments",
            headers=headers,
            json={"patient_id": patient_id, "staff_identity_id": staff_b_id},
        )
        assert second_assign.status_code == 200
        assert second_assign.json()["status"] == "updated"

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            rows = (
                session.query(StaffPatientAssignment)
                .filter(StaffPatientAssignment.patient_id == patient_id)
                .order_by(StaffPatientAssignment.created_at.desc())
                .all()
            )
            assert len(rows) == 1
            assert rows[0].staff_identity_id == staff_b_id


def test_admin_bulk_assignment_returns_invalid_items(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-assignment-bulk.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_ADMIN_ASSIGN_BULK", role="admin")
        staff_identity_id = _seed_staff(client, line_user_id="U_STAFF_ASSIGN_BULK")
        patient_id = _seed_patient_with_uploads(client)
        admin_token = _login_staff_token(client, "U_ADMIN_ASSIGN_BULK")
        headers = {"Authorization": f"Bearer {admin_token}"}

        response = client.post(
            "/v1/staff/admin/assignments/bulk",
            headers=headers,
            json={
                "assignments": [
                    {"patient_id": patient_id, "staff_identity_id": staff_identity_id},
                    {"patient_id": 999999, "staff_identity_id": staff_identity_id},
                    {"patient_id": patient_id, "staff_identity_id": 999999},
                ]
            },
        )
        assert response.status_code == 200
        payload = response.json()
        statuses = [item["status"] for item in payload["results"]]
        assert statuses.count("updated") == 1
        assert statuses.count("invalid") == 2
