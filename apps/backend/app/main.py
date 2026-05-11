from __future__ import annotations
# pyright: reportMissingImports=false

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging, get_logger
from app.db.init_db import initialize_database
from app.services.model_loader import LoadedModel, load_model
from app.services.storage import StorageService, build_storage_client


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
    {
        "name": "Identity",
        "description": "LINE LIFF identity binding and status checks.",
    },
    {
        "name": "Patient",
        "description": "Patient-specific upload orchestration and history.",
    },
    {
        "name": "Auth",
        "description": "Unified pilot identity login and access token issuance.",
    },
    {
        "name": "Staff",
        "description": "Protected staff/admin endpoints for notifications and image access.",
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
        engine, session_factory = initialize_database(settings.database_url, settings=settings)
        app.state.db_engine = engine
        app.state.db_session_factory = session_factory
        storage_client = build_storage_client(
            endpoint_url=settings.s3_endpoint_url,
            region=settings.s3_region,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
        )
        app.state.storage_service = StorageService(
            s3_client=storage_client,
            bucket=settings.s3_bucket_name,
            token_secret=settings.image_access_token_secret,
        )
        try:
            app.state.storage_service.ensure_bucket_exists()
        except Exception:
            LOGGER.exception(
                "Failed to initialize object storage bucket '%s' at endpoint '%s'",
                settings.s3_bucket_name,
                settings.s3_endpoint_url,
            )
            raise RuntimeError("Object storage bucket initialization failed")
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allowed_origins),
        allow_origin_regex=settings.cors_allowed_origin_regex,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(api_router)

    return app


app = create_app()

