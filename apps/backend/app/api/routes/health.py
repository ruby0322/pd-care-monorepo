from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.schemas.health import HealthResponse, ReadyResponse
from app.services.model_loader import LoadedModel


router = APIRouter(tags=["Health"])


@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/readyz", response_model=ReadyResponse)
async def readyz(request: Request) -> ReadyResponse:
    loaded: LoadedModel | None = getattr(request.app.state, "loaded_model", None)
    if loaded is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    return ReadyResponse(status="ready", model_loaded=True, device=str(loaded.device))
