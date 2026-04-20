from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.services.model_loader import InvalidImageError, ModelLoadError


def _build_error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": message})


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ModelLoadError)
    async def model_load_error_handler(_: Request, exc: ModelLoadError) -> JSONResponse:
        return _build_error_response(status_code=503, message=str(exc))

    @app.exception_handler(InvalidImageError)
    async def invalid_image_handler(_: Request, exc: InvalidImageError) -> JSONResponse:
        return _build_error_response(status_code=400, message=str(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _build_error_response(status_code=422, message=str(exc))
