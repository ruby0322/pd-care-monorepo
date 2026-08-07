from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Patient, StaffPatientAssignment, Upload
from app.main import create_app
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-staff-workbench-api",
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


def _taipei_day_start_utc(local_day: datetime) -> datetime:
    taipei_tz = timezone(timedelta(hours=8))
    return datetime.combine(local_day.date(), datetime.min.time(), tzinfo=taipei_tz).astimezone(timezone.utc)


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


def _login_staff_token(client: TestClient, line_user_id: str = "U_STAFF") -> str:
    response = client.post("/v1/auth/login", json={"line_id_token": f"stub:{line_user_id}"})
    assert response.status_code == 200
    return response.json()["access_token"]


def _assign_staff_patient(client: TestClient, *, staff_identity_id: int, patient_id: int) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(StaffPatientAssignment(staff_identity_id=staff_identity_id, patient_id=patient_id))
        session.commit()


def _seed_patient_uploads(
    client: TestClient,
    *,
    case_number: str,
    line_user_id: str,
    uploads: list[tuple[datetime, str]],
    is_active: bool = True,
) -> tuple[int, list[int]]:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(
            case_number=case_number,
            birth_date="1985-01-01",
            full_name=case_number,
            is_active=is_active,
        )
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
        upload_ids: list[int] = []
        for index, (created_at, result) in enumerate(uploads, start=1):
            upload = Upload(
                patient_id=patient.id,
                object_key=f"patients/{patient.id}/uploads/{index}.jpg",
                content_type="image/jpeg",
                created_at=created_at,
            )
            session.add(upload)
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result=result, probability=0.8, threshold=0.5))
            upload_ids.append(upload.id)
        session.commit()
        return patient.id, upload_ids


