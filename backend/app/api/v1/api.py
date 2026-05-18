# Создайте api_v1.py как главный роутер версии
# backend/app/api/v1/api.py
from fastapi import APIRouter
from .endpoints import assessments, metrics, auth, systems

api_router = APIRouter()

api_router.include_router(assessments.router, prefix="/assessments", tags=["assessments"])
api_router.include_router(metrics.router, prefix="/metrics", tags=["metrics"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(systems.router, prefix="/systems", tags=["systems"])

# В main.py:
from app.api.v1.api import api_router
app.include_router(api_router, prefix="/api/v1")