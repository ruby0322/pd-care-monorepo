from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, Annotation, LiffIdentity, Notification, Patient, PendingBinding, StaffPatientAssignment, Upload
from app.main import create_app
from tests.db_test_utils import migrated_sqlite_database_url
from app.services.auth.token_service import AuthTokenService
from app.services.staff_dashboard import calculate_age


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
        database_url=migrated_sqlite_database_url(db_path),
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


def _seed_patient_with_custom_uploads(
    client: TestClient,
    *,
    case_number: str,
    line_user_id: str,
    uploads: list[tuple[datetime, str]],
) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number=case_number, birth_date="1985-01-01", full_name=case_number, is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name=case_number,
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        for index, (upload_time, result) in enumerate(uploads, start=1):
            upload = Upload(
                patient_id=patient.id,
                object_key=f"patients/{patient.id}/uploads/{index}.jpg",
                content_type="image/jpeg",
                created_at=upload_time,
            )
            session.add(upload)
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result=result, probability=0.8, threshold=0.5))
        session.commit()
        return patient.id


def _seed_admin_analytics_data(client: TestClient) -> None:
    taipei_tz = timezone(timedelta(hours=8))
    taipei_today = datetime.now(tz=timezone.utc).astimezone(taipei_tz).date()
    taipei_day_start = datetime.combine(taipei_today, datetime.min.time(), tzinfo=taipei_tz).astimezone(timezone.utc)
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
                created_at=taipei_day_start + timedelta(hours=1),
            ),
            Upload(
                patient_id=patient_female.id,
                object_key="patients/a1002/uploads/today-2.jpg",
                content_type="image/jpeg",
                created_at=taipei_day_start + timedelta(hours=2),
            ),
            Upload(
                patient_id=patient_female.id,
                object_key="patients/a1002/uploads/today-rejected.jpg",
                content_type="image/jpeg",
                created_at=taipei_day_start + timedelta(hours=3),
            ),
            Upload(
                patient_id=patient_male.id,
                object_key="patients/a1001/uploads/day-3.jpg",
                content_type="image/jpeg",
                created_at=taipei_day_start - timedelta(days=3) + timedelta(hours=1),
            ),
            Upload(
                patient_id=patient_unknown.id,
                object_key="patients/a1003/uploads/day-5.jpg",
                content_type="image/jpeg",
                created_at=taipei_day_start - timedelta(days=5) + timedelta(hours=1),
            ),
        ]
        session.add_all(uploads)
        session.flush()
        session.add_all(
            [
                AIResult(upload_id=uploads[0].id, screening_result="suspected", probability=0.88, threshold=0.5),
                AIResult(upload_id=uploads[1].id, screening_result="normal", probability=0.12, threshold=0.5),
                AIResult(upload_id=uploads[2].id, screening_result="rejected", probability=0.0, threshold=0.5),
                AIResult(upload_id=uploads[3].id, screening_result="suspected", probability=0.84, threshold=0.5),
                AIResult(upload_id=uploads[4].id, screening_result="normal", probability=0.25, threshold=0.5),
            ]
        )
        session.commit()


def _assign_staff_patient(client: TestClient, *, staff_identity_id: int, patient_id: int) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(StaffPatientAssignment(staff_identity_id=staff_identity_id, patient_id=patient_id))
        session.commit()


def _set_patient_active(client: TestClient, *, patient_id: int, is_active: bool) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = session.get(Patient, patient_id)
        assert patient is not None
        patient.is_active = is_active
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


