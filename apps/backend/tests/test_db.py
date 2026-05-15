from __future__ import annotations
# pyright: reportMissingImports=false

from pathlib import Path

from sqlalchemy import inspect, text

from app.config import Settings
from app.db.base import Base
from app.db.init_db import initialize_database
from app.db.models import (
    AIResult,
    Annotation,
    LiffIdentity,
    Notification,
    Patient,
    PendingBinding,
    Upload,
)
from app.db.session import create_engine_from_url, create_session_factory, ensure_postgres_database_exists, ping_database


def _make_settings(db_path: Path, *, pilot_admin_ids: tuple[str, ...] = (), pilot_staff_ids: tuple[str, ...] = ()) -> Settings:
    return Settings(
        app_name="test-db",
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
        pilot_admin_identity_ids=pilot_admin_ids,
        pilot_staff_identity_ids=pilot_staff_ids,
        line_verify_mode="stub",
    )


def test_week1_schema_tables_can_be_created() -> None:
    engine = create_engine_from_url("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    table_names = set(inspect(engine).get_table_names())

    assert "patients" in table_names
    assert "liff_identities" in table_names
    assert "pending_bindings" in table_names
    assert "uploads" in table_names
    assert "ai_results" in table_names
    assert "notifications" in table_names
    assert "annotations" in table_names

    # Touch imported models to ensure SQLAlchemy mappers are fully configured.
    assert Patient.__tablename__ == "patients"
    assert LiffIdentity.__tablename__ == "liff_identities"
    assert PendingBinding.__tablename__ == "pending_bindings"
    assert Upload.__tablename__ == "uploads"
    assert AIResult.__tablename__ == "ai_results"
    assert Notification.__tablename__ == "notifications"
    assert Annotation.__tablename__ == "annotations"
    liff_identity_columns = {column["name"] for column in inspect(engine).get_columns("liff_identities")}
    annotation_columns = {column["name"] for column in inspect(engine).get_columns("annotations")}
    assert "role" in liff_identity_columns
    assert "reviewer_identity_id" in annotation_columns


def test_session_factory_uses_isolated_sqlite_database(tmp_path: Path) -> None:
    db_file = tmp_path / "test.db"
    engine = create_engine_from_url(f"sqlite+pysqlite:///{db_file}")
    session_factory = create_session_factory(engine)

    with session_factory() as session:
        result = session.execute(text("SELECT 1")).scalar_one()

    assert result == 1


def test_ping_database_returns_true_for_reachable_database() -> None:
    engine = create_engine_from_url("sqlite+pysqlite:///:memory:")
    assert ping_database(engine) is True


def test_ensure_postgres_database_exists_skips_non_postgres_url() -> None:
    ensure_postgres_database_exists("sqlite+pysqlite:///:memory:")


def test_ensure_postgres_database_exists_creates_missing_database(monkeypatch) -> None:
    executed_queries: list[tuple[object, tuple[object, ...] | None]] = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params=None):
            executed_queries.append((query, params))

        def fetchone(self):
            return None

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return FakeCursor()

    def fake_connect(*args, **kwargs):
        return FakeConnection()

    monkeypatch.setattr("app.db.session.psycopg.connect", fake_connect)
    ensure_postgres_database_exists("postgresql+psycopg://postgres:postgres@postgres:5432/pd_care")

    assert any("SELECT 1 FROM pg_database" in str(query) for query, _ in executed_queries)
    assert any("CREATE DATABASE" in str(query) for query, _ in executed_queries)


def test_initialize_database_promotes_single_ruby_identity_to_admin(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "single-ruby.db")
    engine, session_factory = initialize_database(settings.database_url, settings=settings)

    with session_factory() as session:
        session.add(
            LiffIdentity(
                line_user_id="U_RUBY",
                display_name="Ruby",
                picture_url=None,
                patient_id=None,
                role="patient",
                is_active=True,
            )
        )
        session.commit()

    # Re-run initialization to simulate startup pass after identity exists.
    initialize_database(settings.database_url, settings=settings)

    with session_factory() as session:
        identity = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == "U_RUBY").one()
        assert identity.role == "admin"
        assert identity.is_active is True

    engine.dispose()


def test_initialize_database_does_not_promote_when_more_than_one_identity(tmp_path: Path) -> None:
    settings = _make_settings(tmp_path / "multiple-identities.db")
    engine, session_factory = initialize_database(settings.database_url, settings=settings)

    with session_factory() as session:
        session.add(
            LiffIdentity(
                line_user_id="U_RUBY",
                display_name="Ruby",
                picture_url=None,
                patient_id=None,
                role="patient",
                is_active=True,
            )
        )
        session.add(
            LiffIdentity(
                line_user_id="U_OTHER",
                display_name="Other",
                picture_url=None,
                patient_id=None,
                role="patient",
                is_active=True,
            )
        )
        session.commit()

    initialize_database(settings.database_url, settings=settings)

    with session_factory() as session:
        ruby = session.query(LiffIdentity).filter(LiffIdentity.line_user_id == "U_RUBY").one()
        assert ruby.role == "patient"

    engine.dispose()
