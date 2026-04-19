from __future__ import annotations

import io
import sys
from dataclasses import dataclass
from types import ModuleType

import requests
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings
from app.logging import get_logger
from app import model_compat
from app.schemas import ClassProbability, PredictionResponse, ScreeningResult


LOGGER = get_logger(__name__)
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


class ModelLoadError(RuntimeError):
    """Raised when the model file cannot be downloaded or loaded."""


class InvalidImageError(ValueError):
    """Raised when request bytes are not a decodable image."""


@dataclass
class LoadedModel:
    model: nn.Module
    device: torch.device
    transform: transforms.Compose


def resolve_device(device_name: str) -> torch.device:
    if device_name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device_name == "cuda" and not torch.cuda.is_available():
        raise ModelLoadError("DEVICE=cuda was requested but CUDA is not available")
    return torch.device(device_name)


def ensure_model_file(settings: Settings) -> Path:
    settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
    settings.model_path.parent.mkdir(parents=True, exist_ok=True)
    if settings.model_path.exists():
        return settings.model_path
    if not settings.model_url:
        raise ModelLoadError("MODEL_URL is empty and MODEL_PATH does not exist")

    LOGGER.info("Downloading model checkpoint from %s to %s", settings.model_url, settings.model_path)
    with requests.get(settings.model_url, stream=True, timeout=settings.model_timeout_seconds) as response:
        response.raise_for_status()
        with settings.model_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    return settings.model_path


def build_transform(settings: Settings) -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize(settings.image_size),
            transforms.CenterCrop(settings.image_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ]
    )


def _register_compatibility_symbols() -> None:
    current_main = sys.modules.setdefault("__main__", ModuleType("__main__"))
    for name, value in model_compat.COMPAT_EXPORTS.items():
        setattr(current_main, name, value)
    sys.modules.setdefault("train", model_compat)


def _unwrap_state_dict(checkpoint: object) -> tuple[dict[str, torch.Tensor], bool]:
    if isinstance(checkpoint, dict) and "state_dict" in checkpoint and isinstance(checkpoint["state_dict"], dict):
        state_dict = checkpoint["state_dict"]
    elif isinstance(checkpoint, dict) and checkpoint and all(isinstance(v, torch.Tensor) for v in checkpoint.values()):
        state_dict = checkpoint
    else:
        raise ModelLoadError("Checkpoint is not a module and does not contain a usable state_dict")

    wrapped = any(key.startswith("model.") for key in state_dict)
    if wrapped:
        state_dict = {key.removeprefix("model."): value for key, value in state_dict.items()}
    return state_dict, wrapped


def _detect_model_from_state_dict(state_dict: dict[str, torch.Tensor], settings: Settings) -> nn.Module:
    num_classes = len(settings.class_names)
    if settings.model_backbone == "none":
        model = model_compat.myCNN(num_classes=num_classes, arch=settings.model_arch)
    else:
        model = model_compat.build_transfer_model(
            settings.model_backbone,
            num_classes,
            dropout_p=settings.transfer_dropout,
        )

    model.load_state_dict(state_dict)
    return model


def load_model(settings: Settings) -> LoadedModel:
    if settings.infection_class_index >= len(settings.class_names):
        raise ModelLoadError("INFECTION_CLASS_INDEX must be within CLASS_NAMES")
    model_path = ensure_model_file(settings)
    device = resolve_device(settings.device)
    _register_compatibility_symbols()

    try:
        checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
    except Exception as exc:
        raise ModelLoadError(f"Failed to deserialize checkpoint: {exc}") from exc

    if isinstance(checkpoint, nn.Module):
        model = checkpoint
    else:
        state_dict, wrapped = _unwrap_state_dict(checkpoint)
        model = _detect_model_from_state_dict(state_dict, settings)
        if wrapped or settings.eval_hflip_tta:
            model = model_compat.EvalTTAWrapper(model, hflip=settings.eval_hflip_tta)

    model = model.to(device)
    model.eval()
    return LoadedModel(model=model, device=device, transform=build_transform(settings))


def decode_image(image_bytes: bytes) -> Image.Image:
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            image = ImageOps.exif_transpose(image)
            return image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImageError("Uploaded file is not a valid image") from exc


def predict_bytes(loaded: LoadedModel, image_bytes: bytes, settings: Settings) -> PredictionResponse:
    image = decode_image(image_bytes)
    tensor = loaded.transform(image).unsqueeze(0).to(loaded.device)

    with torch.inference_mode():
        logits = loaded.model(tensor)
        probabilities = torch.softmax(logits, dim=1)[0].detach().cpu()

    predicted_class_index = int(torch.argmax(probabilities).item())
    predicted_probability = float(probabilities[predicted_class_index].item())
    infection_probability = float(probabilities[settings.infection_class_index].item())

    class_probabilities = [
        ClassProbability(
            class_index=index,
            class_name=class_name,
            probability=float(probabilities[index].item()),
        )
        for index, class_name in enumerate(settings.class_names)
    ]

    return PredictionResponse(
        predicted_class_index=predicted_class_index,
        predicted_class_name=settings.class_names[predicted_class_index],
        predicted_probability=predicted_probability,
        class_probabilities=class_probabilities,
        screening=ScreeningResult(
            infection_class_index=settings.infection_class_index,
            infection_class_name=settings.class_names[settings.infection_class_index],
            infection_probability=infection_probability,
            threshold=settings.threshold,
            is_infection_positive=infection_probability >= settings.threshold,
        ),
    )

