from __future__ import annotations
# pyright: reportMissingImports=false

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import AIResult, Annotation, LiffIdentity, Patient, StaffPatientAssignment, Upload
from app.main import create_app
from tests.db_test_utils import migrated_sqlite_database_url


def make_settings(db_path: Path) -> Settings:
    return Settings(
        app_name="test-staff-today-attention-api",
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


def _taipei_today_start_utc() -> datetime:
    taipei_tz = timezone(timedelta(hours=8))
    taipei_today = datetime.now(tz=timezone.utc).astimezone(taipei_tz).date()
    return datetime.combine(taipei_today, datetime.min.time(), tzinfo=taipei_tz).astimezone(timezone.utc)


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


def _seed_today_patient(
    client: TestClient,
    *,
    case_number: str,
    line_user_id: str,
    uploads: list[tuple[timedelta, str, dict[str, bool] | None]],
) -> tuple[int, list[int]]:
    day_start = _taipei_today_start_utc()
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        patient = Patient(
            case_number=case_number,
            birth_date="1985-01-01",
            full_name=case_number,
            is_active=True,
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
        for index, (offset, result, symptoms) in enumerate(uploads, start=1):
            upload = Upload(
                patient_id=patient.id,
                object_key=f"patients/{patient.id}/uploads/{index}.jpg",
                content_type="image/jpeg",
                created_at=day_start + offset,
                symptom_pain=bool(symptoms and symptoms.get("pain")),
                symptom_pus=bool(symptoms and symptoms.get("pus")),
                symptom_cloudy_dialysate=bool(symptoms and symptoms.get("cloudy")),
            )
            session.add(upload)
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result=result, probability=0.8, threshold=0.5))
            upload_ids.append(upload.id)
        session.commit()
        return patient.id, upload_ids


