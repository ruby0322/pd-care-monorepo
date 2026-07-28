from __future__ import annotations

from fastapi import HTTPException

from app.services.auth.line_provider import LineTokenVerifyError


def line_verify_http_error(exc: LineTokenVerifyError) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message})
