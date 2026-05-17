from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


DEFAULT_MODEL_URL = (
    "https://huggingface.co/ruby0322/pd-exit-site-classification/resolve/main/"
    "model_e41_production_best.pt"
)
DEFAULT_CLASS_NAMES = ("class_0", "class_1", "class_2", "class_3", "class_4")
DEFAULT_IMAGE_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff")

# Browser dev servers often bind random ports (e.g. Cursor preview). LAN phones stay on :3000 unless overridden via env.
DEFAULT_CORS_ALLOWED_ORIGIN_REGEX = (
    r"^https?://localhost(?::\d+)?$"
    r"|^https?://127\.0\.0\.1(?::\d+)?$"
    r"|^https?://(?:\d{1,3}\.){3}\d{1,3}:3000$"
)


def _parse_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    return float(value)


def _parse_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    return int(value)


def _parse_csv(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = os.getenv(name)
    if not value:
        return default
    items = tuple(part.strip() for part in value.split(",") if part.strip())
    return items or default


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    model_url: str
    model_path: Path
    model_cache_dir: Path
    model_timeout_seconds: float
    device: str
    model_backbone: str
    model_arch: str
    transfer_dropout: float
    threshold: float
    image_size: int
    infection_class_index: int
    class_names: tuple[str, ...]
    max_upload_mb: int
    log_level: str
    accepted_content_types: tuple[str, ...]
    cors_allowed_origins: tuple[str, ...]
    cors_allowed_origin_regex: str
    workers: int
    eval_hflip_tta: bool
    database_url: str
    s3_endpoint_url: str
    s3_region: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket_name: str
    image_access_token_secret: str
    image_access_token_ttl_seconds: int
    auth_token_secret: str = "change-me-auth"
    auth_token_ttl_seconds: int = 28800
    pilot_admin_identity_ids: tuple[str, ...] = ()
    pilot_staff_identity_ids: tuple[str, ...] = ()
    line_verify_mode: str = "line"
    line_channel_id: str = ""
    line_verify_endpoint: str = "https://api.line.me/oauth2/v2.1/verify"
    line_verify_timeout_seconds: float = 5.0
    prescreen_enabled: bool = False
    prescreen_model_repo_id: str = ""
    prescreen_model_revision: str | None = None
    prescreen_reject_reason: str = "non_exit_site_or_random_photo"
    prescreen_model_cache_dir: Path | None = None
    hf_token: str | None = None

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def _default_model_path() -> Path:
    """User-writable location for local dev. Docker/production should set MODEL_PATH (e.g. /models/...)."""
    xdg = os.getenv("XDG_CACHE_HOME")
    base = Path(xdg) / "pd-care" if xdg else Path.home() / ".cache" / "pd-care"
    return base / "model_e41_production_best.pt"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    model_path = Path(os.getenv("MODEL_PATH", str(_default_model_path())))
    model_cache_dir = Path(os.getenv("MODEL_CACHE_DIR", str(model_path.parent)))
    prescreen_model_cache_dir = Path(
        os.getenv("PRESCREEN_MODEL_CACHE_DIR", str(model_cache_dir / "prescreen"))
    )

    return Settings(
        app_name=os.getenv("APP_NAME", "pd-exit-site-inference-api"),
        app_env=os.getenv("APP_ENV", "production"),
        model_url=os.getenv("MODEL_URL", DEFAULT_MODEL_URL),
        model_path=model_path,
        model_cache_dir=model_cache_dir,
        model_timeout_seconds=_parse_float("MODEL_TIMEOUT_SECONDS", 300.0),
        device=os.getenv("DEVICE", "auto").strip().lower(),
        model_backbone=os.getenv("MODEL_BACKBONE", "mobilenet_v3_large").strip().lower(),
        model_arch=os.getenv("MODEL_ARCH", "baseline").strip().lower(),
        transfer_dropout=_parse_float("TRANSFER_DROPOUT", 0.4),
        threshold=_parse_float("THRESHOLD", 0.5),
        image_size=_parse_int("IMAGE_SIZE", 384),
        infection_class_index=_parse_int("INFECTION_CLASS_INDEX", 4),
        class_names=_parse_csv("CLASS_NAMES", DEFAULT_CLASS_NAMES),
        max_upload_mb=_parse_int("MAX_UPLOAD_MB", 10),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        accepted_content_types=_parse_csv("ACCEPTED_CONTENT_TYPES", DEFAULT_IMAGE_CONTENT_TYPES),
        cors_allowed_origins=_parse_csv(
            "CORS_ALLOWED_ORIGINS",
            (
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "https://1910-140-112-106-204.ngrok-free.app",
            ),
        ),
        cors_allowed_origin_regex=os.getenv(
            "CORS_ALLOWED_ORIGIN_REGEX",
            DEFAULT_CORS_ALLOWED_ORIGIN_REGEX,
        ),
        workers=_parse_int("WORKERS", 1),
        eval_hflip_tta=_parse_bool("EVAL_HFLIP_TTA", False),
        database_url=os.getenv("DATABASE_URL", "sqlite+pysqlite:///./pd_care.db"),
        s3_endpoint_url=os.getenv("S3_ENDPOINT_URL", "http://seaweedfs-s3:8333"),
        s3_region=os.getenv("S3_REGION", "us-east-1"),
        s3_access_key=os.getenv("S3_ACCESS_KEY", "seaweed-access"),
        s3_secret_key=os.getenv("S3_SECRET_KEY", "seaweed-secret"),
        s3_bucket_name=os.getenv("S3_BUCKET_NAME", "pd-care-private"),
        image_access_token_secret=os.getenv("IMAGE_ACCESS_TOKEN_SECRET", "change-me"),
        image_access_token_ttl_seconds=_parse_int("IMAGE_ACCESS_TOKEN_TTL_SECONDS", 300),
        auth_token_secret=os.getenv("AUTH_TOKEN_SECRET", "change-me-auth"),
        auth_token_ttl_seconds=_parse_int("AUTH_TOKEN_TTL_SECONDS", 28800),
        pilot_admin_identity_ids=_parse_csv("PILOT_ADMIN_IDENTITY_IDS", ()),
        pilot_staff_identity_ids=_parse_csv("PILOT_STAFF_IDENTITY_IDS", ()),
        line_verify_mode=os.getenv("LINE_VERIFY_MODE", "line").strip().lower(),
        line_channel_id=os.getenv("LINE_CHANNEL_ID", "").strip(),
        line_verify_endpoint=os.getenv("LINE_VERIFY_ENDPOINT", "https://api.line.me/oauth2/v2.1/verify").strip(),
        line_verify_timeout_seconds=_parse_float("LINE_VERIFY_TIMEOUT_SECONDS", 5.0),
        prescreen_enabled=_parse_bool("PRESCREEN_ENABLED", False),
        prescreen_model_repo_id=os.getenv("PRESCREEN_MODEL_REPO_ID", "").strip(),
        prescreen_model_revision=(os.getenv("PRESCREEN_MODEL_REVISION") or "").strip() or None,
        prescreen_reject_reason=(
            os.getenv("PRESCREEN_REJECT_REASON", "non_exit_site_or_random_photo").strip()
            or "non_exit_site_or_random_photo"
        ),
        prescreen_model_cache_dir=prescreen_model_cache_dir,
        hf_token=(os.getenv("HF_TOKEN") or "").strip() or None,
    )