def _seed_notifications_for_patient(
    client: TestClient,
    *,
    line_user_id: str = "U_PATIENT_NOTIFY",
    case_number: str = "P778899",
    full_name: str = "Patient Notify",
    object_key_prefix: str = "99",
) -> tuple[int, int, int]:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number=case_number, birth_date="1979-08-01", full_name=full_name, is_active=True)
        session.add(patient)
        session.flush()
        session.add(
            LiffIdentity(
                line_user_id=line_user_id,
                display_name=full_name,
                picture_url=None,
                patient_id=patient.id,
                role="patient",
            )
        )
        older_upload = Upload(
            patient_id=patient.id,
            object_key=f"patients/{object_key_prefix}/uploads/older.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 8, 0, 0, tzinfo=timezone.utc),
        )
        newer_upload = Upload(
            patient_id=patient.id,
            object_key=f"patients/{object_key_prefix}/uploads/newer.jpg",
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
        assert queue_response.json()["items"][0]["threshold"] == 0.5
        assert "model_version" in queue_response.json()["items"][0]


def test_staff_upload_queue_includes_symptom_flags(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-queue-symptoms.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            latest_upload = session.query(Upload).filter(Upload.patient_id == patient_id).order_by(Upload.created_at.desc()).first()
            assert latest_upload is not None
            latest_upload.symptom_pain = True
            latest_upload.symptom_discharge = False
            latest_upload.symptom_pus = True
            session.commit()

        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        queue_response = client.get("/v1/staff/uploads/queue", headers=headers)
        assert queue_response.status_code == 200
        item = queue_response.json()["items"][0]
        assert item["symptom_pain"] is True
        assert item["symptom_discharge"] is False
        assert item["symptom_pus"] is True


def test_staff_patient_filters_use_latest_upload_status_and_created_range(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-latest-upload-filters.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_latest_suspected = _seed_patient_with_custom_uploads(
            client,
            case_number="P-LATEST-SUS",
            line_user_id="U_PATIENT_LATEST_SUS",
            uploads=[
                (datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 2, 10, 10, 0, tzinfo=timezone.utc), "suspected"),
            ],
        )
        patient_latest_normal = _seed_patient_with_custom_uploads(
            client,
            case_number="P-LATEST-NOR",
            line_user_id="U_PATIENT_LATEST_NOR",
            uploads=[
                (datetime(2026, 1, 8, 9, 0, tzinfo=timezone.utc), "suspected"),
                (datetime(2026, 2, 9, 10, 0, tzinfo=timezone.utc), "normal"),
            ],
        )
        patient_no_upload = _seed_patient_with_custom_uploads(
            client,
            case_number="P-NO-UPLOAD",
            line_user_id="U_PATIENT_NO_UPLOAD",
            uploads=[],
        )

        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_latest_suspected)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_latest_normal)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_no_upload)

        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        suspected_response = client.get("/v1/staff/patients?infection_status=suspected", headers=headers)
        assert suspected_response.status_code == 200
        suspected_cases = {item["case_number"] for item in suspected_response.json()["items"]}
        assert suspected_cases == {"P-LATEST-SUS"}

        normal_response = client.get("/v1/staff/patients?infection_status=normal", headers=headers)
        assert normal_response.status_code == 200
        normal_cases = {item["case_number"] for item in normal_response.json()["items"]}
        assert normal_cases == {"P-LATEST-NOR"}

        feb_range_response = client.get(
            "/v1/staff/patients?created_from=2026-02-10&created_to=2026-02-10",
            headers=headers,
        )
        assert feb_range_response.status_code == 200
        feb_cases = {item["case_number"] for item in feb_range_response.json()["items"]}
        assert feb_cases == {"P-LATEST-SUS"}


