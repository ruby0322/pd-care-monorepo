#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests
from huggingface_hub import snapshot_download
from transformers import CLIPModel, CLIPProcessor

DEFAULT_MODEL_URL = (
    "https://huggingface.co/ruby0322/pd-exit-site-classification/"
    "resolve/main/model_e41_production_best.pt"
)
DEFAULT_CLIP_MODEL = "openai/clip-vit-base-patch32"


def _require_path(path: Path, label: str) -> None:
    if not path.exists():
        raise RuntimeError(f"Missing {label}: {path}")


def _download_checkpoint(model_url: str, model_path: Path) -> None:
    model_path.parent.mkdir(parents=True, exist_ok=True)
    if model_path.exists():
        return
    print(f"Downloading checkpoint to {model_path}", flush=True)
    with requests.get(model_url, stream=True, timeout=300) as response:
        response.raise_for_status()
        with model_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    _require_path(model_path, "checkpoint")


def _download_prescreen_bundle(
    repo_id: str,
    revision: str | None,
    token: str | None,
    cache_dir: Path,
) -> None:
    if not repo_id:
        print("PRESCREEN_MODEL_REPO_ID is empty; skipping prescreen bake", flush=True)
        return
    cache_dir.mkdir(parents=True, exist_ok=True)
    snapshot_dir = Path(
        snapshot_download(
            repo_id=repo_id,
            repo_type="model",
            revision=revision,
            token=token,
            cache_dir=str(cache_dir),
            allow_patterns=["linear_probe.joblib", "bundle_config.json"],
        )
    )
    _require_path(snapshot_dir / "linear_probe.joblib", "prescreen probe")
    _require_path(snapshot_dir / "bundle_config.json", "prescreen config")


def _warm_clip_cache(model_name: str) -> None:
    CLIPProcessor.from_pretrained(model_name)
    CLIPModel.from_pretrained(model_name)


def main() -> int:
    model_url = os.environ.get("MODEL_URL", DEFAULT_MODEL_URL)
    model_path = Path(os.environ.get("MODEL_PATH", "/models/model_e41_production_best.pt"))
    prescreen_repo = os.environ.get("PRESCREEN_MODEL_REPO_ID", "").strip()
    prescreen_revision = (os.environ.get("PRESCREEN_MODEL_REVISION") or "").strip() or None
    prescreen_cache_dir = Path(os.environ.get("PRESCREEN_MODEL_CACHE_DIR", "/models/prescreen"))
    hf_home = Path(os.environ.get("HF_HOME", "/models/hf-cache"))
    hf_token = os.environ.get("HF_TOKEN") or None

    hf_home.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(hf_home)
    os.environ["TRANSFORMERS_CACHE"] = str(hf_home)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(hf_home)

    _download_checkpoint(model_url=model_url, model_path=model_path)
    _download_prescreen_bundle(
        repo_id=prescreen_repo,
        revision=prescreen_revision,
        token=hf_token,
        cache_dir=prescreen_cache_dir,
    )
    _warm_clip_cache(DEFAULT_CLIP_MODEL)

    print("bake_models: success", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"bake_models: failed: {exc}", file=sys.stderr, flush=True)
        raise
