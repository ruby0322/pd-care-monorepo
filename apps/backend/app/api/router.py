from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.identity import router as identity_router
from app.api.routes.patient import router as patient_router
from app.api.routes.predict import router as predict_router
from app.api.routes.staff import router as staff_router


api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(health_router)
api_router.include_router(identity_router)
api_router.include_router(patient_router)
api_router.include_router(predict_router)
api_router.include_router(staff_router)