def test_staff_patient_list_suspected_patients_uses_latest_status(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-suspected-patient-count-latest.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_latest_suspected = _seed_patient_with_custom_uploads(
            client,
            case_number="P-LATEST-SUS-COUNT",
            line_user_id="U_PATIENT_LATEST_SUS_COUNT",
            uploads=[
                (datetime(2026, 1, 11, 9, 0, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 2, 11, 10, 0, tzinfo=timezone.utc), "suspected"),
            ],
        )
        patient_latest_normal = _seed_patient_with_custom_uploads(
            client,
            case_number="P-LATEST-NOR-COUNT",
            line_user_id="U_PATIENT_LATEST_NOR_COUNT",
            uploads=[
                (datetime(2026, 1, 12, 9, 0, tzinfo=timezone.utc), "suspected"),
                (datetime(2026, 2, 12, 10, 0, tzinfo=timezone.utc), "normal"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_latest_suspected)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_latest_normal)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/patients", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["total_patients"] == 2
        assert payload["suspected_patients"] == 1


def test_staff_patient_list_supports_limit_offset_pagination(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-pagination.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_a_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-PAGE-001",
            line_user_id="U_PATIENT_PAGE_001",
            uploads=[],
        )
        patient_b_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-PAGE-002",
            line_user_id="U_PATIENT_PAGE_002",
            uploads=[],
        )
        patient_c_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-PAGE-003",
            line_user_id="U_PATIENT_PAGE_003",
            uploads=[],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_a_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_b_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_c_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        first_page = client.get("/v1/staff/patients?sort_key=case_number&sort_dir=asc&limit=2&offset=0", headers=headers)
        assert first_page.status_code == 200
        first_payload = first_page.json()
        assert first_payload["limit"] == 2
        assert first_payload["offset"] == 0
        assert first_payload["total_patients"] == 3
        assert [item["case_number"] for item in first_payload["items"]] == ["P-PAGE-001", "P-PAGE-002"]

        second_page = client.get("/v1/staff/patients?sort_key=case_number&sort_dir=asc&limit=2&offset=2", headers=headers)
        assert second_page.status_code == 200
        second_payload = second_page.json()
        assert second_payload["limit"] == 2
        assert second_payload["offset"] == 2
        assert second_payload["total_patients"] == 3
        assert [item["case_number"] for item in second_payload["items"]] == ["P-PAGE-003"]

        out_of_range = client.get("/v1/staff/patients?sort_key=case_number&sort_dir=asc&limit=2&offset=99", headers=headers)
        assert out_of_range.status_code == 200
        out_of_range_payload = out_of_range.json()
        assert out_of_range_payload["limit"] == 2
        assert out_of_range_payload["offset"] == 99
        assert out_of_range_payload["total_patients"] == 3
        assert out_of_range_payload["items"] == []

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

        response = client.post("/v1/staff/patients/delete/preview", headers=headers, json={"patient_ids": [patient_id]})
        assert response.status_code == 403

        response = client.post("/v1/staff/patients/delete", headers=headers, json={"patient_ids": [patient_id]})
        assert response.status_code == 403


def test_staff_can_preview_and_delete_inactive_patients_with_scope(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-bulk-delete.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        assigned_inactive_id = _seed_patient_with_uploads(client)
        assigned_active_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-ACTIVE-KEEP",
            line_user_id="U_PATIENT_ACTIVE_KEEP",
            uploads=[],
        )
        unassigned_inactive_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-FORBIDDEN-INACTIVE",
            line_user_id="U_PATIENT_FORBIDDEN_INACTIVE",
            uploads=[],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_inactive_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_active_id)
        _set_patient_active(client, patient_id=assigned_inactive_id, is_active=False)
        _set_patient_active(client, patient_id=unassigned_inactive_id, is_active=False)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        missing_id = 999999

        preview_response = client.post(
            "/v1/staff/patients/delete/preview",
            headers=headers,
            json={"patient_ids": [assigned_inactive_id, assigned_active_id, unassigned_inactive_id, missing_id]},
        )
        assert preview_response.status_code == 200
        assert preview_response.json() == {
            "requested_count": 4,
            "deletable_count": 1,
            "skipped_active_count": 1,
            "skipped_forbidden_count": 1,
            "skipped_missing_count": 1,
            "impact": {
                "patients": 1,
                "uploads": 2,
                "ai_results": 2,
                "annotations": 0,
                "notifications": 0,
                "assignments": 1,
            },
        }

        delete_response = client.post(
            "/v1/staff/patients/delete",
            headers=headers,
            json={"patient_ids": [assigned_inactive_id, assigned_active_id, unassigned_inactive_id, missing_id]},
        )
        assert delete_response.status_code == 200
        assert delete_response.json() == {
            "requested_count": 4,
            "deleted_count": 1,
            "skipped_active_count": 1,
            "skipped_forbidden_count": 1,
            "skipped_missing_count": 1,
            "impact": {
                "patients": 1,
                "uploads": 2,
                "ai_results": 2,
                "annotations": 0,
                "notifications": 0,
                "assignments": 1,
            },
        }

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.get(Patient, assigned_inactive_id) is None
            assert session.get(Patient, assigned_active_id) is not None
            assert session.get(Patient, unassigned_inactive_id) is not None


def test_patient_single_delete_path_blocks_active_patient(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-single-delete.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        inactive_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-SINGLE-INACTIVE",
            line_user_id="U_PATIENT_SINGLE_INACTIVE",
            uploads=[],
        )
        active_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-SINGLE-ACTIVE",
            line_user_id="U_PATIENT_SINGLE_ACTIVE",
            uploads=[],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=inactive_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=active_id)
        _set_patient_active(client, patient_id=inactive_id, is_active=False)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        active_delete = client.post("/v1/staff/patients/delete", headers=headers, json={"patient_ids": [active_id]})
        assert active_delete.status_code == 200
        assert active_delete.json()["deleted_count"] == 0
        assert active_delete.json()["skipped_active_count"] == 1

        inactive_delete = client.post("/v1/staff/patients/delete", headers=headers, json={"patient_ids": [inactive_id]})
        assert inactive_delete.status_code == 200
        assert inactive_delete.json()["deleted_count"] == 1

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.get(Patient, active_id) is not None
            assert session.get(Patient, inactive_id) is None