def test_today_attention_partitions_sorts_and_marks_annotation(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-partition.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        suspected_later_id, _ = _seed_today_patient(
            client,
            case_number="P-SUS-LATE",
            line_user_id="U_SUS_LATE",
            uploads=[(timedelta(hours=4), "suspected", None)],
        )
        suspected_earlier_id, suspected_upload_ids = _seed_today_patient(
            client,
            case_number="P-SUS-EARLY",
            line_user_id="U_SUS_EARLY",
            uploads=[(timedelta(hours=1), "suspected", None)],
        )
        elevated_id, elevated_upload_ids = _seed_today_patient(
            client,
            case_number="P-ELEV",
            line_user_id="U_ELEV",
            uploads=[(timedelta(hours=2), "normal", {"pain": True})],
        )
        other_id, other_upload_ids = _seed_today_patient(
            client,
            case_number="P-OTHER",
            line_user_id="U_OTHER",
            uploads=[
                (timedelta(hours=1), "normal", None),
                (timedelta(hours=5), "normal", None),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=suspected_later_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=suspected_earlier_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=elevated_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=other_id)

        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            session.add(
                Annotation(
                    patient_id=suspected_earlier_id,
                    upload_id=suspected_upload_ids[0],
                    reviewer_identity_id=staff_identity_id,
                    label="suspected",
                    comment=None,
                )
            )
            session.commit()

        token = _login_staff_token(client)
        response = client.get(
            "/v1/staff/uploads/today-attention",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total_uploads"] == 5
        assert payload["suspected_patients"] == 2
        assert payload["elevated_patients"] == 1
        assert payload["other_patients"] == 1

        tiers = [item["tier"] for item in payload["items"]]
        assert tiers == ["suspected", "suspected", "elevated", "other"]
        assert payload["items"][0]["patient_id"] == suspected_earlier_id
        assert payload["items"][0]["has_annotation"] is True
        assert payload["items"][1]["patient_id"] == suspected_later_id
        assert payload["items"][1]["has_annotation"] is False
        assert payload["items"][2]["patient_id"] == elevated_id
        assert payload["items"][2]["representative_upload_id"] == elevated_upload_ids[0]
        # Other tier uses latest upload as representative, earliest for sort.
        assert payload["items"][3]["patient_id"] == other_id
        assert payload["items"][3]["representative_upload_id"] == other_upload_ids[1]
        assert payload["items"][3]["day_upload_count"] == 2
        assert payload["items"][3]["preview_upload_ids"] == other_upload_ids
        assert payload["items"][3]["risk_highlight"] is None
        assert payload["items"][0]["risk_highlight"] is not None
        assert payload["items"][0]["risk_highlight"]["upload_id"] == suspected_upload_ids[0]
        assert payload["items"][0]["day_upload_count"] == 1


def test_today_attention_local_date_filters_day(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-local-date.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        today_patient_id, _ = _seed_today_patient(
            client,
            case_number="P-TODAY",
            line_user_id="U_TODAY",
            uploads=[(timedelta(hours=2), "suspected", None)],
        )
        past_day_start = _taipei_today_start_utc() - timedelta(days=2)
        session_factory = client.app.state.db_session_factory
        with session_factory() as session:
            patient = Patient(
                case_number="P-PAST",
                birth_date="1985-01-01",
                full_name="P-PAST",
                is_active=True,
            )
            session.add(patient)
            session.flush()
            session.add(
                LiffIdentity(
                    line_user_id="U_PAST",
                    display_name="P-PAST",
                    picture_url="https://example.com/past.png",
                    patient_id=patient.id,
                    role="patient",
                )
            )
            upload = Upload(
                patient_id=patient.id,
                object_key=f"patients/{patient.id}/uploads/1.jpg",
                content_type="image/jpeg",
                created_at=past_day_start + timedelta(hours=3),
            )
            session.add(upload)
            session.flush()
            session.add(AIResult(upload_id=upload.id, screening_result="suspected", probability=0.9, threshold=0.5))
            past_patient_id = patient.id
            past_upload_id = upload.id
            session.commit()

        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=today_patient_id)
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=past_patient_id)

        token = _login_staff_token(client)
        past_date = (past_day_start.astimezone(timezone(timedelta(hours=8))).date()).isoformat()
        response = client.get(
            "/v1/staff/uploads/today-attention",
            params={"local_date": past_date},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["date"] == past_date
        assert payload["total_uploads"] == 1
        assert payload["suspected_patients"] == 1
        assert [item["patient_id"] for item in payload["items"]] == [past_patient_id]
        assert payload["items"][0]["picture_url"] == "https://example.com/past.png"
        assert payload["items"][0]["risk_highlight"]["upload_id"] == past_upload_id

        empty_response = client.get(
            "/v1/staff/uploads/today-attention",
            params={"local_date": "2020-01-01"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert empty_response.status_code == 200
        empty_payload = empty_response.json()
        assert empty_payload["date"] == "2020-01-01"
        assert empty_payload["total_uploads"] == 0
        assert empty_payload["items"] == []


def test_today_attention_respects_staff_assignment_scope(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-scope.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        assigned_id, _ = _seed_today_patient(
            client,
            case_number="P-ASSIGNED",
            line_user_id="U_ASSIGNED",
            uploads=[(timedelta(hours=3), "suspected", None)],
        )
        _seed_today_patient(
            client,
            case_number="P-UNASSIGNED",
            line_user_id="U_UNASSIGNED",
            uploads=[(timedelta(hours=2), "suspected", None)],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=assigned_id)

        token = _login_staff_token(client)
        response = client.get(
            "/v1/staff/uploads/today-attention",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["suspected_patients"] == 1
        assert [item["patient_id"] for item in payload["items"]] == [assigned_id]


def test_today_attention_other_tier_returns_four_preview_ids_when_more_than_four_uploads(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-four-previews.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        staff_identity_id = _seed_staff(client)
        other_id, other_upload_ids = _seed_today_patient(
            client,
            case_number="P-OTHER-FIVE",
            line_user_id="U_OTHER_FIVE",
            uploads=[
                (timedelta(hours=1), "normal", None),
                (timedelta(hours=2), "normal", None),
                (timedelta(hours=3), "normal", None),
                (timedelta(hours=4), "normal", None),
                (timedelta(hours=5), "normal", None),
            ],
        )
        _assign_staff_patient(client, staff_identity_id=staff_identity_id, patient_id=other_id)

        token = _login_staff_token(client)
        response = client.get(
            "/v1/staff/uploads/today-attention",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["items"][0]["patient_id"] == other_id
        assert payload["items"][0]["day_upload_count"] == 5
        assert payload["items"][0]["preview_upload_ids"] == other_upload_ids[:4]


def test_today_attention_empty_day(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-empty.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        _seed_staff(client)
        token = _login_staff_token(client)
        response = client.get(
            "/v1/staff/uploads/today-attention",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total_uploads"] == 0
        assert payload["suspected_patients"] == 0
        assert payload["elevated_patients"] == 0
        assert payload["other_patients"] == 0
        assert payload["items"] == []


def _seed_reviewer(
    client: TestClient,
    *,
    line_user_id: str,
    real_name: str | None,
    display_name: str | None = "Staff",
) -> int:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        identity = LiffIdentity(
            line_user_id=line_user_id,
            display_name=display_name,
            real_name=real_name,
            picture_url=None,
            patient_id=None,
            role="staff",
        )
        session.add(identity)
        session.commit()
        session.refresh(identity)
        return identity.id


def _add_annotation(
    client: TestClient,
    *,
    patient_id: int,
    upload_id: int,
    reviewer_identity_id: int,
    created_at: datetime,
) -> None:
    session_factory = client.app.state.db_session_factory
    with session_factory() as session:
        session.add(
            Annotation(
                patient_id=patient_id,
                upload_id=upload_id,
                reviewer_identity_id=reviewer_identity_id,
                label="suspected",
                comment=None,
                created_at=created_at,
            )
        )
        session.commit()


def _fetch_single_attention_item(client: TestClient, *, line_user_id: str = "U_STAFF") -> dict:
    token = _login_staff_token(client, line_user_id)
    response = client.get(
        "/v1/staff/uploads/today-attention",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    return items[0]


def test_today_attention_reports_latest_annotation_reviewer_and_count(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-reviewer.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        viewer_id = _seed_reviewer(client, line_user_id="U_STAFF", real_name="王小美")
        other_id = _seed_reviewer(client, line_user_id="U_OTHER_STAFF", real_name="林美玲")
        patient_id, upload_ids = _seed_today_patient(
            client,
            case_number="P-REVIEWER",
            line_user_id="U_PATIENT_REVIEWER",
            uploads=[(timedelta(hours=1), "suspected", None)],
        )
        _assign_staff_patient(client, staff_identity_id=viewer_id, patient_id=patient_id)

        day_start = _taipei_today_start_utc()
        _add_annotation(
            client,
            patient_id=patient_id,
            upload_id=upload_ids[0],
            reviewer_identity_id=viewer_id,
            created_at=day_start + timedelta(hours=1),
        )
        _add_annotation(
            client,
            patient_id=patient_id,
            upload_id=upload_ids[0],
            reviewer_identity_id=other_id,
            created_at=day_start + timedelta(hours=2),
        )

        item = _fetch_single_attention_item(client)
        assert item["annotation_reviewer_name"] == "林美玲"
        assert item["annotation_reviewed_by_me"] is False
        assert item["annotation_reviewer_count"] == 2
        expected_at = (day_start + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")
        assert item["annotation_reviewed_at"].startswith(expected_at)


def test_today_attention_flags_own_annotation(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-reviewer-self.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        viewer_id = _seed_reviewer(client, line_user_id="U_STAFF", real_name="王小美")
        other_id = _seed_reviewer(client, line_user_id="U_OTHER_STAFF", real_name="林美玲")
        patient_id, upload_ids = _seed_today_patient(
            client,
            case_number="P-REVIEWER-SELF",
            line_user_id="U_PATIENT_REVIEWER_SELF",
            uploads=[(timedelta(hours=1), "suspected", None)],
        )
        _assign_staff_patient(client, staff_identity_id=viewer_id, patient_id=patient_id)

        day_start = _taipei_today_start_utc()
        _add_annotation(
            client,
            patient_id=patient_id,
            upload_id=upload_ids[0],
            reviewer_identity_id=other_id,
            created_at=day_start + timedelta(hours=1),
        )
        _add_annotation(
            client,
            patient_id=patient_id,
            upload_id=upload_ids[0],
            reviewer_identity_id=viewer_id,
            created_at=day_start + timedelta(hours=3),
        )

        item = _fetch_single_attention_item(client)
        assert item["annotation_reviewed_by_me"] is True
        assert item["annotation_reviewer_name"] == "王小美"
        assert item["annotation_reviewer_count"] == 2


def test_today_attention_reviewer_name_falls_back_to_display_name(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-reviewer-fallback.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        viewer_id = _seed_reviewer(client, line_user_id="U_STAFF", real_name=None, display_name=None)
        other_id = _seed_reviewer(
            client,
            line_user_id="U_OTHER_STAFF",
            real_name="   ",
            display_name="林護理師",
        )
        patient_id, upload_ids = _seed_today_patient(
            client,
            case_number="P-REVIEWER-FALLBACK",
            line_user_id="U_PATIENT_REVIEWER_FALLBACK",
            uploads=[(timedelta(hours=1), "suspected", None)],
        )
        _assign_staff_patient(client, staff_identity_id=viewer_id, patient_id=patient_id)
        _add_annotation(
            client,
            patient_id=patient_id,
            upload_id=upload_ids[0],
            reviewer_identity_id=other_id,
            created_at=_taipei_today_start_utc() + timedelta(hours=2),
        )

        item = _fetch_single_attention_item(client)
        assert item["annotation_reviewer_name"] == "林護理師"
        assert item["annotation_reviewer_count"] == 1


def test_today_attention_omits_reviewer_when_unannotated(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-reviewer-absent.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        viewer_id = _seed_reviewer(client, line_user_id="U_STAFF", real_name="王小美")
        patient_id, _ = _seed_today_patient(
            client,
            case_number="P-REVIEWER-NONE",
            line_user_id="U_PATIENT_REVIEWER_NONE",
            uploads=[(timedelta(hours=1), "suspected", None)],
        )
        _assign_staff_patient(client, staff_identity_id=viewer_id, patient_id=patient_id)

        item = _fetch_single_attention_item(client)
        assert item["annotation_reviewer_name"] is None
        assert item["annotation_reviewed_by_me"] is False
        assert item["annotation_reviewer_count"] == 0
        assert item["annotation_reviewed_at"] is None


def test_today_attention_counts_people_not_annotation_rows(tmp_path: Path) -> None:
    settings = make_settings(tmp_path / "today-attention-reviewer-distinct.db")
    app = create_app(settings=settings, loaded_model=SimpleNamespace(device="cpu"))
    with TestClient(app) as client:
        viewer_id = _seed_reviewer(client, line_user_id="U_STAFF", real_name="王小美")
        other_id = _seed_reviewer(client, line_user_id="U_OTHER_STAFF", real_name="林美玲")
        patient_id, upload_ids = _seed_today_patient(
            client,
            case_number="P-REVIEWER-DISTINCT",
            line_user_id="U_PATIENT_REVIEWER_DISTINCT",
            uploads=[(timedelta(hours=1), "suspected", None)],
        )
        _assign_staff_patient(client, staff_identity_id=viewer_id, patient_id=patient_id)

        day_start = _taipei_today_start_utc()
        for hours in (1, 2):
            _add_annotation(
                client,
                patient_id=patient_id,
                upload_id=upload_ids[0],
                reviewer_identity_id=other_id,
                created_at=day_start + timedelta(hours=hours),
            )

        # Two rows, one person: the card copy says 「等 N 人」, so N must count reviewers.
        item = _fetch_single_attention_item(client)
        assert item["annotation_reviewer_count"] == 1
        assert item["annotation_reviewer_name"] == "林美玲"
        assert item["annotation_reviewed_by_me"] is False