def test_workbench_excludes_rejected_only_day(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "workbench-rejected.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        day = datetime(2026, 7, 15, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        patient_id, _ = _seed_patient_uploads(
            client,
            case_number="P-REJ",
            line_user_id="U_REJ",
            uploads=[
                (_taipei_day_start_utc(day) + timedelta(hours=1), "rejected"),
                (_taipei_day_start_utc(day) + timedelta(hours=2), "rejected"),
                (_taipei_day_start_utc(day) + timedelta(hours=3), "rejected"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        workbench = client.get(
            "/v1/staff/dashboard/workbench",
            headers=headers,
            params={"local_date": "2026-07-15", "week_start": "2026-07-12"},
        )
        assert workbench.status_code == 200
        payload = workbench.json()
        assert len(payload["week_days"]) == 7
        day_item = next(item for item in payload["week_days"] if item["local_date"] == "2026-07-15")
        assert day_item["upload_count"] == 0
        assert day_item["uploaded_users"] == 0
        assert day_item["risky_patient_count"] == 0
        assert "2026-07-15" not in payload["available_dates"]
        assert payload["attention"]["items"] == []
        assert payload["attention"]["total_uploads"] == 0

        days_all = client.get("/v1/staff/uploads/history-overview/days", headers=headers)
        assert days_all.status_code == 200
        assert any(item["local_date"] == "2026-07-15" for item in days_all.json()["items"])

        days_workbench = client.get(
            "/v1/staff/uploads/history-overview/days",
            headers=headers,
            params={"scope": "workbench"},
        )
        assert days_workbench.status_code == 200
        assert not any(item["local_date"] == "2026-07-15" for item in days_workbench.json()["items"])


def test_workbench_excludes_inactive_only_day(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "workbench-inactive.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        day = datetime(2026, 7, 15, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        patient_id, _ = _seed_patient_uploads(
            client,
            case_number="P-INACTIVE",
            line_user_id="U_INACTIVE",
            is_active=False,
            uploads=[(_taipei_day_start_utc(day) + timedelta(hours=1), "normal")],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        workbench = client.get(
            "/v1/staff/dashboard/workbench",
            headers=headers,
            params={"local_date": "2026-07-15", "week_start": "2026-07-12"},
        )
        assert workbench.status_code == 200
        payload = workbench.json()
        day_item = next(item for item in payload["week_days"] if item["local_date"] == "2026-07-15")
        assert day_item["upload_count"] == 0
        assert day_item["uploaded_users"] == 0
        assert "2026-07-15" not in payload["available_dates"]
        assert payload["attention"]["items"] == []


def test_workbench_aligns_week_metrics_with_attention(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "workbench-align.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        day = datetime(2026, 7, 16, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        day_start = _taipei_day_start_utc(day)
        patient_a, _ = _seed_patient_uploads(
            client,
            case_number="P-A",
            line_user_id="U_A",
            uploads=[
                (day_start + timedelta(hours=1), "normal"),
                (day_start + timedelta(hours=2), "suspected"),
            ],
        )
        patient_b, _ = _seed_patient_uploads(
            client,
            case_number="P-B",
            line_user_id="U_B",
            uploads=[(day_start + timedelta(hours=3), "normal")],
        )
        # Out-of-week noise should not inflate week_days.
        other_month = datetime(2026, 5, 1, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        patient_c, _ = _seed_patient_uploads(
            client,
            case_number="P-C",
            line_user_id="U_C",
            uploads=[(_taipei_day_start_utc(other_month) + timedelta(hours=1), "suspected")],
        )
        for patient_id in (patient_a, patient_b, patient_c):
            _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)

        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        workbench = client.get(
            "/v1/staff/dashboard/workbench",
            headers=headers,
            params={"local_date": "2026-07-16", "week_start": "2026-07-12"},
        )
        assert workbench.status_code == 200
        payload = workbench.json()
        assert len(payload["week_days"]) == 7
        day_item = next(item for item in payload["week_days"] if item["local_date"] == "2026-07-16")
        attention = payload["attention"]
        assert day_item["uploaded_users"] == len(attention["items"])
        assert day_item["upload_count"] == sum(item["day_upload_count"] for item in attention["items"])
        assert day_item["upload_count"] == 3
        assert day_item["uploaded_users"] == 2
        assert day_item["risky_patient_count"] == 1
        assert "2026-07-16" in payload["available_dates"]
        assert "2026-05-01" in payload["available_dates"]


def test_workbench_available_dates_sql_distinct_and_utc_boundary(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "workbench-sql-dates.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        patient_id, _ = _seed_patient_uploads(
            client,
            case_number="P-DATES",
            line_user_id="U_DATES",
            uploads=[
                # Same Taipei day (2026-07-16): two uploads should dedupe to one available date.
                (datetime(2026, 7, 16, 1, 0, tzinfo=timezone.utc), "normal"),
                (datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc), "normal"),
                # 17:00 UTC is 2026-07-17 in Taipei.
                (datetime(2026, 7, 16, 17, 0, tzinfo=timezone.utc), "normal"),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=patient_id)
        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}

        workbench = client.get(
            "/v1/staff/dashboard/workbench",
            headers=headers,
            params={"local_date": "2026-07-16", "week_start": "2026-07-12"},
        )
        assert workbench.status_code == 200
        available_dates = workbench.json()["available_dates"]
        assert available_dates.count("2026-07-16") == 1
        assert "2026-07-17" in available_dates
        assert "2026-07-15" not in available_dates
        assert available_dates.index("2026-07-17") < available_dates.index("2026-07-16")


def test_image_access_batch_partial_errors(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "image-batch.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        day = datetime(2026, 7, 16, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        assigned_id, assigned_upload_ids = _seed_patient_uploads(
            client,
            case_number="P-ASSIGNED",
            line_user_id="U_ASSIGNED",
            uploads=[(_taipei_day_start_utc(day) + timedelta(hours=1), "normal")],
        )
        unassigned_id, unassigned_upload_ids = _seed_patient_uploads(
            client,
            case_number="P-UNASSIGNED",
            line_user_id="U_UNASSIGNED",
            uploads=[(_taipei_day_start_utc(day) + timedelta(hours=2), "normal")],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_id)
        del unassigned_id  # intentionally not assigned

        token = _login_staff_token(client)
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post(
            "/v1/staff/uploads/image-access/batch",
            headers=headers,
            json={"upload_ids": [assigned_upload_ids[0], unassigned_upload_ids[0], 999999]},
        )
        assert response.status_code == 200
        items = {item["upload_id"]: item for item in response.json()["items"]}
        assert items[assigned_upload_ids[0]]["image_url"] is not None
        assert items[assigned_upload_ids[0]]["error"] is None
        assert items[unassigned_upload_ids[0]]["error"] == "forbidden"
        assert items[999999]["error"] == "not_found"
