from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select

from app.config import Settings
from app.db.models import (
    AIResult,
    Annotation,
    AuthorizationAuditEvent,
    LiffIdentity,
    Patient,
    StaffPatientAssignment,
    Upload,
)
from app.main import create_app
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-admin-user-management-api",
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


def _seed_identity(
    client: TestClient,
    *,
    line_user_id: str,
    role: str,
    is_active: bool = True,
    real_name: str | None = None,
) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name=line_user_id,
            real_name=real_name,
            picture_url=None,
            patient_id=None,
            role=role,
            is_active=is_active,
        )
        session.add(identity)
        session.commit()
        session.refresh(identity)
        return identity.id


def _set_identity_created_at(client: TestClient, *, identity_id: int, created_at: datetime) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = session.get(LiffIdentity, identity_id)
        assert identity is not None
        identity.created_at = created_at
        session.commit()


def _login_token(client: TestClient, line_user_id: str) -> str:
    response = client.post("/v1/auth/login", json={"line_id_token": f"stub:{line_user_id}"})
    assert response.status_code == 200
    return response.json()["access_token"]


def test_staff_cannot_access_admin_user_management_endpoints(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-staff-denied.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_STAFF_DENIED", role="staff")
        token = _login_token(client, "U_STAFF_DENIED")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/admin/users", headers=headers)
        assert response.status_code == 403

        response = client.get("/v1/staff/admin/access-requests", headers=headers)
        assert response.status_code == 403

        response = client.post("/v1/staff/admin/users/delete/preview", headers=headers, json={"identity_ids": [1]})
        assert response.status_code == 403

        response = client.post("/v1/staff/admin/users/delete", headers=headers, json={"identity_ids": [1]})
        assert response.status_code == 403


def test_admin_can_approve_healthcare_access_request_and_grant_staff(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-approve.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_APPROVER", role="admin")

        create_response = client.post(
            "/v1/identity/healthcare-access-request",
            json={
                "line_id_token": "stub:U_REQUESTER_1",
            },
        )
        assert create_response.status_code == 200
        request_id = create_response.json()["request_id"]

        admin_token = _login_token(client, "U_ADMIN_APPROVER")
        headers = {"Authorization": f"Bearer {admin_token}"}
        approve_response = client.post(
            f"/v1/staff/admin/access-requests/{request_id}/approve",
            headers=headers,
            json={"role": "staff"},
        )
        assert approve_response.status_code == 200
        assert approve_response.json()["status"] == "approved"
        assert approve_response.json()["decision_role"] == "staff"

        status_response = client.post(
            "/v1/identity/healthcare-access-request/status",
            json={"line_id_token": "stub:U_REQUESTER_1"},
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "approved"
        assert status_response.json()["decision_role"] == "staff"

        requester_login = client.post("/v1/auth/login", json={"line_id_token": "stub:U_REQUESTER_1"})
        assert requester_login.status_code == 200
        assert requester_login.json()["role"] == "staff"


def test_admin_can_update_user_role_and_status(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-update.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_EDITOR", role="admin")
        target_identity_id = _seed_identity(client, line_user_id="U_TARGET", role="patient")
        admin_token = _login_token(client, "U_ADMIN_EDITOR")
        headers = {"Authorization": f"Bearer {admin_token}"}

        role_response = client.post(
            f"/v1/staff/admin/users/{target_identity_id}/role",
            headers=headers,
            json={"role": "staff"},
        )
        assert role_response.status_code == 200
        assert role_response.json()["role"] == "staff"

        status_response = client.post(
            f"/v1/staff/admin/users/{target_identity_id}/status",
            headers=headers,
            json={"is_active": False},
        )
        assert status_response.status_code == 200
        assert status_response.json()["is_active"] is False

        target_login = client.post("/v1/auth/login", json={"line_id_token": "stub:U_TARGET"})
        assert target_login.status_code == 403


def test_healthcare_request_status_uses_token_subject(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-subject.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        create_response = client.post(
            "/v1/identity/healthcare-access-request",
            json={"line_id_token": "stub:U_REQUESTER_OWNER"},
        )
        assert create_response.status_code == 200

        owner_status = client.post(
            "/v1/identity/healthcare-access-request/status",
            json={"line_id_token": "stub:U_REQUESTER_OWNER"},
        )
        assert owner_status.status_code == 200
        assert owner_status.json()["status"] == "pending"

        other_status = client.post(
            "/v1/identity/healthcare-access-request/status",
            json={"line_id_token": "stub:U_REQUESTER_OTHER"},
        )
        assert other_status.status_code == 200
        assert other_status.json()["status"] == "none"


def test_admin_user_list_supports_created_date_range_filters(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-created-at-filter.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_FILTER", role="admin")
        old_id = _seed_identity(client, line_user_id="U_OLD_USER", role="patient")
        mid_id = _seed_identity(client, line_user_id="U_MID_USER", role="staff")
        new_id = _seed_identity(client, line_user_id="U_NEW_USER", role="patient")

        _set_identity_created_at(client, identity_id=old_id, created_at=datetime(2026, 1, 2, 8, 0, tzinfo=timezone.utc))
        _set_identity_created_at(client, identity_id=mid_id, created_at=datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc))
        _set_identity_created_at(client, identity_id=new_id, created_at=datetime(2026, 2, 10, 12, 0, tzinfo=timezone.utc))

        token = _login_token(client, "U_ADMIN_FILTER")
        headers = {"Authorization": f"Bearer {token}"}

        jan_only = client.get(
            "/v1/staff/admin/users?created_from=2026-01-01&created_to=2026-01-31",
            headers=headers,
        )
        assert jan_only.status_code == 200
        jan_ids = {item["line_user_id"] for item in jan_only.json()["items"]}
        assert "U_OLD_USER" in jan_ids
        assert "U_MID_USER" in jan_ids
        assert "U_NEW_USER" not in jan_ids

        from_feb = client.get(
            "/v1/staff/admin/users?created_from=2026-02-01",
            headers=headers,
        )
        assert from_feb.status_code == 200
        feb_ids = {item["line_user_id"] for item in from_feb.json()["items"]}
        assert "U_NEW_USER" in feb_ids
        assert "U_MID_USER" not in feb_ids


def test_admin_user_list_returns_total_with_limit_offset_pagination(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-pagination.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_PAGINATION", role="admin")
        for index in range(12):
            _seed_identity(client, line_user_id=f"U_STAFF_PAGINATION_{index:02d}", role="staff")

        token = _login_token(client, "U_ADMIN_PAGINATION")
        headers = {"Authorization": f"Bearer {token}"}

        first_page = client.get("/v1/staff/admin/users?role=staff&limit=10&offset=0", headers=headers)
        assert first_page.status_code == 200
        first_payload = first_page.json()
        assert first_payload["total"] == 12
        assert first_payload["limit"] == 10
        assert first_payload["offset"] == 0
        assert len(first_payload["items"]) == 10

        second_page = client.get("/v1/staff/admin/users?role=staff&limit=10&offset=10", headers=headers)
        assert second_page.status_code == 200
        second_payload = second_page.json()
        assert second_payload["total"] == 12
        assert second_payload["limit"] == 10
        assert second_payload["offset"] == 10
        assert len(second_payload["items"]) == 2


def test_admin_user_list_sorts_by_assigned_patient_count_before_pagination(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-assignment-sort.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_ASSIGNMENT_SORT", role="admin")
        high_count_staff_id = _seed_identity(client, line_user_id="U_STAFF_ASSIGNMENT_HIGH", role="staff")
        low_count_staff_id = _seed_identity(client, line_user_id="U_STAFF_ASSIGNMENT_LOW", role="staff")

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            session.get(LiffIdentity, high_count_staff_id).created_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
            session.get(LiffIdentity, low_count_staff_id).created_at = datetime(2021, 1, 1, tzinfo=timezone.utc)
            patients = [
                Patient(case_number=f"SORT-{index}", birth_date="1990-01-01", full_name=f"Sort {index}")
                for index in range(3)
            ]
            session.add_all(patients)
            session.flush()
            session.add_all(
                [
                    StaffPatientAssignment(staff_identity_id=low_count_staff_id, patient_id=patients[0].id),
                    StaffPatientAssignment(staff_identity_id=high_count_staff_id, patient_id=patients[1].id),
                    StaffPatientAssignment(staff_identity_id=high_count_staff_id, patient_id=patients[2].id),
                ]
            )
            session.commit()

        token = _login_token(client, "U_ADMIN_ASSIGNMENT_SORT")
        response = client.get(
            "/v1/staff/admin/users?role=staff&sort=assigned_count_desc&limit=1&offset=0",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json()["total"] == 2
        assert [item["line_user_id"] for item in response.json()["items"]] == ["U_STAFF_ASSIGNMENT_HIGH"]


def test_admin_user_list_assigned_count_sort_ignores_inactive_patients(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-assignment-sort-inactive.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_ASSIGNMENT_SORT_INACTIVE", role="admin")
        active_staff_id = _seed_identity(client, line_user_id="U_STAFF_ASSIGNMENT_ACTIVE_ONLY", role="staff")
        inactive_only_staff_id = _seed_identity(client, line_user_id="U_STAFF_ASSIGNMENT_INACTIVE_ONLY", role="staff")

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            active_patient = Patient(case_number="SORT-ACTIVE", birth_date="1990-01-01")
            inactive_patient = Patient(case_number="SORT-INACTIVE", birth_date="1990-01-01", is_active=False)
            session.add_all([active_patient, inactive_patient])
            session.flush()
            session.add_all(
                [
                    StaffPatientAssignment(staff_identity_id=active_staff_id, patient_id=active_patient.id),
                    StaffPatientAssignment(staff_identity_id=inactive_only_staff_id, patient_id=inactive_patient.id),
                ]
            )
            session.commit()

        token = _login_token(client, "U_ADMIN_ASSIGNMENT_SORT_INACTIVE")
        response = client.get(
            "/v1/staff/admin/users?role=staff&sort=assigned_count_desc&limit=1&offset=0",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert [item["line_user_id"] for item in response.json()["items"]] == ["U_STAFF_ASSIGNMENT_ACTIVE_ONLY"]


def test_admin_user_list_includes_labeling_workload_for_staff_and_admin(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-workload.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_WORKLOAD", role="admin")
        staff_id = _seed_identity(client, line_user_id="U_STAFF_WORKLOAD", role="staff")

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            active_patient = Patient(case_number="WL-ACTIVE", birth_date="1990-01-01")
            inactive_patient = Patient(case_number="WL-INACTIVE", birth_date="1990-01-01", is_active=False)
            session.add_all([active_patient, inactive_patient])
            session.flush()
            session.add_all(
                [
                    StaffPatientAssignment(staff_identity_id=staff_id, patient_id=active_patient.id),
                    StaffPatientAssignment(staff_identity_id=staff_id, patient_id=inactive_patient.id),
                ]
            )
            uploads = []
            for patient_id, screening_result in (
                (active_patient.id, "normal"),
                (active_patient.id, "suspected"),
                (active_patient.id, "rejected"),
                (inactive_patient.id, "normal"),
            ):
                upload = Upload(patient_id=patient_id, object_key="k", content_type="image/jpeg")
                session.add(upload)
                session.flush()
                session.add(AIResult(upload_id=upload.id, screening_result=screening_result))
                uploads.append(upload)
            session.add(
                Annotation(
                    patient_id=active_patient.id,
                    upload_id=uploads[0].id,
                    reviewer_identity_id=staff_id,
                    label="normal",
                )
            )
            session.commit()

        token = _login_token(client, "U_ADMIN_WORKLOAD")
        response = client.get("/v1/staff/admin/users?exclude_patient=true", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        items = response.json()["items"]
        staff_item = next(item for item in items if item["line_user_id"] == "U_STAFF_WORKLOAD")
        workload = staff_item["workload"]
        # Both counts share one universe: the inactive patient is assigned but excluded
        # from the patient count and from the upload denominator alike.
        assert workload["assigned_patient_count"] == 1
        # Rejected uploads and uploads of inactive patients are outside the review queue.
        assert workload["assigned_upload_count"] == 2
        assert workload["labeled_assigned_upload_count"] == 1
        assert workload["labeled_assigned_ratio"] == 0.5
        assert workload["reviewed_upload_count"] == 1
        assert workload["last_reviewed_at"] is not None

        admin_item = next(item for item in items if item["line_user_id"] == "U_ADMIN_WORKLOAD")
        assert admin_item["workload"]["assigned_patient_count"] == 0
        assert admin_item["workload"]["labeled_assigned_ratio"] == 0.0


def test_admin_user_list_omits_workload_for_patient_identities(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-workload-patient.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_WORKLOAD_PATIENT", role="admin")
        _seed_identity(client, line_user_id="U_PATIENT_WORKLOAD", role="patient")

        token = _login_token(client, "U_ADMIN_WORKLOAD_PATIENT")
        response = client.get("/v1/staff/admin/users", headers={"Authorization": f"Bearer {token}"})

        assert response.status_code == 200
        items = response.json()["items"]
        patient_item = next(item for item in items if item["line_user_id"] == "U_PATIENT_WORKLOAD")
        assert patient_item["workload"] is None


def test_admin_user_list_includes_real_name_field_with_null_default(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-real-name-null.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_REALNAME", role="admin")
        _seed_identity(client, line_user_id="U_STAFF_REALNAME", role="staff")

        token = _login_token(client, "U_ADMIN_REALNAME")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/admin/users?exclude_patient=true", headers=headers)
        assert response.status_code == 200
        items = response.json()["items"]
        staff_item = next(item for item in items if item["line_user_id"] == "U_STAFF_REALNAME")
        assert "real_name" in staff_item
        assert staff_item["real_name"] is None
        assert "picture_url" in staff_item
        assert staff_item["picture_url"] is None


def test_admin_user_list_excludes_patient_when_requested(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-exclude-patient.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_EXCLUDE", role="admin")
        _seed_identity(client, line_user_id="U_PATIENT_EXCLUDE", role="patient")
        _seed_identity(client, line_user_id="U_STAFF_EXCLUDE", role="staff")

        token = _login_token(client, "U_ADMIN_EXCLUDE")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/admin/users?exclude_patient=true", headers=headers)
        assert response.status_code == 200
        items = response.json()["items"]
        roles = {item["role"] for item in items}
        ids = {item["line_user_id"] for item in items}

        assert "patient" not in roles
        assert "U_PATIENT_EXCLUDE" not in ids
        assert "U_STAFF_EXCLUDE" in ids
        assert "U_ADMIN_EXCLUDE" in ids

        tampered = client.get("/v1/staff/admin/users?exclude_patient=true&role=patient", headers=headers)
        assert tampered.status_code == 200
        assert tampered.json()["items"] == []


def test_admin_can_update_real_name_for_staff_or_admin(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-update-real-name.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_REAL_NAME_EDITOR", role="admin")
        staff_id = _seed_identity(client, line_user_id="U_STAFF_REAL_NAME_TARGET", role="staff", real_name=None)

        token = _login_token(client, "U_ADMIN_REAL_NAME_EDITOR")
        headers = {"Authorization": f"Bearer {token}"}

        update_response = client.post(
            f"/v1/staff/admin/users/{staff_id}/real-name",
            headers=headers,
            json={"real_name": "Dr. Wang"},
        )
        assert update_response.status_code == 200
        assert update_response.json()["real_name"] == "Dr. Wang"


def test_admin_cannot_update_real_name_for_patient_identity(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-update-real-name-patient.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_REAL_NAME_EDITOR", role="admin")
        patient_id = _seed_identity(client, line_user_id="U_PATIENT_REAL_NAME_TARGET", role="patient")

        token = _login_token(client, "U_ADMIN_REAL_NAME_EDITOR")
        headers = {"Authorization": f"Bearer {token}"}

        update_response = client.post(
            f"/v1/staff/admin/users/{patient_id}/real-name",
            headers=headers,
            json={"real_name": "Patient Name"},
        )
        assert update_response.status_code == 403


def test_admin_update_real_name_rejects_whitespace_only_value(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-update-real-name-blank.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_REAL_NAME_EDITOR", role="admin")
        staff_id = _seed_identity(client, line_user_id="U_STAFF_REAL_NAME_TARGET", role="staff")

        token = _login_token(client, "U_ADMIN_REAL_NAME_EDITOR")
        headers = {"Authorization": f"Bearer {token}"}

        update_response = client.post(
            f"/v1/staff/admin/users/{staff_id}/real-name",
            headers=headers,
            json={"real_name": "   "},
        )
        assert update_response.status_code == 400


def test_admin_real_name_update_is_reflected_in_list_query(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-real-name-query.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_REAL_NAME_EDITOR", role="admin")
        staff_id = _seed_identity(client, line_user_id="U_STAFF_QUERY_TARGET", role="staff")

        token = _login_token(client, "U_ADMIN_REAL_NAME_EDITOR")
        headers = {"Authorization": f"Bearer {token}"}

        update_response = client.post(
            f"/v1/staff/admin/users/{staff_id}/real-name",
            headers=headers,
            json={"real_name": "Dr. Query"},
        )
        assert update_response.status_code == 200

        query_response = client.get(
            "/v1/staff/admin/users?exclude_patient=true&query=Dr.%20Query",
            headers=headers,
        )
        assert query_response.status_code == 200
        ids = {item["line_user_id"] for item in query_response.json()["items"]}
        assert "U_STAFF_QUERY_TARGET" in ids


def test_admin_can_preview_and_delete_inactive_users_in_scope(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-bulk-delete.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_DELETE", role="admin")
        inactive_id = _seed_identity(client, line_user_id="U_INACTIVE_DELETE", role="patient", is_active=False)
        active_id = _seed_identity(client, line_user_id="U_ACTIVE_KEEP", role="patient", is_active=True)
        token = _login_token(client, "U_ADMIN_DELETE")
        headers = {"Authorization": f"Bearer {token}"}
        missing_id = 999999

        preview_response = client.post(
            "/v1/staff/admin/users/delete/preview",
            headers=headers,
            json={"identity_ids": [inactive_id, active_id, missing_id]},
        )
        assert preview_response.status_code == 200
        assert preview_response.json() == {
            "requested_count": 3,
            "deletable_count": 1,
            "skipped_active_count": 1,
            "skipped_missing_count": 1,
        }

        delete_response = client.post(
            "/v1/staff/admin/users/delete",
            headers=headers,
            json={"identity_ids": [inactive_id, active_id, missing_id]},
        )
        assert delete_response.status_code == 200
        assert delete_response.json() == {
            "requested_count": 3,
            "deleted_count": 1,
            "skipped_active_count": 1,
            "skipped_missing_count": 1,
        }

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.get(LiffIdentity, inactive_id) is None
            assert session.get(LiffIdentity, active_id) is not None


def test_admin_single_delete_path_blocks_active_identity(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-user-management-single-delete.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_SINGLE_DELETE", role="admin")
        active_id = _seed_identity(client, line_user_id="U_ACTIVE_SINGLE_KEEP", role="patient", is_active=True)
        inactive_id = _seed_identity(client, line_user_id="U_INACTIVE_SINGLE_DELETE", role="patient", is_active=False)
        token = _login_token(client, "U_ADMIN_SINGLE_DELETE")
        headers = {"Authorization": f"Bearer {token}"}

        active_delete = client.post(
            "/v1/staff/admin/users/delete",
            headers=headers,
            json={"identity_ids": [active_id]},
        )
        assert active_delete.status_code == 200
        assert active_delete.json()["deleted_count"] == 0
        assert active_delete.json()["skipped_active_count"] == 1

        inactive_delete = client.post(
            "/v1/staff/admin/users/delete",
            headers=headers,
            json={"identity_ids": [inactive_id]},
        )
        assert inactive_delete.status_code == 200
        assert inactive_delete.json()["deleted_count"] == 1

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.get(LiffIdentity, active_id) is not None
            assert session.get(LiffIdentity, inactive_id) is None


def _seed_reviews(
    client: TestClient,
    *,
    reviewer_identity_id: int,
    patient_id: int,
    created_ats: list[datetime],
) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        for index, created_at in enumerate(created_ats):
            upload = Upload(
                patient_id=patient_id,
                object_key=f"patients/{patient_id}/uploads/{reviewer_identity_id}-{index}.jpg",
                content_type="image/jpeg",
                created_at=created_at,
            )
            session.add(upload)
            session.flush()
            session.add(
                Annotation(
                    patient_id=patient_id,
                    upload_id=upload.id,
                    reviewer_identity_id=reviewer_identity_id,
                    label="normal",
                    comment=None,
                    patient_read_at=None,
                    created_at=created_at,
                )
            )
        session.commit()


def _seed_patient(client: TestClient, *, case_number: str, is_active: bool = True) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(
            case_number=case_number,
            birth_date="1980-01-01",
            full_name=case_number,
            gender="unknown",
            is_active=is_active,
        )
        session.add(patient)
        session.commit()
        session.refresh(patient)
        return patient.id


def test_staff_cannot_access_staff_overview(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-staff-overview-denied.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_STAFF_OVERVIEW_DENIED", role="staff")
        token = _login_token(client, "U_STAFF_OVERVIEW_DENIED")

        response = client.get("/v1/staff/admin/staff-overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403


def test_staff_overview_returns_workload_aggregates_per_staff(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-staff-overview-aggregates.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        admin_id = _seed_identity(client, line_user_id="U_ADMIN_OVERVIEW", role="admin", real_name="Admin Lin")
        busy_id = _seed_identity(client, line_user_id="U_STAFF_BUSY", role="staff", real_name="Nurse Busy")
        idle_id = _seed_identity(client, line_user_id="U_STAFF_IDLE", role="staff", real_name="Nurse Idle")
        _seed_identity(client, line_user_id="U_PATIENT_EXCLUDED", role="patient")

        patient_id = _seed_patient(client, case_number="CASE_OVERVIEW_1")
        unassigned_patient_id = _seed_patient(client, case_number="CASE_OVERVIEW_2")

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            session.add(StaffPatientAssignment(staff_identity_id=busy_id, patient_id=patient_id))
            session.commit()

        now = datetime.now(tz=timezone.utc)
        _seed_reviews(
            client,
            reviewer_identity_id=busy_id,
            patient_id=patient_id,
            # Two inside 7d, one more inside 30d, one older than 30d.
            created_ats=[
                now - timedelta(days=1),
                now - timedelta(days=3),
                now - timedelta(days=20),
                now - timedelta(days=45),
            ],
        )

        token = _login_token(client, "U_ADMIN_OVERVIEW")
        response = client.get("/v1/staff/admin/staff-overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        payload = response.json()

        by_id = {item["identity_id"]: item for item in payload["items"]}
        assert set(by_id) == {admin_id, busy_id, idle_id}, "patient identities must not appear in the staff roster"

        busy = by_id[busy_id]
        assert busy["assigned_patient_count"] == 1
        assert busy["review_count_7d"] == 2
        assert busy["review_count_30d"] == 3
        assert busy["last_review_at"] is not None
        assert busy["real_name"] == "Nurse Busy"
        assert busy["role"] == "staff"

        idle = by_id[idle_id]
        assert idle["assigned_patient_count"] == 0
        assert idle["review_count_7d"] == 0
        assert idle["review_count_30d"] == 0
        assert idle["last_review_at"] is None

        summary = payload["summary"]
        assert summary["staff_count"] == 3
        assert summary["staff_total"] == 3
        assert summary["truncated"] is False
        assert summary["active_staff_count"] == 3
        assert summary["zero_assignment_staff_count"] == 1, "only the idle nurse counts; admins carry no panel"
        assert summary["unassigned_patient_count"] == 1
        assert unassigned_patient_id != patient_id


def test_staff_overview_excludes_inactive_staff_from_coverage_gap_count(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-staff-overview-inactive.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_OVERVIEW_INACTIVE", role="admin")
        inactive_id = _seed_identity(client, line_user_id="U_STAFF_DEACTIVATED", role="staff", is_active=False)

        token = _login_token(client, "U_ADMIN_OVERVIEW_INACTIVE")
        response = client.get("/v1/staff/admin/staff-overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        payload = response.json()

        assert inactive_id in {item["identity_id"] for item in payload["items"]}, "roster still lists the account"
        summary = payload["summary"]
        assert summary["staff_count"] == 2
        assert summary["active_staff_count"] == 1
        assert summary["zero_assignment_staff_count"] == 0, "the lone active account is an admin, not a gap"


def test_authorization_audit_event_records_target_line_user_id(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-audit-target-line-user-id.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_AUDIT", role="admin")
        target_id = _seed_identity(client, line_user_id="U_TARGET_AUDIT", role="patient")
        token = _login_token(client, "U_ADMIN_AUDIT")
        headers = {"Authorization": f"Bearer {token}"}

        role_response = client.post(f"/v1/staff/admin/users/{target_id}/role", headers=headers, json={"role": "staff"})
        assert role_response.status_code == 200
        status_response = client.post(
            f"/v1/staff/admin/users/{target_id}/status", headers=headers, json={"is_active": False}
        )
        assert status_response.status_code == 200

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            events = (
                session.execute(
                    select(AuthorizationAuditEvent).where(AuthorizationAuditEvent.target_identity_id == target_id)
                )
                .scalars()
                .all()
            )
        assert len(events) == 2
        assert {event.action for event in events} == {"identity_role_update", "identity_status_update"}
        assert all(event.target_line_user_id == "U_TARGET_AUDIT" for event in events)


def test_deleting_identity_preserves_its_authorization_audit_history(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "admin-audit-survives-delete.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_AUDIT_DELETE", role="admin")
        target_id = _seed_identity(client, line_user_id="U_TARGET_AUDIT_DELETE", role="patient")
        token = _login_token(client, "U_ADMIN_AUDIT_DELETE")
        headers = {"Authorization": f"Bearer {token}"}

        assert (
            client.post(f"/v1/staff/admin/users/{target_id}/status", headers=headers, json={"is_active": False}).status_code
            == 200
        )
        delete_response = client.post("/v1/staff/admin/users/delete", headers=headers, json={"identity_ids": [target_id]})
        assert delete_response.status_code == 200
        assert delete_response.json()["deleted_count"] == 1

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            assert session.get(LiffIdentity, target_id) is None
            events = (
                session.execute(
                    select(AuthorizationAuditEvent).where(
                        AuthorizationAuditEvent.target_line_user_id == "U_TARGET_AUDIT_DELETE"
                    )
                )
                .scalars()
                .all()
            )
        assert len(events) == 1, "audit history must outlive the deleted identity"
        assert events[0].action == "identity_status_update"


def test_audit_target_identity_fk_nulls_out_instead_of_cascading(tmp_path: Path) -> None:
    """Schema-level guard: the migration must leave target_identity_id nullable with ON DELETE SET NULL."""
    db_path = tmp_path / "admin-audit-fk-shape.db"
    engine = create_engine(migrated_sqlite_database_url(db_path))
    try:
        inspector = inspect(engine)
        columns = {column["name"]: column for column in inspector.get_columns("authorization_audit_events")}
        assert "target_line_user_id" in columns
        assert columns["target_identity_id"]["nullable"] is True

        target_fks = [
            fk
            for fk in inspector.get_foreign_keys("authorization_audit_events")
            if fk.get("constrained_columns") == ["target_identity_id"]
        ]
        assert len(target_fks) == 1
        assert target_fks[0]["options"].get("ondelete", "").upper() == "SET NULL"
    finally:
        engine.dispose()


def test_staff_overview_matches_shared_workload_semantics(tmp_path: Path) -> None:
    """Roster figures must agree with the workload columns: active patients only, distinct uploads."""
    settings = make_settings(tmp_path / "admin-staff-overview-shared-semantics.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_SEMANTICS", role="admin")
        staff_id = _seed_identity(client, line_user_id="U_STAFF_SEMANTICS", role="staff")

        active_patient_id = _seed_patient(client, case_number="CASE_SEMANTICS_ACTIVE")
        retired_patient_id = _seed_patient(client, case_number="CASE_SEMANTICS_RETIRED", is_active=False)

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            session.add_all(
                [
                    StaffPatientAssignment(staff_identity_id=staff_id, patient_id=active_patient_id),
                    StaffPatientAssignment(staff_identity_id=staff_id, patient_id=retired_patient_id),
                ]
            )
            session.commit()

        now = datetime.now(tz=timezone.utc)
        _seed_reviews(client, reviewer_identity_id=staff_id, patient_id=active_patient_id, created_ats=[now - timedelta(days=1)])

        # A second pass over the same upload must not inflate the review counts.
        with session_factory() as session:
            upload_id = session.execute(select(Upload.id).where(Upload.patient_id == active_patient_id)).scalar_one()
            session.add(
                Annotation(
                    patient_id=active_patient_id,
                    upload_id=upload_id,
                    reviewer_identity_id=staff_id,
                    label="suspected_infection",
                    comment="re-reviewed",
                    patient_read_at=None,
                    created_at=now - timedelta(hours=2),
                )
            )
            session.commit()

        token = _login_token(client, "U_ADMIN_SEMANTICS")
        response = client.get("/v1/staff/admin/staff-overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        staff_row = next(item for item in response.json()["items"] if item["identity_id"] == staff_id)

        assert staff_row["assigned_patient_count"] == 1, "deactivated patients must not count toward workload"
        assert staff_row["review_count_7d"] == 1, "two annotations on one upload is one reviewed upload"
        assert staff_row["review_count_30d"] == 1
        assert staff_row["last_review_at"] is not None


def test_admin_cannot_demote_or_deactivate_their_own_account(tmp_path: Path) -> None:
    """Frontend disables these, but a crafted POST must not leave a clinic without an admin."""
    settings = make_settings(tmp_path / "admin-self-lockout.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        self_id = _seed_identity(client, line_user_id="U_ADMIN_SELF", role="admin")
        token = _login_token(client, "U_ADMIN_SELF")
        headers = {"Authorization": f"Bearer {token}"}

        demote = client.post(f"/v1/staff/admin/users/{self_id}/role", headers=headers, json={"role": "staff"})
        assert demote.status_code == 403

        deactivate = client.post(f"/v1/staff/admin/users/{self_id}/status", headers=headers, json={"is_active": False})
        assert deactivate.status_code == 403

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            identity = session.get(LiffIdentity, self_id)
            assert identity is not None
            assert identity.role == "admin", "self-demotion must not apply"
            assert identity.is_active is True, "self-deactivation must not apply"


def test_patient_assigned_only_to_deactivated_staff_counts_as_unassigned(tmp_path: Path) -> None:
    """An assignment row pointing at a disabled account is not coverage."""
    settings = make_settings(tmp_path / "admin-unassigned-universe.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_UNASSIGNED", role="admin")
        retired_staff_id = _seed_identity(client, line_user_id="U_STAFF_RETIRED", role="staff", is_active=False)
        active_staff_id = _seed_identity(client, line_user_id="U_STAFF_ON_DUTY", role="staff")

        orphaned_patient_id = _seed_patient(client, case_number="CASE_ORPHANED")
        covered_patient_id = _seed_patient(client, case_number="CASE_COVERED")

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            session.add_all(
                [
                    StaffPatientAssignment(staff_identity_id=retired_staff_id, patient_id=orphaned_patient_id),
                    StaffPatientAssignment(staff_identity_id=active_staff_id, patient_id=covered_patient_id),
                ]
            )
            session.commit()

        token = _login_token(client, "U_ADMIN_UNASSIGNED")
        response = client.get("/v1/staff/admin/staff-overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        summary = response.json()["summary"]
        assert summary["unassigned_patient_count"] == 1, "the patient whose only nurse was disabled is a gap"


def test_relabelled_annotation_counts_as_recent_review_activity(tmp_path: Path) -> None:
    """upsert updates the row in place, so recency must read updated_at, not created_at."""
    settings = make_settings(tmp_path / "admin-relabel-recency.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_identity(client, line_user_id="U_ADMIN_RELABEL", role="admin")
        staff_id = _seed_identity(client, line_user_id="U_STAFF_RELABEL", role="staff")
        patient_id = _seed_patient(client, case_number="CASE_RELABEL")

        now = datetime.now(tz=timezone.utc)
        # Annotation was first written long outside the 30 day window...
        _seed_reviews(client, reviewer_identity_id=staff_id, patient_id=patient_id, created_ats=[now - timedelta(days=90)])
        # ...then re-labelled today, which updates the row in place.
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            annotation = session.execute(
                select(Annotation).where(Annotation.reviewer_identity_id == staff_id)
            ).scalar_one()
            annotation.label = "suspected_infection"
            annotation.updated_at = now - timedelta(hours=1)
            session.commit()

        token = _login_token(client, "U_ADMIN_RELABEL")
        response = client.get("/v1/staff/admin/staff-overview", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        staff_row = next(item for item in response.json()["items"] if item["identity_id"] == staff_id)

        assert staff_row["review_count_7d"] == 1, "re-labelling is review activity"
        assert staff_row["review_count_30d"] == 1
        assert staff_row["last_review_at"] is not None
