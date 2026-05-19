from fastapi import APIRouter
from app.api.v1.endpoints import assessments, metrics, auth, systems

api_router = APIRouter()

# Подключаем роутеры с соответствующими префиксами
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(assessments.router, prefix="/assessments", tags=["assessments"])
api_router.include_router(metrics.router, prefix="/metrics", tags=["metrics"])
api_router.include_router(systems.router, prefix="/systems", tags=["systems"])