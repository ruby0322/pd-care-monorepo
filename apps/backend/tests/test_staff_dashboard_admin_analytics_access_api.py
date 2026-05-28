from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db.models import AIResult, LiffIdentity, Patient, Upload
from app.main import create_app
from tests.test_staff_dashboard_api import (
    _assign_staff_patient,
    _login_staff_token,
    _seed_admin_analytics_data,
    _seed_patient_with_uploads,
    _seed_staff,
    make_settings,
)


@pytest.fixture(autouse=True)
def _disable_storage_bucket_init(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.main.StorageService.ensure_bucket_exists", lambda _self: None)


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
        today_key = datetime.now(tz=timezone.utc).date().isoformat()
        today_item = next(item for item in daily_payload["items"] if item["date"] == today_key)
        assert today_item["total_uploads"] == 2
        assert today_item["suspected_uploads"] == 1
        assert today_item["suspected_ratio"] == 0.5
        assert any(item["total_uploads"] == 0 and item["suspected_ratio"] == 0 for item in daily_payload["items"])


def test_admin_analytics_endpoints_apply_patient_filters(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-analytics-filters.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_ADMIN_ANALYTICS_FILTERS", role="admin")
        now = datetime.now(tz=timezone.utc)

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            bound_suspected = Patient(
                case_number="FILT-B-001",
                birth_date="1988-01-01",
                full_name="Bound Suspected Patient",
                gender="male",
                is_active=True,
            )
            unbound_normal = Patient(
                case_number="FILT-U-001",
                birth_date="1977-06-15",
                full_name="Unbound Normal Patient",
                gender="female",
                is_active=True,
            )
            bound_inactive = Patient(
                case_number="FILT-B-002",
                birth_date="1995-09-20",
                full_name="Bound Inactive Patient",
                gender="other",
                is_active=False,
            )
            session.add_all([bound_suspected, unbound_normal, bound_inactive])
            session.flush()

            session.add_all(
                [
                    LiffIdentity(
                        line_user_id="U_FILTER_BOUND_1",
                        display_name="Bound Suspected",
                        picture_url=None,
                        patient_id=bound_suspected.id,
                        role="patient",
                    ),
                    LiffIdentity(
                        line_user_id="U_FILTER_BOUND_2",
                        display_name="Bound Inactive",
                        picture_url=None,
                        patient_id=bound_inactive.id,
                        role="patient",
                    ),
                ]
            )

            uploads = [
                Upload(
                    patient_id=bound_suspected.id,
                    object_key="patients/filter/uploads/bound-suspected.jpg",
                    content_type="image/jpeg",
                    created_at=now - timedelta(hours=1),
                ),
                Upload(
                    patient_id=unbound_normal.id,
                    object_key="patients/filter/uploads/unbound-normal.jpg",
                    content_type="image/jpeg",
                    created_at=now - timedelta(hours=2),
                ),
                Upload(
                    patient_id=bound_inactive.id,
                    object_key="patients/filter/uploads/bound-inactive.jpg",
                    content_type="image/jpeg",
                    created_at=now - timedelta(hours=3),
                ),
            ]
            session.add_all(uploads)
            session.flush()
            session.add_all(
                [
                    AIResult(upload_id=uploads[0].id, screening_result="suspected", probability=0.91, threshold=0.5),
                    AIResult(upload_id=uploads[1].id, screening_result="normal", probability=0.19, threshold=0.5),
                    AIResult(upload_id=uploads[2].id, screening_result="normal", probability=0.21, threshold=0.5),
                ]
            )
            session.commit()

        token = _login_staff_token(client, "U_ADMIN_ANALYTICS_FILTERS")
        headers = {"Authorization": f"Bearer {token}"}

        bound_suspected_response = client.get(
            "/v1/staff/admin/analytics/gender-distribution?binding_filter=bound&infection_status=suspected",
            headers=headers,
        )
        assert bound_suspected_response.status_code == 200
        bound_suspected_payload = bound_suspected_response.json()
        assert bound_suspected_payload["total_patients"] == 1
        gender_counts = {item["gender"]: item["count"] for item in bound_suspected_payload["items"]}
        assert gender_counts["male"] == 1
        assert gender_counts["female"] == 0
        assert gender_counts["other"] == 0
        assert gender_counts["unknown"] == 0

        unbound_query_response = client.get(
            "/v1/staff/admin/analytics/gender-distribution?binding_filter=unbound_only&query=Unbound",
            headers=headers,
        )
        assert unbound_query_response.status_code == 200
        unbound_query_payload = unbound_query_response.json()
        assert unbound_query_payload["total_patients"] == 1
        unbound_gender_counts = {item["gender"]: item["count"] for item in unbound_query_payload["items"]}
        assert unbound_gender_counts["female"] == 1

        inactive_histogram_response = client.get(
            "/v1/staff/admin/analytics/age-histogram?binding_filter=bound&is_active_filter=inactive&include_inactive=true",
            headers=headers,
        )
        assert inactive_histogram_response.status_code == 200
        inactive_histogram_payload = inactive_histogram_response.json()
        assert inactive_histogram_payload["total_patients"] == 1
        assert sum(item["count"] for item in inactive_histogram_payload["items"]) == 1


def test_staff_is_denied_for_admin_analytics_endpoints(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "staff-dashboard-admin-analytics-rbac.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client, line_user_id="U_STAFF_ANALYTICS", role="staff")
        token = _login_staff_token(client, "U_STAFF_ANALYTICS")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/v1/staff/admin/analytics/gender-distribution", headers=headers)
        assert response.status_code == 403
