from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.logging import configure_logging, get_logger
from app.model_loader import InvalidImageError, LoadedModel, ModelLoadError, load_model, predict_bytes
from app.schemas import HealthResponse, PredictionResponse, ReadyResponse


LOGGER = get_logger(__name__)


def _build_error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": message})


def create_app(
    settings: Settings | None = None,
    loaded_model: LoadedModel | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        if loaded_model is not None:
            app.state.loaded_model = loaded_model
        else:
            LOGGER.info("Loading model at startup")
            app.state.loaded_model = load_model(settings)
            LOGGER.info("Model loaded on device %s", app.state.loaded_model.device)
        yield

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.loaded_model = loaded_model

    @app.exception_handler(ModelLoadError)
    async def model_load_error_handler(_: Request, exc: ModelLoadError) -> JSONResponse:
        return _build_error_response(status_code=503, message=str(exc))

    @app.exception_handler(InvalidImageError)
    async def invalid_image_handler(_: Request, exc: InvalidImageError) -> JSONResponse:
        return _build_error_response(status_code=400, message=str(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _build_error_response(status_code=422, message=str(exc))

    @app.get("/healthz", response_model=HealthResponse)
    async def healthz() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get("/readyz", response_model=ReadyResponse)
    async def readyz(request: Request) -> ReadyResponse:
        loaded = getattr(request.app.state, "loaded_model", None)
        if loaded is None:
            raise HTTPException(status_code=503, detail="Model is not loaded")
        return ReadyResponse(status="ready", model_loaded=True, device=str(loaded.device))

    @app.post("/v1/predict", response_model=PredictionResponse)
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

    return app


app = create_app()

