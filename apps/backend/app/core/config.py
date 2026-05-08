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
            r"^https?://(?:\d{1,3}\.){3}\d{1,3}:3000$",
        ),
        workers=_parse_int("WORKERS", 1),
        eval_hflip_tta=_parse_bool("EVAL_HFLIP_TTA", False),
    )
