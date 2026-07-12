from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import LiffIdentity, Patient, StaffPatientAssignment
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
