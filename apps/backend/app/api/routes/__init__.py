from app.api.routes.health import router as health_router
from app.api.routes.predict import router as predict_router

__all__ = ["health_router", "predict_router"]
