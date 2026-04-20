from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.errors import register_exception_handlers
from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging, get_logger
from app.services.model_loader import LoadedModel, load_model


LOGGER = get_logger(__name__)

OPENAPI_TAGS = [
    {
        "name": "Health",
        "description": "Liveness and readiness probes for orchestration and load balancers.",
    },
    {
        "name": "Inference",
        "description": "Image classification and screening predictions.",
    },
]


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
        description=(
            "HTTP API for exit-site image classification. "
            "Interactive docs: [Swagger UI](/docs), [ReDoc](/redoc), OpenAPI JSON at `/openapi.json`."
        ),
        openapi_tags=OPENAPI_TAGS,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.loaded_model = loaded_model
    register_exception_handlers(app)
    app.include_router(api_router)

    return app


app = create_app()

