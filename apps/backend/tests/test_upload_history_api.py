from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, LiffIdentity, Patient, PendingBinding, Upload
from app.main import create_app


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


def _seed_matched_identity(client: TestClient, line_user_id: str = "U_LINE_MATCHED") -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(case_number="P111111", birth_date="1981-01-01", full_name="Patient A", is_active=True)
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


def test_upload_history_returns_aggregated_days_for_matched_patient(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-matched.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        patient_id = _seed_matched_identity(client, line_user_id="U_LINE_HISTORY")
        _seed_upload_history(client, patient_id=patient_id)

        response = client.get("/v1/patient/upload-history", params={"line_user_id": "U_LINE_HISTORY"})

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "matched"
        assert payload["patient_id"] == patient_id
        assert payload["can_upload"] is True
        assert payload["days"] == [
            {"date": "2026-05-08", "upload_count": 2, "has_suspected_risk": True},
            {"date": "2026-05-09", "upload_count": 1, "has_suspected_risk": False},
        ]


def test_upload_history_returns_pending_status_without_day_data(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-pending.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_pending_identity(client)

        response = client.get("/v1/patient/upload-history", params={"line_user_id": "U_LINE_PENDING"})

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "pending"
        assert payload["patient_id"] is None
        assert payload["can_upload"] is False
        assert payload["days"] == []


def test_upload_history_returns_unbound_status_without_day_data(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "history-unbound.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        response = client.get("/v1/patient/upload-history", params={"line_user_id": "U_LINE_UNBOUND"})

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "unbound"
        assert payload["patient_id"] is None
        assert payload["can_upload"] is False
        assert payload["days"] == []
