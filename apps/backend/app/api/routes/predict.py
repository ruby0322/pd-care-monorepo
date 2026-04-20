from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.core.config import Settings
from app.schemas.prediction import PredictionResponse
from app.services.model_loader import LoadedModel, predict_bytes


router = APIRouter()


@router.post("/v1/predict", response_model=PredictionResponse)
async def predict(request: Request, file: UploadFile = File(...)) -> PredictionResponse:
    current_settings: Settings = request.app.state.settings
    loaded: LoadedModel | None = getattr(request.app.state, "loaded_model", None)
    if loaded is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")

    content_type = (file.content_type or "").lower()
    if content_type not in current_settings.accepted_content_types:
        accepted = ", ".join(current_settings.accepted_content_types)
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content type {content_type!r}. Allowed: {accepted}",
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(payload) > current_settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded file exceeds MAX_UPLOAD_MB={current_settings.max_upload_mb}",
        )

    return predict_bytes(loaded, payload, current_settings)
