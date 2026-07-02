from __future__ import annotations
# pyright: reportMissingImports=false

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.db.models import AIResult, Notification
from app.main import create_app
from tests.test_staff_dashboard_api import (
    _assign_staff_patient,
    _issue_patient_token,
    _login_staff_token,
    _seed_notifications_for_patient,
    _seed_patient_with_uploads,
    _seed_staff,
    make_settings,
)


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


def test_staff_notifications_are_limited_to_assigned_patients(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-notifications-assignment-scope.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        assigned_patient_id, _, _ = _seed_notifications_for_patient(
            client,
            line_user_id="U_PATIENT_NOTIFY_ASSIGNED",
            case_number="P-NOTIFY-ASSIGNED",
            full_name="Notify Assigned",
            object_key_prefix="201",
        )
        unassigned_patient_id, _, _ = _seed_notifications_for_patient(
            client,
            line_user_id="U_PATIENT_NOTIFY_UNASSIGNED",
            case_number="P-NOTIFY-UNASSIGNED",
            full_name="Notify Unassigned",
            object_key_prefix="202",
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/notifications", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 2
        assert payload["unread_count"] == 1
        assert all(item["patient_id"] == assigned_patient_id for item in payload["items"])
        assert all(item["patient_id"] != unassigned_patient_id for item in payload["items"])


def test_staff_cannot_mark_unassigned_notification_as_read(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-notifications-mark-scope.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        assigned_patient_id, _, _ = _seed_notifications_for_patient(
            client,
            line_user_id="U_PATIENT_NOTIFY_MARK_ASSIGNED",
            case_number="P-NOTIFY-MARK-ASSIGNED",
            full_name="Notify Mark Assigned",
            object_key_prefix="203",
        )
        unassigned_patient_id, _, _ = _seed_notifications_for_patient(
            client,
            line_user_id="U_PATIENT_NOTIFY_MARK_UNASSIGNED",
            case_number="P-NOTIFY-MARK-UNASSIGNED",
            full_name="Notify Mark Unassigned",
            object_key_prefix="204",
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            unassigned_notification = (
                session.query(Notification)
                .filter(Notification.patient_id == unassigned_patient_id, Notification.status == "new")
                .one()
            )
            assigned_notification = (
                session.query(Notification)
                .filter(Notification.patient_id == assigned_patient_id, Notification.status == "new")
                .one()
            )

        forbidden_response = client.post(f"/v1/staff/notifications/{unassigned_notification.id}/read", headers=headers)
        assert forbidden_response.status_code == 403

        allowed_response = client.post(f"/v1/staff/notifications/{assigned_notification.id}/read", headers=headers)
        assert allowed_response.status_code == 200
        assert allowed_response.json()["patient_id"] == assigned_patient_id


def test_admin_notifications_are_not_assignment_scoped(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-notifications-admin-scope.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_ADMIN_NOTIFY_SCOPE", role="admin")
        patient_a_id, _, _ = _seed_notifications_for_patient(
            client,
            line_user_id="U_PATIENT_NOTIFY_ADMIN_A",
            case_number="P-NOTIFY-ADMIN-A",
            full_name="Notify Admin A",
            object_key_prefix="205",
        )
        patient_b_id, _, _ = _seed_notifications_for_patient(
            client,
            line_user_id="U_PATIENT_NOTIFY_ADMIN_B",
            case_number="P-NOTIFY-ADMIN-B",
            full_name="Notify Admin B",
            object_key_prefix="206",
        )
        token = _login_staff_token(client, "U_ADMIN_NOTIFY_SCOPE")
        headers = {"Authorization": f"Bearer {token}"}

        list_response = client.get("/v1/staff/notifications", headers=headers)
        assert list_response.status_code == 200
        payload = list_response.json()
        assert payload["total"] == 4
        assert payload["unread_count"] == 2
        patient_ids = {item["patient_id"] for item in payload["items"]}
        assert patient_a_id in patient_ids
        assert patient_b_id in patient_ids

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            patient_b_notification = (
                session.query(Notification)
                .filter(Notification.patient_id == patient_b_id, Notification.status == "new")
                .one()
            )

        mark_response = client.post(f"/v1/staff/notifications/{patient_b_notification.id}/read", headers=headers)
        assert mark_response.status_code == 200
        assert mark_response.json()["patient_id"] == patient_b_id


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
