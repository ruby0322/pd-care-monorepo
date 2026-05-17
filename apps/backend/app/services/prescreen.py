from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
import numpy as np

from app.core.config import Settings
from app.core.logging import get_logger
from app.services.model_loader import decode_image


LOGGER = get_logger(__name__)
DEFAULT_CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"
DEFAULT_THRESHOLD = 0.5

_IMPORT_ERROR: Exception | None = None
try:  # pragma: no cover - import guard
    import joblib
    from huggingface_hub import snapshot_download
    from transformers import CLIPModel, CLIPProcessor
except ModuleNotFoundError as exc:  # pragma: no cover - import guard
    joblib = None  # type: ignore[assignment]
    snapshot_download = None  # type: ignore[assignment]
    CLIPModel = Any  # type: ignore[misc,assignment]
    CLIPProcessor = Any  # type: ignore[misc,assignment]
    _IMPORT_ERROR = exc


class PrescreenError(RuntimeError):
    """Base exception for pre-screen lifecycle errors."""


class PrescreenLoadError(PrescreenError):
    """Raised when the pre-screen model bundle cannot be loaded."""


class PrescreenInferenceError(PrescreenError):
    """Raised when pre-screen inference fails."""


@dataclass
class LoadedPrescreenModel:
    clip_model: CLIPModel
    clip_processor: CLIPProcessor
    linear_probe: Any
    device: torch.device
    threshold: float
    repo_id: str
    revision: str | None


def _resolve_bundle_paths(settings: Settings) -> tuple[Path, Path]:
    if _IMPORT_ERROR is not None:
        raise PrescreenLoadError(
            f"Pre-screen dependencies are missing: {_IMPORT_ERROR}. "
            "Install backend requirements including huggingface_hub/transformers/joblib."
        ) from _IMPORT_ERROR

    if not settings.prescreen_model_repo_id:
        raise PrescreenLoadError("PRESCREEN_MODEL_REPO_ID must be set when PRESCREEN_ENABLED=true")

    cache_dir = settings.prescreen_model_cache_dir or (settings.model_cache_dir / "prescreen")
    cache_dir.mkdir(parents=True, exist_ok=True)

    snapshot_dir = Path(
        snapshot_download(
            repo_id=settings.prescreen_model_repo_id,
            repo_type="model",
            revision=settings.prescreen_model_revision,
            token=settings.hf_token,
            cache_dir=str(cache_dir),
            allow_patterns=["linear_probe.joblib", "bundle_config.json"],
        )
    )
    model_path = snapshot_dir / "linear_probe.joblib"
    config_path = snapshot_dir / "bundle_config.json"
    if not model_path.exists():
        raise PrescreenLoadError("Pre-screen bundle missing linear_probe.joblib")
    if not config_path.exists():
        raise PrescreenLoadError("Pre-screen bundle missing bundle_config.json")
    return model_path, config_path


def load_prescreen_model(settings: Settings) -> LoadedPrescreenModel:
    model_path, config_path = _resolve_bundle_paths(settings)
    try:
        bundle_config = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive
        raise PrescreenLoadError(f"Failed to parse bundle_config.json: {exc}") from exc

    clip_model_name = str(bundle_config.get("clip_model_name") or DEFAULT_CLIP_MODEL_NAME)
    threshold = float(bundle_config.get("decision_threshold", DEFAULT_THRESHOLD))

    try:
        linear_probe = joblib.load(model_path)
    except Exception as exc:
        raise PrescreenLoadError(f"Failed to load linear probe from {model_path}: {exc}") from exc

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    try:
        clip_processor = CLIPProcessor.from_pretrained(clip_model_name)
        clip_model = CLIPModel.from_pretrained(clip_model_name).to(device)
    except Exception as exc:
        raise PrescreenLoadError(f"Failed to load CLIP model '{clip_model_name}': {exc}") from exc

    clip_model.eval()
    LOGGER.info(
        "Loaded pre-screen bundle from %s (revision=%s) using %s",
        settings.prescreen_model_repo_id,
        settings.prescreen_model_revision or "default",
        clip_model_name,
    )
    return LoadedPrescreenModel(
        clip_model=clip_model,
        clip_processor=clip_processor,
        linear_probe=linear_probe,
        device=device,
        threshold=threshold,
        repo_id=settings.prescreen_model_repo_id,
        revision=settings.prescreen_model_revision,
    )


def _extract_embedding(loaded: LoadedPrescreenModel, image_bytes: bytes) -> np.ndarray:
    image = decode_image(image_bytes)
    inputs = loaded.clip_processor(images=image, return_tensors="pt")
    inputs = {key: value.to(loaded.device) for key, value in inputs.items()}
    with torch.inference_mode():
        raw_feats = loaded.clip_model.get_image_features(**inputs)
        if isinstance(raw_feats, torch.Tensor):
            feature_tensor = raw_feats
        elif hasattr(raw_feats, "pooler_output") and isinstance(raw_feats.pooler_output, torch.Tensor):
            feature_tensor = raw_feats.pooler_output
        elif hasattr(raw_feats, "last_hidden_state") and isinstance(raw_feats.last_hidden_state, torch.Tensor):
            feature_tensor = raw_feats.last_hidden_state[:, 0, :]
        else:
            raise PrescreenInferenceError(
                f"Unsupported CLIP feature output type: {type(raw_feats).__name__}"
            )
        feats = torch.nn.functional.normalize(feature_tensor, p=2, dim=-1)
    return feats.detach().cpu().numpy()


def is_exit_site_present(loaded: LoadedPrescreenModel, image_bytes: bytes) -> bool:
    try:
        embedding = _extract_embedding(loaded, image_bytes)
        if hasattr(loaded.linear_probe, "predict_proba"):
            try:
                prob_positive = float(loaded.linear_probe.predict_proba(embedding)[0][1])
            except Exception:
                # Some sklearn-version-unpickled probes miss internal attrs required by predict_proba.
                # Fallback to decision_function-based sigmoid keeps runtime behavior available.
                decision = loaded.linear_probe.decision_function(embedding)
                prob_positive = float(1.0 / (1.0 + np.exp(-decision[0])))
        else:
            decision = loaded.linear_probe.decision_function(embedding)
            prob_positive = float(1.0 / (1.0 + np.exp(-decision[0])))
        decision_positive = prob_positive >= loaded.threshold
        return decision_positive
    except Exception as exc:
        raise PrescreenInferenceError(f"Pre-screen inference failed: {exc}") from exc