def test_staff_can_upsert_annotation(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-annotation.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_uploads(client)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        uploads = client.get(f"/v1/staff/patients/{patient_id}/uploads", headers=headers)
        upload_id = uploads.json()["items"][0]["upload_id"]

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


def test_staff_patient_uploads_support_taipei_date_filter_and_pagination(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-upload-history.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-UPLOAD-HISTORY",
            line_user_id="U_PATIENT_UPLOAD_HISTORY",
            uploads=[
                (datetime(2026, 4, 30, 15, 59, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 4, 30, 16, 0, tzinfo=timezone.utc), "suspected"),
                (datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 5, 1, 16, 0, tzinfo=timezone.utc), "rejected"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        first_page = client.get(
            f"/v1/staff/patients/{patient_id}/uploads"
            "?created_from=2026-05-01&created_to=2026-05-01&limit=1&offset=0",
            headers=headers,
        )
        assert first_page.status_code == 200
        first_payload = first_page.json()
        assert first_payload["total"] == 2
        assert first_payload["limit"] == 1
        assert first_payload["offset"] == 0
        assert len(first_payload["items"]) == 1
        assert first_payload["items"][0]["screening_result"] == "normal"

        second_page = client.get(
            f"/v1/staff/patients/{patient_id}/uploads"
            "?created_from=2026-05-01&created_to=2026-05-01&limit=1&offset=1",
            headers=headers,
        )
        assert second_page.status_code == 200
        second_payload = second_page.json()
        assert second_payload["total"] == 2
        assert second_payload["items"][0]["screening_result"] == "suspected"

        empty_range = client.get(
            f"/v1/staff/patients/{patient_id}/uploads"
            "?created_from=2026-06-01&created_to=2026-06-30",
            headers=headers,
        )
        assert empty_range.status_code == 200
        assert empty_range.json()["total"] == 0
        assert empty_range.json()["items"] == []


def test_staff_patient_upload_calendar_groups_by_taipei_date(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-upload-calendar.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-UPLOAD-CALENDAR",
            line_user_id="U_PATIENT_UPLOAD_CALENDAR",
            uploads=[
                (datetime(2026, 4, 30, 15, 59, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 4, 30, 16, 0, tzinfo=timezone.utc), "suspected"),
                (datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc), "normal"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)

        response = client.get(
            f"/v1/staff/patients/{patient_id}/upload-calendar",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json()["items"] == [
            {"date": "2026-04-30", "upload_count": 1, "has_suspected_risk": False},
            {"date": "2026-05-01", "upload_count": 2, "has_suspected_risk": True},
        ]


def test_staff_patient_upload_pagination_uses_id_as_timestamp_tiebreaker(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-upload-order.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        shared_timestamp = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        patient_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-UPLOAD-ORDER",
            line_user_id="U_PATIENT_UPLOAD_ORDER",
            uploads=[
                (shared_timestamp, "normal"),
                (shared_timestamp, "suspected"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            expected_ids = [
                upload.id
                for upload in session.query(Upload)
                .filter(Upload.patient_id == patient_id)
                .order_by(Upload.id.desc())
                .all()
            ]
        token = _login_staff_token(client)

        response = client.get(
            f"/v1/staff/patients/{patient_id}/uploads",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert [item["upload_id"] for item in response.json()["items"]] == expected_ids


def test_staff_patient_detail_returns_counts_without_embedded_uploads(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-slim-detail.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-SLIM-DETAIL",
            line_user_id="U_PATIENT_SLIM_DETAIL",
            uploads=[
                (datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 5, 2, 8, 0, tzinfo=timezone.utc), "suspected"),
                (datetime(2026, 5, 3, 8, 0, tzinfo=timezone.utc), "rejected"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)

        response = client.get(
            f"/v1/staff/patients/{patient_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert "uploads" not in payload
        assert payload["total_uploads"] == 3
        assert payload["suspected_uploads"] == 1
        assert payload["rejected_uploads"] == 1


def test_staff_cannot_review_unassigned_uploads_or_annotations(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-unassigned-upload-forbidden.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        assigned_patient_id = _seed_patient_with_uploads(client)
        unassigned_patient_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-UNASSIGNED-REVIEW",
            line_user_id="U_PATIENT_UNASSIGNED_REVIEW",
            uploads=[(datetime(2026, 5, 10, 0, 0, tzinfo=timezone.utc), "suspected")],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            unassigned_upload = session.query(Upload).filter(Upload.patient_id == unassigned_patient_id).one()
            unassigned_upload_id = unassigned_upload.id

        annotation_response = client.post(
            f"/v1/staff/uploads/{unassigned_upload_id}/annotation",
            headers=headers,
            json={"label": "suspected", "comment": "out of scope"},
        )
        assert annotation_response.status_code == 403

        annotation_list_response = client.get(f"/v1/staff/patients/{unassigned_patient_id}/annotations", headers=headers)
        assert annotation_list_response.status_code == 403

        uploads_response = client.get(f"/v1/staff/patients/{unassigned_patient_id}/uploads", headers=headers)
        assert uploads_response.status_code == 403

        calendar_response = client.get(
            f"/v1/staff/patients/{unassigned_patient_id}/upload-calendar",
            headers=headers,
        )
        assert calendar_response.status_code == 403

        image_access_response = client.get(f"/v1/staff/uploads/{unassigned_upload_id}/image-access", headers=headers)
        assert image_access_response.status_code == 403

        image_response = client.get(f"/v1/staff/uploads/{unassigned_upload_id}/image", headers=headers)
        assert image_response.status_code == 403


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
                "line_id_token": "stub:U_PRECREATE_MATCH",
                "case_number": "PRE004",
                "birth_date": "1988-08-08",
            },
        )
        assert bind_response.status_code == 200
        assert bind_response.json()["status"] == "matched"
        assert bind_response.json()["can_upload"] is True


def test_staff_patient_list_excludes_rejected_uploads_from_counts(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-rejected-excluded.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id = _seed_patient_with_custom_uploads(
            client,
            case_number="P-REJECTED-STATS",
            line_user_id="U_PATIENT_REJECTED_STATS",
            uploads=[
                (datetime(2026, 2, 10, 8, 0, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 2, 11, 8, 0, tzinfo=timezone.utc), "rejected"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/patients", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["total_uploads"] == 1
        assert payload["suspected_patients"] == 0
        assert payload["items"][0]["upload_count"] == 1
        assert payload["items"][0]["suspected_count"] == 0

        normal_filter = client.get("/v1/staff/patients?infection_status=normal", headers=headers)
        assert normal_filter.status_code == 200
        assert [item["case_number"] for item in normal_filter.json()["items"]] == ["P-REJECTED-STATS"]


def _seed_history_overview_data(client: TestClient, *, staff_identity_id: int) -> dict[str, int]:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient_a = Patient(case_number="HX-001", birth_date="1980-01-01", full_name="History A", gender="male", is_active=True)
        patient_b = Patient(case_number="HX-002", birth_date="1990-01-01", full_name="History B", gender="female", is_active=True)
        session.add_all([patient_a, patient_b])
        session.flush()
        session.add_all(
            [
                LiffIdentity(
                    line_user_id="U_HISTORY_A",
                    display_name="History Display A",
                    real_name="History Real A",
                    picture_url="https://example.com/a.jpg",
                    patient_id=patient_a.id,
                    role="patient",
                ),
                LiffIdentity(
                    line_user_id="U_HISTORY_B",
                    display_name="History Display B",
                    real_name="History Real B",
                    picture_url="https://example.com/b.jpg",
                    patient_id=patient_b.id,
                    role="patient",
                ),
            ]
        )

        upload_a_confirmed = Upload(
            patient_id=patient_a.id,
            object_key="patients/hx001/uploads/1.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 29, 1, 0, tzinfo=timezone.utc),
            symptom_pain=True,
            symptom_discharge=False,
            symptom_pus=False,
        )
        upload_a_normal = Upload(
            patient_id=patient_a.id,
            object_key="patients/hx001/uploads/2.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 29, 3, 0, tzinfo=timezone.utc),
            symptom_pain=False,
            symptom_discharge=False,
            symptom_pus=False,
        )
        upload_b_suspected = Upload(
            patient_id=patient_b.id,
            object_key="patients/hx002/uploads/1.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 29, 5, 0, tzinfo=timezone.utc),
            symptom_pain=False,
            symptom_discharge=True,
            symptom_pus=False,
        )
        upload_prev_day = Upload(
            patient_id=patient_b.id,
            object_key="patients/hx002/uploads/prev.jpg",
            content_type="image/jpeg",
            created_at=datetime(2026, 5, 28, 14, 0, tzinfo=timezone.utc),
        )
        session.add_all([upload_a_confirmed, upload_a_normal, upload_b_suspected, upload_prev_day])
        session.flush()
        session.add_all(
            [
                AIResult(
                    upload_id=upload_a_confirmed.id,
                    screening_result="normal",
                    probability=0.2,
                    threshold=0.5,
                ),
                AIResult(
                    upload_id=upload_a_normal.id,
                    screening_result="normal",
                    probability=0.1,
                    threshold=0.5,
                ),
                AIResult(
                    upload_id=upload_b_suspected.id,
                    screening_result="suspected",
                    probability=0.87,
                    threshold=0.5,
                ),
                AIResult(
                    upload_id=upload_prev_day.id,
                    screening_result="normal",
                    probability=0.1,
                    threshold=0.5,
                ),
            ]
        )
        session.add(
            Annotation(
                patient_id=patient_a.id,
                upload_id=upload_a_confirmed.id,
                reviewer_identity_id=staff_identity_id,
                label="confirmed_infection",
                comment="confirmed by staff",
                patient_read_at=None,
            )
        )
        session.commit()
        return {
            "patient_a_id": patient_a.id,
            "patient_b_id": patient_b.id,
            "upload_a_confirmed_id": upload_a_confirmed.id,
        }


def test_staff_history_overview_endpoints_return_expected_shape(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-history-overview.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        seeded = _seed_history_overview_data(client, staff_identity_id=staff_identity_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=seeded["patient_a_id"])
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=seeded["patient_b_id"])
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        days_response = client.get("/v1/staff/uploads/history-overview/days", headers=headers)
        assert days_response.status_code == 200
        days = days_response.json()["items"]
        assert any(day["local_date"] == "2026-05-29" for day in days)
        day_0529 = next(day for day in days if day["local_date"] == "2026-05-29")
        assert day_0529["upload_count"] == 3
        assert day_0529["uploaded_users"] == 2
        assert day_0529["suspected_infected_users"] == 2
        assert day_0529["has_infection_risk"] is True

        overview_response = client.get(
            "/v1/staff/uploads/history-overview",
            headers=headers,
            params={
                "local_date": "2026-05-29",
                "sort_by": "risk",
                "group_by_user": "true",
                "group_sort_by": "infection_risk",
            },
        )
        assert overview_response.status_code == 200
        overview_payload = overview_response.json()
        assert overview_payload["kpi"]["uploads"] == 3
        assert overview_payload["group_by_user"] is True
        assert len(overview_payload["groups"]) == 2
        first_group_upload = overview_payload["groups"][0]["uploads"][0]
        expected_age = calculate_age("1980-01-01")
        assert first_group_upload["risk_rank"] == 0
        assert first_group_upload["annotation_label"] == "confirmed_infection"
        assert first_group_upload["age"] == expected_age
        assert first_group_upload["threshold"] == 0.5
        assert "model_version" in first_group_upload

        calendar_response = client.get(
            "/v1/staff/uploads/history-overview/calendar",
            headers=headers,
            params={"year": 2026, "month": 5},
        )
        assert calendar_response.status_code == 200
        calendar_items = calendar_response.json()["items"]
        day_0529_calendar = next(item for item in calendar_items if item["local_date"] == "2026-05-29")
        assert day_0529_calendar["risky_patient_count"] == 2
        assert day_0529_calendar["has_infection_risk"] is True


def test_staff_history_overview_uses_linked_admin_identity_profile(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-history-overview-admin-profile.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        seeded = _seed_history_overview_data(client, staff_identity_id=staff_identity_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=seeded["patient_a_id"])
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=seeded["patient_b_id"])

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            linked_identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == "U_HISTORY_A").one()
            linked_identity.role = "admin"
            session.commit()

        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        overview_response = client.get(
            "/v1/staff/uploads/history-overview",
            headers=headers,
            params={
                "local_date": "2026-05-29",
                "sort_by": "risk",
                "group_by_user": "true",
                "group_sort_by": "infection_risk",
            },
        )
        assert overview_response.status_code == 200
        groups = overview_response.json()["groups"]
        history_a_group = next(group for group in groups if group["case_number"] == "HX-001")
        assert history_a_group["line_display_name"] == "History Display A"
        assert history_a_group["picture_url"] == "https://example.com/a.jpg"


